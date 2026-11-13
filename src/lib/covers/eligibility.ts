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

export function applyCoverFilter(
  books: BookWithCopies[],
  f: CoverFilter,
  marks: Map<string, CoverMark>,
  latest: Map<string, CoverSearch>,
): BookWithCopies[] {
  switch (f) {
    case "no_cover":
      return books.filter((b) => !hasStockCover(b));
    case "marked":
      return books.filter((b) => marks.has(b.id));
    case "nothing_found":
      return books.filter((b) => isNothingFound(latest.get(b.id)));
    default:
      return books;
  }
}

export function batchSelection(
  books: BookWithCopies[],
  latest: Map<string, CoverSearch>,
): { eligible: string[]; alreadyOpen: number; nothingFound: number } {
  const eligible: string[] = [];
  let alreadyOpen = 0;
  let nothingFound = 0;
  for (const b of books) {
    const s = latest.get(b.id);
    if (!s) eligible.push(b.id);
    else if (OPEN_STATUSES.has(s.status)) alreadyOpen += 1;
    else if (isNothingFound(s)) nothingFound += 1;
    else eligible.push(b.id);
  }
  return { eligible, alreadyOpen, nothingFound };
}
