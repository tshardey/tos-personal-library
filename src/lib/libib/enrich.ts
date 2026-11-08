import type { BookInput, BookWithCopies } from "../types";
import type { ImportStore } from "./apply";
import { fillPatch } from "./fill-patch";
import { canonicalIsbns } from "./isbn";

const MAX_ISBNS_PER_REQUEST = 40;

interface Details {
  covers?: unknown;
  description?: unknown;
}

interface Candidate {
  book: BookWithCopies;
  isbns: string[];
}

const blank = (v: string | null): boolean => v === null || v.trim() === "";

function candidatesOf(books: BookWithCopies[]): Candidate[] {
  const out: Candidate[] = [];
  for (const book of books) {
    const isbns = [...canonicalIsbns(book)].slice(0, MAX_ISBNS_PER_REQUEST);
    if (isbns.length === 0) continue;
    const needsCover = blank(book.coverUrl) && !book.userEditedFields.includes("coverUrl");
    const needsSynopsis = blank(book.synopsis) && !book.userEditedFields.includes("synopsis");
    if (needsCover || needsSynopsis) out.push({ book, isbns });
  }
  return out;
}

/** Groups candidates so that no request carries more than 40 distinct ISBNs. */
function requestsOf(candidates: Candidate[]): Candidate[][] {
  const out: Candidate[][] = [];
  let current: Candidate[] = [];
  let seen = new Set<string>();
  for (const c of candidates) {
    const added = c.isbns.filter((i) => !seen.has(i)).length;
    if (current.length > 0 && seen.size + added > MAX_ISBNS_PER_REQUEST) {
      out.push(current);
      current = [];
      seen = new Set();
    }
    current.push(c);
    for (const i of c.isbns) seen.add(i);
  }
  if (current.length > 0) out.push(current);
  return out;
}

function coverOf(details: Details): string | null {
  if (!Array.isArray(details.covers)) return null;
  const id = details.covers.find((c): c is number => typeof c === "number" && c > 0);
  return id === undefined ? null : `https://covers.openlibrary.org/b/id/${id}-L.jpg`;
}

function synopsisOf(details: Details): string | null {
  const d = details.description;
  let text = "";
  if (typeof d === "string") text = d;
  else if (d && typeof d === "object" && typeof (d as { value?: unknown }).value === "string") {
    text = (d as { value: string }).value;
  }
  return text.trim() === "" ? null : text.trim();
}

/** The details OpenLibrary returned for any of these ISBNs; ISBNs missing from the response are skipped. */
function detailsFor(data: unknown, isbns: string[]): Details[] {
  const out: Details[] = [];
  if (!data || typeof data !== "object") return out;
  for (const isbn of isbns) {
    const entry = (data as Record<string, unknown>)[`ISBN:${isbn}`];
    const details = entry && typeof entry === "object" ? (entry as { details?: unknown }).details : null;
    if (details && typeof details === "object") out.push(details as Details);
  }
  return out;
}

/**
 * Fills empty covers and synopses from OpenLibrary (fill-only, via fillPatch). Requests run one at
 * a time. A network or HTTP failure stops the run with `failed: true`; patches already made stay.
 */
export async function enrichMissing(
  books: BookWithCopies[],
  store: Pick<ImportStore, "patchBook">,
  opts: { fetchImpl: typeof fetch; onProgress?(done: number, total: number): void },
): Promise<{ looked: number; filled: number; failed: boolean }> {
  const candidates = candidatesOf(books);
  const total = candidates.length;
  if (total === 0) return { looked: 0, filled: 0, failed: false };
  opts.onProgress?.(0, total);
  let done = 0;
  let filled = 0;
  try {
    for (const group of requestsOf(candidates)) {
      const keys = [...new Set(group.flatMap((c) => c.isbns))].map((i) => `ISBN:${i}`).join(",");
      const res = await opts.fetchImpl(
        `https://openlibrary.org/api/books?bibkeys=${keys}&format=json&jscmd=details`,
        { signal: AbortSignal.timeout(60_000) },
      );
      if (!res.ok) throw new Error(`OpenLibrary answered ${res.status}`);
      const data: unknown = await res.json();
      for (const { book, isbns } of group) {
        const found = detailsFor(data, isbns);
        const incoming: BookInput = {
          title: book.title,
          authors: [],
          synopsis: found.map(synopsisOf).find((s) => s !== null) ?? null,
          coverUrl: found.map(coverOf).find((c) => c !== null) ?? null,
          isbn13: [],
          isbn10: [],
          pageCount: null,
          publisher: null,
          publishDate: null,
        };
        const { patch } = fillPatch(book, incoming);
        if (Object.keys(patch).length > 0 && (await store.patchBook(book.id, book.updatedAt, patch))) {
          filled += 1;
        }
      }
      done += group.length;
      opts.onProgress?.(done, total);
    }
  } catch (err) {
    console.error("OpenLibrary lookup failed", err);
    return { looked: total, filled, failed: true };
  }
  return { looked: total, filled, failed: false };
}
