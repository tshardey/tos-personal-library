import { publishYear } from "./publish-year";
import type { BookWithCopies } from "./types";

export type SortKey = "title" | "author" | "added" | "published";

export const SORT_KEYS: readonly SortKey[] = ["title", "author", "added", "published"];

export const SORT_LABELS: Record<SortKey, string> = {
  title: "Title",
  author: "Author",
  added: "Recently added",
  published: "Published (newest first)",
};

const collator = new Intl.Collator(undefined, { sensitivity: "base", numeric: true });

const SUFFIX = /^(jr|sr|ii|iii|iv)\.?$/i;

/** The surname key: the last whitespace token, skipping a trailing Jr/Sr/II/III/IV. */
export function authorSortKey(name: string): string {
  const tokens = name.trim().split(/\s+/).filter(Boolean);
  while (tokens.length > 1 && SUFFIX.test(tokens[tokens.length - 1])) tokens.pop();
  return (tokens[tokens.length - 1] ?? "").toLowerCase();
}

function newestAdded(b: BookWithCopies): string {
  return b.copies.reduce((m, c) => (c.createdAt > m ? c.createdAt : m), b.copies.length ? "" : b.createdAt);
}

/** year*10000 + month*100 + day, with missing month/day as 0; null when there is no year. */
function publishedRank(b: BookWithCopies): number | null {
  const year = publishYear(b.publishDate);
  if (year === null) return null;
  const m = /^(\d{4})-(\d{2})(?:-(\d{2}))?/.exec(b.publishDate ?? "");
  const month = m ? Number(m[2]) : 0;
  const day = m?.[3] ? Number(m[3]) : 0;
  return year * 10000 + month * 100 + day;
}

/** D5. Never mutates; ties keep catalogue order (Array.prototype.sort is stable). */
export function sortBooks(
  books: BookWithCopies[],
  sort: SortKey,
  opts: { series?: string | null } = {},
): BookWithCopies[] {
  const out = [...books];
  if (opts.series) {
    return out.sort(
      (a, b) =>
        (a.seriesVolume ?? Infinity) - (b.seriesVolume ?? Infinity) || a.title.localeCompare(b.title),
    );
  }
  switch (sort) {
    case "title":
      return out;
    case "author":
      return out.sort((a, b) => {
        const ka = a.authors[0] ? authorSortKey(a.authors[0]) : null;
        const kb = b.authors[0] ? authorSortKey(b.authors[0]) : null;
        if (ka === null || kb === null) return ka === kb ? 0 : ka === null ? 1 : -1;
        return collator.compare(ka, kb) || a.title.localeCompare(b.title);
      });
    case "added":
      return out.sort((a, b) => {
        const na = newestAdded(a);
        const nb = newestAdded(b);
        return na === nb ? 0 : na < nb ? 1 : -1;
      });
    case "published":
      return out.sort((a, b) => {
        const ra = publishedRank(a);
        const rb = publishedRank(b);
        if (ra === null || rb === null) return ra === rb ? 0 : ra === null ? 1 : -1;
        return rb - ra;
      });
  }
}
