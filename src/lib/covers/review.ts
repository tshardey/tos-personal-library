import type { BookWithCopies } from "../types";
import type { CoverSearch } from "./types";

export type RowChoice = "keep" | string;

export interface ReviewRow {
  search: CoverSearch;
  book: BookWithCopies;
  kind: "results" | "nothing_found" | "failed";
  coverChanged: boolean;
  defaultChoice: RowChoice | null;
}

const byCreated = (a: ReviewRow, b: ReviewRow) =>
  a.search.createdAt < b.search.createdAt ? -1 : a.search.createdAt > b.search.createdAt ? 1 : 0;

export function buildReviewRows(searches: CoverSearch[], books: BookWithCopies[]): ReviewRow[] {
  const byId = new Map(books.map((b) => [b.id, b]));
  const results: ReviewRow[] = [];
  const others: ReviewRow[] = [];
  for (const search of searches) {
    const book = byId.get(search.bookId);
    if (!book) continue;
    const coverChanged = (book.coverUrl ?? null) !== (search.coverAtRequest ?? null);
    if (search.status === "ready" && search.results.length > 0) {
      results.push({
        search,
        book,
        kind: "results",
        coverChanged,
        defaultChoice: coverChanged ? "keep" : search.results[0].url,
      });
    } else if ((search.status === "nothing_found" || search.status === "failed") && search.seenAt === null) {
      others.push({ search, book, kind: search.status, coverChanged, defaultChoice: null });
    }
  }
  return [...results.sort(byCreated), ...others.sort(byCreated)];
}

export type ReviewAction =
  | { kind: "apply"; searchId: string; url: string; expectedCover: string | null }
  | { kind: "keep"; searchId: string }
  | { kind: "seen"; searchId: string };

export function planApply(rows: ReviewRow[], choices: Map<string, RowChoice>): ReviewAction[] {
  return rows.map((row): ReviewAction => {
    const searchId = row.search.id;
    if (row.kind !== "results") return { kind: "seen", searchId };
    const choice = choices.get(searchId) ?? row.defaultChoice;
    if (choice === null || choice === "keep") return { kind: "keep", searchId };
    return { kind: "apply", searchId, url: choice, expectedCover: row.book.coverUrl };
  });
}

export function pickedCount(rows: ReviewRow[], choices: Map<string, RowChoice>): number {
  return planApply(rows, choices).filter((a) => a.kind === "apply").length;
}
