import type { BookWithCopies } from "@/lib/types";
import { countedCopies, hasUnhauledCopy } from "@/lib/copy-flags";
import { localDay } from "@/lib/date-added";
import { publishYear } from "@/lib/publish-year";

/** 'all' | 'shared' | a member's userId */
export type OwnerFilter = "all" | "shared" | string;

function fold(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

export interface FilterOptions {
  query: string;
  owner: OwnerFilter;
  edition?: string | null;
  /** The book must have every one of these tag ids. */
  tags?: string[];
  tagsByBook?: Map<string, string[]>;
  /** Library tags: the same all-of rule as `tags`. */
  libraryTags?: string[];
  libraryTagsByBook?: Map<string, string[]>;
  /** Case-insensitive series name. */
  series?: string | null;
  /** Only books with at least one unhauled copy. */
  unhauled?: boolean;
  deluxe?: boolean;
  signed?: boolean;
  /** YYYY-MM-DD in the viewer's time zone. */
  addedDay?: string | null;
  publishedFrom?: number | null;
  publishedTo?: number | null;
}

/** Unhauled copies and books are shown for the Unhauled filter or a non-blank search. */
export function showsUnhauled(opts: { query: string; unhauled?: boolean }): boolean {
  return !!opts.unhauled || opts.query.trim() !== "";
}

export function filterBooks(books: BookWithCopies[], opts: FilterOptions): BookWithCopies[] {
  const edition = opts.edition ? opts.edition.trim().toLowerCase() : null;
  const series = opts.series ? opts.series.trim().toLowerCase() : null;
  const wanted = opts.tags ?? [];
  const wantedLibrary = opts.libraryTags ?? [];
  const q = fold(opts.query.trim());
  const showUnhauled = showsUnhauled(opts);
  let from = opts.publishedFrom ?? null;
  let to = opts.publishedTo ?? null;
  if (from !== null && to !== null && from > to) [from, to] = [to, from];
  return books.filter((b) => {
    if (!showUnhauled && !b.onShelf) return false;
    if (opts.unhauled && !hasUnhauledCopy(b)) return false;
    const copies = countedCopies(b, showUnhauled);
    if (opts.owner === "shared") {
      if (!copies.some((c) => c.ownerUserId === null)) return false;
    } else if (opts.owner !== "all") {
      if (!copies.some((c) => c.ownerUserId === opts.owner)) return false;
    }
    if (edition && !copies.some((c) => c.editionNote?.trim().toLowerCase() === edition)) return false;
    if (opts.deluxe && !copies.some((c) => c.deluxe)) return false;
    if (opts.signed && !copies.some((c) => c.signed)) return false;
    if (opts.addedDay && !copies.some((c) => localDay(c.createdAt) === opts.addedDay)) return false;
    if (series && b.seriesName?.trim().toLowerCase() !== series) return false;
    if (wanted.length > 0) {
      const have = opts.tagsByBook?.get(b.id) ?? [];
      if (!wanted.every((t) => have.includes(t))) return false;
    }
    if (wantedLibrary.length > 0) {
      const have = opts.libraryTagsByBook?.get(b.id) ?? [];
      if (!wantedLibrary.every((t) => have.includes(t))) return false;
    }
    if (from !== null || to !== null) {
      const year = publishYear(b.publishDate);
      if (year === null) return false;
      if (from !== null && year < from) return false;
      if (to !== null && year > to) return false;
    }
    if (!q) return true;
    const notes = b.copies.flatMap((c) => (c.editionNote ? [c.editionNote] : []));
    return [b.title, ...b.authors, ...notes].some((s) => fold(s).includes(q));
  });
}
