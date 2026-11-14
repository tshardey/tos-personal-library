import type { BookWithCopies } from "@/lib/types";
import { applyCoverFilter } from "@/lib/covers/eligibility";
import type { CoverMark, CoverSearch } from "@/lib/covers/types";
import { filterBooks, type FilterOptions } from "@/lib/filter-books";
import type { AskView, LibraryView } from "@/lib/library-view";
import type { AskMatch } from "@/lib/tagging/types";

export const ASK_MAX_BOOKS = 2000;
export const ASK_MAX_PROMPT = 300;

/** What the view's filters look things up in, besides the books themselves. */
export interface ViewLookups {
  tagsByBook: Map<string, string[]>;
  libraryTagsByBook: Map<string, string[]>;
  series: string | null;
  cover: { available: boolean; marks: Map<string, CoverMark>; latest: Map<string, CoverSearch> };
}

/** The view's filterBooks options. The one place a view becomes filters, so the wall and the Ask set can't drift. */
export function viewFilterOptions(view: LibraryView, lookups: ViewLookups): FilterOptions {
  return {
    query: view.query,
    owner: view.owner,
    edition: view.edition,
    tags: view.tags,
    tagsByBook: lookups.tagsByBook,
    libraryTags: view.libraryTags,
    libraryTagsByBook: lookups.libraryTagsByBook,
    series: lookups.series,
    unhauled: view.unhauled,
    deluxe: view.deluxe,
    signed: view.signed,
    addedDay: view.addedDay,
    publishedFrom: view.publishedFrom,
    publishedTo: view.publishedTo,
  };
}

/** The books the view shows: filterBooks, then the cover filter when covers are available. Catalogue order. */
export function filterView(books: BookWithCopies[], view: LibraryView, lookups: ViewLookups): BookWithCopies[] {
  const filtered = filterBooks(books, viewFilterOptions(view, lookups));
  const { cover } = lookups;
  return cover.available ? applyCoverFilter(filtered, view.coverFilter, cover.marks, cover.latest) : filtered;
}

/**
 * D11: the books an Ask looks at. The current view with `query: ""` (the box text is the prompt, and a
 * non-blank query would let unhauled books in), then the cover filter. Catalogue order.
 */
export function askBookIds(
  books: BookWithCopies[],
  view: LibraryView,
  tagsByBook: Map<string, string[]>,
  libraryTagsByBook: Map<string, string[]>,
  series: string | null,
  cover: ViewLookups["cover"],
): string[] {
  return filterView(books, { ...view, query: "" }, { tagsByBook, libraryTagsByBook, series, cover }).map((b) => b.id);
}

/** The rows an Ask shows, best first: matches whose book is still in the catalogue. */
export function askRows(ask: AskView, books: BookWithCopies[]): { match: AskMatch; book: BookWithCopies }[] {
  const r = ask.response;
  if (ask.status !== "done" || r === null || r.outcome !== "ok" || !r.answerable) return [];
  const byId = new Map(books.map((b) => [b.id, b]));
  return r.matches.flatMap((match) => {
    const book = byId.get(match.bookId);
    return book ? [{ match, book }] : [];
  });
}
