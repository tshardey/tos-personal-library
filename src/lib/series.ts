import type { SeriesSuggestion } from "@/lib/tagging/types";
import type { Book } from "@/lib/types";

/** The books.series_name column limit (D5). */
export const MAX_SERIES = 200;

function key(s: string): string {
  return s.toLowerCase();
}

/** Household series names, following editionLabels' rules: trim, case-insensitive groups, most-used spelling, sorted. */
export function seriesNames(books: Book[]): string[] {
  const groups = new Map<string, Map<string, number>>();
  for (const book of books) {
    const name = (book.seriesName ?? "").trim();
    if (name === "" || name.length > MAX_SERIES) continue;
    const spellings = groups.get(key(name)) ?? new Map<string, number>();
    spellings.set(name, (spellings.get(name) ?? 0) + 1);
    groups.set(key(name), spellings);
  }
  const names = [...groups.values()].map(
    (spellings) => [...spellings.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0],
  );
  return names.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
}

/** The series to store for typed text: the existing spelling on a case-insensitive hit, else the trimmed text. */
export function canonicalSeries(typed: string, names: string[]): string | null {
  const text = typed.trim();
  if (text === "" || text.length > MAX_SERIES) return null;
  return names.find((n) => key(n) === key(text)) ?? text;
}

/** null for blank text; undefined for text that is not a valid volume (0 to 9999.5). */
export function parseVolume(text: string): number | null | undefined {
  if (text.trim() === "") return null;
  const n = Number(text);
  return Number.isFinite(n) && n >= 0 && n <= 9999.5 ? n : undefined;
}

/** True when the member set the book's series name or volume by hand, so a suggestion must not overwrite it. */
export function isSeriesHandSet(book: Pick<Book, "userEditedFields">): boolean {
  return book.userEditedFields.includes("seriesName") || book.userEditedFields.includes("seriesVolume");
}

/** Volume ascending, then books with no volume; each group by title (numbers in order), then book id. */
export function sortSeriesTargets<T extends { book: { id: string; title: string }; volume: number | null }>(targets: T[]): T[] {
  return [...targets].sort((a, b) => {
    if ((a.volume === null) !== (b.volume === null)) return a.volume === null ? 1 : -1;
    if (a.volume !== null && b.volume !== null && a.volume !== b.volume) return a.volume - b.volume;
    return (
      a.book.title.localeCompare(b.book.title, undefined, { sensitivity: "base", numeric: true }) ||
      (a.book.id < b.book.id ? -1 : a.book.id > b.book.id ? 1 : 0)
    );
  });
}

/** The books a suggestion would fill: still present, no series, not hand-set, sorted by sortSeriesTargets. */
export function seriesFillTargets(
  s: SeriesSuggestion,
  books: Book[],
): { book: Book; volume: number | null; why: string | null }[] {
  const byId = new Map(books.map((b) => [b.id, b]));
  const out: { book: Book; volume: number | null; why: string | null }[] = [];
  for (const entry of s.books) {
    const book = byId.get(entry.bookId);
    if (book && book.seriesName === null && !isSeriesHandSet(book)) {
      out.push({ book, volume: entry.volume, why: entry.why });
    }
  }
  return sortSeriesTargets(out);
}

/** The existing spelling when the trimmed text matches a name only by case (canonicalSeries' rule); else null. */
export function joinsExisting(typed: string, names: string[]): string | null {
  const text = typed.trim();
  const hit = names.find((n) => key(n) === key(text));
  return hit !== undefined && hit !== text ? hit : null;
}
