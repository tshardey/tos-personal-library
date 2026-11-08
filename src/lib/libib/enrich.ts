import type { BookInput, BookWithCopies } from "../types";
import type { ImportStore } from "./apply";
import { fillPatch } from "./fill-patch";
import { canonicalIsbns } from "./isbn";
import { lookupGoogleBooksIsbn, type GoogleBooksVolume } from "../google-books";

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

const needs = (book: BookWithCopies, field: "coverUrl" | "synopsis"): boolean =>
  blank(book[field]) && !book.userEditedFields.includes(field);

function candidatesOf(books: BookWithCopies[]): Candidate[] {
  const out: Candidate[] = [];
  for (const book of books) {
    const isbns = [...canonicalIsbns(book)].slice(0, MAX_ISBNS_PER_REQUEST);
    if (isbns.length === 0) continue;
    if (needs(book, "coverUrl") || needs(book, "synopsis")) out.push({ book, isbns });
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

/** Google lookups per book are capped: a book rarely has more editions than this worth trying. */
const MAX_GOOGLE_ISBNS = 5;

/**
 * Asks Google Books for each ISBN in turn, keeping the first cover and synopsis found, and stops
 * once nothing the book still needs is missing.
 */
async function googleFill(
  isbns: string[],
  want: { cover: boolean; synopsis: boolean },
  key: string,
  fetchImpl: typeof fetch,
): Promise<GoogleBooksVolume> {
  const out: GoogleBooksVolume = { coverUrl: null, synopsis: null };
  for (const isbn of isbns.slice(0, MAX_GOOGLE_ISBNS)) {
    const volume = await lookupGoogleBooksIsbn(isbn, key, fetchImpl);
    out.coverUrl ??= volume?.coverUrl ?? null;
    out.synopsis ??= volume?.synopsis ?? null;
    if ((!want.cover || out.coverUrl !== null) && (!want.synopsis || out.synopsis !== null)) break;
  }
  return out;
}

/**
 * Fills empty covers and synopses (fill-only, via fillPatch): OpenLibrary first, then Google Books,
 * when a key is given, for books OpenLibrary left without a needed field. Each book gets one patch
 * combining both sources. Requests run one at a time. An OpenLibrary failure stops the run; a
 * Google failure (429, any other HTTP error such as 403 for a bad key, network, timeout) stops
 * only the Google lookups. Either way the
 * result has `failed: true` and patches already made stay.
 */
export async function enrichMissing(
  books: BookWithCopies[],
  store: Pick<ImportStore, "patchBook">,
  opts: {
    fetchImpl: typeof fetch;
    googleBooksKey?: string | null;
    onProgress?(done: number, total: number): void;
  },
): Promise<{ looked: number; filled: number; failed: boolean }> {
  const candidates = candidatesOf(books);
  const total = candidates.length;
  if (total === 0) return { looked: 0, filled: 0, failed: false };
  opts.onProgress?.(0, total);
  let googleKey = opts.googleBooksKey?.trim() || null;
  let googleFailed = false;
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
        let synopsis = found.map(synopsisOf).find((s) => s !== null) ?? null;
        let coverUrl = found.map(coverOf).find((c) => c !== null) ?? null;
        const want = {
          cover: needs(book, "coverUrl") && coverUrl === null,
          synopsis: needs(book, "synopsis") && synopsis === null,
        };
        if (googleKey !== null && (want.cover || want.synopsis)) {
          try {
            const volume = await googleFill(isbns, want, googleKey, opts.fetchImpl);
            coverUrl ??= volume.coverUrl;
            synopsis ??= volume.synopsis;
          } catch (err) {
            // GoogleBooksError messages never include the request URL, so the key stays out of logs.
            console.error("Google Books lookup failed", err instanceof Error ? err.message : "unknown error");
            googleKey = null;
            googleFailed = true;
          }
        }
        const incoming: BookInput = {
          title: book.title,
          authors: [],
          synopsis,
          coverUrl,
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
  return { looked: total, filled, failed: googleFailed };
}
