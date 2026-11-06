import Papa from "papaparse";
import type { BookInput } from "../types";
import { joinNameSuffixes, normalizeBookInput } from "../normalize";
import { isbn10To13, normalizeIsbn10, normalizeIsbn13 } from "./isbn";

export const MAX_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_ROWS = 10_000;

export const REQUIRED_COLUMNS = [
  "id", "item_type", "title", "creators", "collection", "ean_isbn13", "upc_isbn10",
  "description", "publisher", "publish_date", "length", "copies",
] as const;

/** D6: a trailing parenthetical containing "edition". Also used by Task 3's titleKey. */
export const EDITION_RE = /\s*\(([^)]*\bedition\b[^)]*)\)\s*$/i;

export interface LibibRow {
  libibId: string;
  /** 1-based data row, not a physical line */
  rowNumber: number;
  collection: string;
  book: BookInput;
  editionNote: string | null;
  copies: number;
}

export type SkipReason = "missing_id" | "missing_title" | "wrong_column_count" | "not_a_book";
export interface SkippedRow {
  rowNumber: number;
  title: string | null;
  reason: SkipReason;
}
export type RowWarning = "invalid_isbn" | "unreadable_copies" | "duplicate_id";

export interface ParsedFile {
  rows: LibibRow[];
  skipped: SkippedRow[];
  warnings: { rowNumber: number; title: string; warning: RowWarning }[];
  /** an ISBN looked like 9.78E+12 */
  spreadsheetDamage: boolean;
  /** distinct, file order */
  collections: string[];
  /** every id in the file, including non-book and skipped-collection rows */
  allIds: Set<string>;
}

export type LibibFileErrorCode =
  | "not_text" | "not_libib" | "empty" | "malformed" | "too_large" | "too_many_rows";

export class LibibFileError extends Error {
  code: LibibFileErrorCode;
  missingColumns: string[];
  constructor(code: LibibFileErrorCode, missingColumns: string[] = []) {
    super(code);
    this.name = "LibibFileError";
    this.code = code;
    this.missingColumns = missingColumns;
  }
}

export function decodeLibibBytes(bytes: Uint8Array): string {
  if (bytes.includes(0) || (bytes.length >= 2 && bytes[0] === 0x50 && bytes[1] === 0x4b)) {
    throw new LibibFileError("not_text");
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder("windows-1252").decode(bytes);
  }
}

export async function readLibibFile(file: File): Promise<ParsedFile> {
  if (file.size > MAX_FILE_BYTES) throw new LibibFileError("too_large");
  const bytes = new Uint8Array(await file.arrayBuffer());
  return parseLibibCsv(decodeLibibBytes(bytes));
}


/** Splits on commas outside parentheses. */
function splitOutsideParens(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of s) {
    if (ch === "(") depth++;
    else if (ch === ")") depth = Math.max(0, depth - 1);
    if (ch === "," && depth === 0) {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out.map((x) => x.trim()).filter(Boolean);
}

/** D7: suffixes join first, then role-marked names are dropped when an unmarked name remains. */
function parseCreators(raw: string): string[] {
  const names = joinNameSuffixes(splitOutsideParens(raw));
  const hasRole = (n: string) => /\([^)]*\)/.test(n);
  const unmarked = names.filter((n) => !hasRole(n));
  if (unmarked.length > 0) return unmarked;
  return names.map((n) => n.replace(/\s*\([^)]*\)/g, "").trim()).filter(Boolean);
}

const SPREADSHEET_NUMBER = /^\d(\.\d+)?E\+\d+$/i;

