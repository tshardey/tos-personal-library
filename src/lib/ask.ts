import type { BookWithCopies } from "@/lib/types";
import { applyCoverFilter } from "@/lib/covers/eligibility";
import type { CoverMark, CoverSearch } from "@/lib/covers/types";
import { filterBooks } from "@/lib/filter-books";
import type { LibraryView } from "@/lib/library-view";

export const ASK_MAX_BOOKS = 2000;
export const ASK_MAX_PROMPT = 300;

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
  cover: { available: boolean; marks: Map<string, CoverMark>; latest: Map<string, CoverSearch> },
): string[] {
  const filtered = filterBooks(books, {
    query: "",
    owner: view.owner,
    edition: view.edition,
    tags: view.tags,
    tagsByBook,
    libraryTags: view.libraryTags,
    libraryTagsByBook,
    series,
    unhauled: view.unhauled,
    deluxe: view.deluxe,
    signed: view.signed,
    addedDay: view.addedDay,
    publishedFrom: view.publishedFrom,
    publishedTo: view.publishedTo,
  });
  const found = cover.available ? applyCoverFilter(filtered, view.coverFilter, cover.marks, cover.latest) : filtered;
  return found.map((b) => b.id);
}
