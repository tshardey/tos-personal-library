import { diffPatch } from "../edited-fields";
import { normalizeBookInput } from "../normalize";
import type { Book, BookInput } from "../types";

const FILL_KEYS = [
  "authors",
  "synopsis",
  "coverUrl",
  "isbn13",
  "isbn10",
  "pageCount",
  "publisher",
  "publishDate",
] as const satisfies readonly (keyof BookInput)[];

/** D4: fill only empty book fields (ISBNs union in), skipping fields the user edited. Never touches the title. */
export function fillPatch(
  book: Book,
  incoming: BookInput,
): { changed: string[]; patch: Partial<BookInput> } {
  const before = normalizeBookInput(book);
  const after: BookInput = { ...before };
  const target = after as unknown as Record<string, unknown>;
  const current = before as unknown as Record<string, unknown>;
  const next = incoming as unknown as Record<string, unknown>;
  for (const key of FILL_KEYS) {
    if (book.userEditedFields.includes(key)) continue;
    if (key === "isbn13" || key === "isbn10") {
      target[key] = [...new Set([...before[key], ...incoming[key]])];
      continue;
    }
    const value = current[key];
    if (value === null || (Array.isArray(value) && value.length === 0)) target[key] = next[key];
  }
  return diffPatch(before, after, [...FILL_KEYS]);
}
