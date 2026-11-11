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
