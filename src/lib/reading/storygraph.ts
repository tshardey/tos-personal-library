import Papa from "papaparse";
import { joinNameSuffixes } from "../normalize";
import { isbn10To13, normalizeIsbn10, normalizeIsbn13 } from "../libib/isbn";
import { authorKey, titleKey } from "../libib/match-keys";
import { decodeLibibBytes, LibibFileError, MAX_FILE_BYTES } from "../libib/parse";
import type { HistoryUploadRow } from "./types";

export const MAX_HISTORY_ROWS = 20_000;

export type StoryGraphErrorCode =
  | "not_text" | "not_storygraph" | "empty" | "malformed" | "too_large" | "too_many_rows";

export class StoryGraphFileError extends Error {
  code: StoryGraphErrorCode;
  missing: string[];
  constructor(code: StoryGraphErrorCode, missing: string[] = []) {
    super(code);
    this.name = "StoryGraphFileError";
    this.code = code;
    this.missing = missing;
  }
}

export interface ParsedHistory {
  rows: HistoryUploadRow[];
  skipped: number;
}

const REQUIRED = ["Title", "Read Status"] as const;

/** 'YYYY/MM/DD' or 'YYYY-MM-DD' to 'YYYY-MM-DD'; null when not a real calendar date. */
export function parseSgDate(s: string): string | null {
  const m = /^(\d{4})[/-](\d{2})[/-](\d{2})$/.exec(s.trim());
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return `${m[1]}-${m[2]}-${m[3]}`;
}

function lastDateRead(datesRead: string): string | null {
  const tokens = datesRead.match(/\d{4}[/-]\d{2}[/-]\d{2}/g);
  return tokens ? parseSgDate(tokens[tokens.length - 1]) : null;
}

/** Mirrors the server's sg_key (D7). */
function mergeKey(r: HistoryUploadRow): string {
  if (r.isbnUid) {
    const i13 = normalizeIsbn13(r.isbnUid);
    if (i13) return `isbn:${i13}`;
    const i10 = normalizeIsbn10(r.isbnUid);
    if (i10) return `isbn:${isbn10To13(i10)}`;
    return `uid:${r.isbnUid.trim().toLowerCase()}`;
  }
  return `t:${titleKey(r.title)}|${r.authors.map(authorKey).join(";")}`;
}

// The server rejects the whole batch if any row passes these, so clip here.
const MAX_TITLE_CHARS = 500;
const MAX_AUTHORS = 50;
const MAX_AUTHOR_CHARS = 500;
const MAX_UID_CHARS = 100;

/** Clip to n characters (code points, as the server counts them). */
function clip(s: string, n: number): string {
  return s.length <= n ? s : Array.from(s).slice(0, n).join("");
}

export function parseStoryGraph(text: string): ParsedHistory {
  if (text.includes("\u0000")) throw new StoryGraphFileError("not_text");
  const parsed = Papa.parse<Record<string, string>>(text.replace(/^\uFEFF/, ""), {
    header: true,
    delimiter: ",",
    skipEmptyLines: "greedy",
    transformHeader: (h) => h.trim().toLowerCase(),
  });
  if (parsed.errors.some((e) => e.type === "Quotes")) throw new StoryGraphFileError("malformed");

  const fields = parsed.meta.fields ?? [];
  if (fields.length === 0) throw new StoryGraphFileError("empty");
  const missing = REQUIRED.filter((c) => !fields.includes(c.toLowerCase()));
  if (missing.length > 0) throw new StoryGraphFileError("not_storygraph", [...missing]);
  if (parsed.data.length === 0) throw new StoryGraphFileError("empty");
  if (parsed.data.length > MAX_HISTORY_ROWS) throw new StoryGraphFileError("too_many_rows");

  const merged = new Map<string, HistoryUploadRow>();
  let skipped = 0;
  for (const rec of parsed.data) {
    const get = (c: string) => (rec[c.toLowerCase()] ?? "").trim();
    const rs = get("Read Status").toLowerCase();
    const status = rs === "read" ? "read" : rs === "did-not-finish" ? "dnf" : null;
    const title = get("Title");
    if (!status || !title) {
      skipped++;
      continue;
    }
    const row: HistoryUploadRow = {
      title: clip(title, MAX_TITLE_CHARS),
      authors: joinNameSuffixes(get("Authors").split(",").map((n) => n.trim()).filter(Boolean))
        .slice(0, MAX_AUTHORS)
        .map((a) => clip(a, MAX_AUTHOR_CHARS)),
      isbnUid: clip(get("ISBN/UID"), MAX_UID_CHARS) || null,
      status,
      lastRead: parseSgDate(get("Last Date Read")) ?? lastDateRead(get("Dates Read")),
    };
    const key = mergeKey(row);
    const prev = merged.get(key);
    if (!prev) {
      merged.set(key, row);
      continue;
    }
    if (row.status === "read") prev.status = "read";
    if (row.lastRead && (!prev.lastRead || row.lastRead > prev.lastRead)) prev.lastRead = row.lastRead;
  }
  return { rows: [...merged.values()], skipped };
}

export async function readStoryGraphFile(file: File): Promise<ParsedHistory> {
  if (file.size > MAX_FILE_BYTES) throw new StoryGraphFileError("too_large");
  const bytes = new Uint8Array(await file.arrayBuffer());
  let text: string;
  try {
    text = decodeLibibBytes(bytes);
  } catch (e) {
    if (e instanceof LibibFileError) throw new StoryGraphFileError("not_text");
    throw e;
  }
  return parseStoryGraph(text);
}
