import type { Book, BookWithCopies } from "../types";
import { OPEN_STATUSES, type CoverMark, type CoverSearch } from "./types";

export type CoverFilter = "all" | "no_cover" | "marked" | "nothing_found";

export function hasStockCover(b: Book): boolean {
  return (b.coverUrl ?? "").trim() !== "";
}

function isNewer(a: CoverSearch, b: CoverSearch): boolean {
  if (a.createdAt !== b.createdAt) return a.createdAt > b.createdAt;
  return a.id > b.id;
}

/** The book's one active search. If a stale read holds two, the newest wins. */
export function latestByBook(s: CoverSearch[]): Map<string, CoverSearch> {
  const out = new Map<string, CoverSearch>();
  for (const row of s) {
    const cur = out.get(row.bookId);
    if (!cur || isNewer(row, cur)) out.set(row.bookId, row);
  }
  return out;
}

function isNothingFound(s: CoverSearch | undefined): boolean {
  return s !== undefined && (s.status === "nothing_found" || s.status === "failed");
}

/** Unhauled books (onShelf false) are left out of No cover, Marked and batches (D5). */
export function applyCoverFilter(
  books: BookWithCopies[],
  f: CoverFilter,
  marks: Map<string, CoverMark>,
  latest: Map<string, CoverSearch>,
): BookWithCopies[] {
  switch (f) {
    case "no_cover":
      return books.filter((b) => b.onShelf && !hasStockCover(b));
    case "marked":
      return books.filter((b) => b.onShelf && marks.has(b.id));
    case "nothing_found":
      return books.filter((b) => isNothingFound(latest.get(b.id)));
    default:
      return books;
  }
}

export interface SelectionTargets {
  /** Books a batch would search. */
  eligible: string[];
  /** Off the shelf: a batch skips them (D5). */
  unhauled: string[];
  /** Queued, being searched, or with results waiting for review. */
  alreadyOpen: string[];
  /** The last search found nothing (or failed); only an explicit retry searches again. */
  nothingFound: string[];
}

/** Sorts books by the batch rules, keeping their order. */
export function selectionTargets(books: BookWithCopies[], latest: Map<string, CoverSearch>): SelectionTargets {
  const out: SelectionTargets = { eligible: [], unhauled: [], alreadyOpen: [], nothingFound: [] };
  for (const b of books) {
    const s = latest.get(b.id);
    if (!b.onShelf) out.unhauled.push(b.id);
    else if (s && OPEN_STATUSES.has(s.status)) out.alreadyOpen.push(b.id);
    else if (isNothingFound(s)) out.nothingFound.push(b.id);
    else out.eligible.push(b.id);
  }
  return out;
}

export function batchSelection(
  books: BookWithCopies[],
  latest: Map<string, CoverSearch>,
): { eligible: string[]; alreadyOpen: number; nothingFound: number } {
  const t = selectionTargets(books, latest);
  return { eligible: t.eligible, alreadyOpen: t.alreadyOpen.length, nothingFound: t.nothingFound.length };
}