export function parseLibibCsv(text: string): ParsedFile {
  const parsed = Papa.parse<string[]>(text.replace(/^\uFEFF/, ""), {
    header: false,
    delimiter: ",",
    skipEmptyLines: "greedy",
  });
  if (parsed.errors.some((e) => e.type === "Quotes")) throw new LibibFileError("malformed");
  const [headerRow, ...dataRows] = parsed.data;
  if (!headerRow) throw new LibibFileError("empty");

  const header = headerRow.map((h) => h.trim());
  const missing = REQUIRED_COLUMNS.filter((c) => !header.includes(c));
  if (missing.length > 0) throw new LibibFileError("not_libib", missing);
  if (dataRows.length === 0) throw new LibibFileError("empty");
  if (dataRows.length > MAX_ROWS) throw new LibibFileError("too_many_rows");

  const index = new Map(header.map((h, i) => [h, i]));
  const result: ParsedFile = {
    rows: [],
    skipped: [],
    warnings: [],
    spreadsheetDamage: false,
    collections: [],
    allIds: new Set(),
  };
  const byId = new Map<string, LibibRow>();

  dataRows.forEach((cells, i) => {
    const rowNumber = i + 1;
    if (cells.length !== header.length) {
      result.skipped.push({ rowNumber, title: null, reason: "wrong_column_count" });
      return;
    }
    const get = (c: string) => (cells[index.get(c)!] ?? "").trim();
    const id = get("id");
    const rawTitle = get("title");
    const skip = (reason: SkipReason) =>
      result.skipped.push({ rowNumber, title: rawTitle || null, reason });

    if (!id) return skip("missing_id");
    result.allIds.add(id);
    const itemType = get("item_type").toLowerCase();
    if (itemType && itemType !== "book") return skip("not_a_book");
    if (!rawTitle) return skip("missing_title");

    const warn = (warning: RowWarning) =>
      result.warnings.push({ rowNumber, title: rawTitle, warning });

    // Title and edition (D6)
    let title = rawTitle;
    let editionNote: string | null = null;
    const m = EDITION_RE.exec(rawTitle);
    if (m && rawTitle.slice(0, m.index).trim()) {
      title = rawTitle.slice(0, m.index).trim();
      editionNote = m[1].trim() || null;
    }

    // ISBNs
    const ean = get("ean_isbn13");
    const upc = get("upc_isbn10");
    if (SPREADSHEET_NUMBER.test(ean) || SPREADSHEET_NUMBER.test(upc)) result.spreadsheetDamage = true;
    let isbn13: string[] = [];
    if (ean && !SPREADSHEET_NUMBER.test(ean)) {
      const v = normalizeIsbn13(ean);
      if (v) isbn13 = [v];
      else warn("invalid_isbn");
    }
    const v10 = SPREADSHEET_NUMBER.test(upc) ? null : normalizeIsbn10(upc);
    const isbn10 = v10 ? [v10] : [];
    if (v10 && isbn13.length === 0) isbn13 = [isbn10To13(v10)];

    // Copies
    const rawCopies = get("copies");
    let copies = 1;
    if (rawCopies) {
      const n = /^\d+$/.test(rawCopies) ? Number(rawCopies) : NaN;
      if (n >= 1 && n <= 50) copies = n;
      else warn("unreadable_copies");
    }

    const length = /^\d+$/.test(get("length")) ? Number(get("length")) : 0;

    const row: LibibRow = {
      libibId: id,
      rowNumber,
      collection: get("collection"),
      book: normalizeBookInput({
        title,
        authors: parseCreators(get("creators")),
        synopsis: get("description"),
        coverUrl: null,
        isbn13,
        isbn10,
        pageCount: length > 0 ? length : null,
        publisher: get("publisher"),
        publishDate: get("publish_date"),
      }),
      editionNote,
      copies,
    };

    const first = byId.get(id);
    if (first) {
      first.copies = Math.max(first.copies, copies);
      result.warnings.push({ rowNumber, title: rawTitle, warning: "duplicate_id" });
      return;
    }
    byId.set(id, row);
    result.rows.push(row);
    if (!result.collections.includes(row.collection)) result.collections.push(row.collection);
  });

  return result;
}
