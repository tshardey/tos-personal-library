import type { BookInput, CopyInput } from "./types";

/** Splits a comma-separated string into trimmed, non-empty items. */
export function splitList(s: string): string[] {
  return s
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
}

const text = (s: string | null): string | null => s?.trim() || null;
const items = (a: string[]): string[] => a.map((x) => x.trim()).filter(Boolean);

/** The single normalisation applied to book values: trim, blank to null, drop empty list items. */
export function normalizeBookInput(i: BookInput): BookInput {
  return {
    title: i.title.trim(),
    authors: items(i.authors),
    synopsis: text(i.synopsis),
    coverUrl: text(i.coverUrl),
    isbn13: items(i.isbn13),
    isbn10: items(i.isbn10),
    pageCount: i.pageCount,
    publisher: text(i.publisher),
    publishDate: text(i.publishDate),
  };
}

/** The single normalisation applied to copy values. */
export function normalizeCopyInput(i: CopyInput): CopyInput {
  return {
    ownerUserId: i.ownerUserId || null,
    editionNote: text(i.editionNote),
    location: text(i.location),
  };
}
