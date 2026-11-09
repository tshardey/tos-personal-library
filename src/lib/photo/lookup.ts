import { GoogleBooksError, plainText, searchGoogleBooks } from "../google-books";
import { isbn10To13, normalizeIsbn10, normalizeIsbn13 } from "../libib/isbn";
import { authorsOverlap, titleKey } from "../libib/match-keys";
import type { LookupResult } from "./types";
import { trigramSimilarity } from "./similarity";

/** A lookup that couldn't complete. The caller pauses lookups on any of these. */
export class LookupError extends Error {
  retryable: boolean;
  constructor(message: string, retryable: boolean) {
    super(message);
    this.name = "LookupError";
    this.retryable = retryable;
  }
}

const TITLE_SIMILARITY = 0.6;
const MAX_MATCH_ISBNS = 100;
const TIMEOUT_MS = 60_000;

/** D8: equal titleKey or similarity >= 0.6, and authors overlap (or the photo had none). */
export function agrees(
  query: { title: string; authors: string[] },
  result: { title: string | null; authors: string[] },
): boolean {
  if (result.title === null) return false;
  const q = titleKey(query.title);
  const r = titleKey(result.title);
  if (q === "" || r === "") return false;
  if (q !== r && trigramSimilarity(q, r) < TITLE_SIMILARITY) return false;
  return query.authors.length === 0 || authorsOverlap(query.authors, result.authors);
}

/**
 * The agreeing result to adopt: an exact titleKey match first, then the highest similarity, then
 * the earliest. The first agreeing one may be a fuzzy sibling listed ahead of the exact volume.
 */
function bestAgreeing<T>(
  query: { title: string; authors: string[] },
  list: T[],
  view: (t: T) => { title: string | null; authors: string[] } | null,
): T | null {
  const q = titleKey(query.title);
  let best: { value: T; exact: boolean; score: number } | null = null;
  for (const value of list) {
    const v = view(value);
    if (v === null || v.title === null || !agrees(query, v)) continue;
    const r = titleKey(v.title);
    const exact = r === q;
    const score = exact ? 1 : trigramSimilarity(q, r);
    if (best === null || (exact && !best.exact) || (exact === best.exact && score > best.score)) {
      best = { value, exact, score };
    }
  }
  return best === null ? null : best.value;
}

const retryableStatus = (s: number) => s === 429 || s >= 500;

async function getJson(url: string, fetchImpl: typeof fetch): Promise<unknown> {
  let res: Response;
  try {
    res = await fetchImpl(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (err) {
    const name = err instanceof Error ? err.name : "Error";
    throw new LookupError(`OpenLibrary request failed (${name})`, true);
  }
  if (!res.ok) throw new LookupError(`OpenLibrary answered ${res.status}`, retryableStatus(res.status));
  try {
    return await res.json();
  } catch {
    throw new LookupError("OpenLibrary sent a reply that isn't JSON", false);
  }
}

const strings = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];

function matchIsbnsOf(raw: unknown): string[] {
  const out = new Set<string>();
  for (const value of strings(raw)) {
    const as13 = normalizeIsbn13(value);
    if (as13 !== null) {
      out.add(as13);
    } else {
      const as10 = normalizeIsbn10(value);
      if (as10 !== null) out.add(isbn10To13(as10));
    }
    if (out.size >= MAX_MATCH_ISBNS) break;
  }
  return [...out];
}

function descriptionOf(work: unknown): string | null {
  const d = (work as { description?: unknown } | null)?.description;
  const text = typeof d === "string" ? d : (d as { value?: unknown } | null)?.value;
  if (typeof text !== "string") return null;
  const plain = plainText(text);
  return plain === "" ? null : plain;
}

const empty = (over: Partial<LookupResult> = {}): LookupResult => ({
  source: "none",
  agrees: false,
  title: null,
  authors: [],
  matchIsbns: [],
  coverUrl: null,
  synopsis: null,
  pageCount: null,
  publishDate: null,
  openlibraryId: null,
  googleBooksId: null,
  ...over,
});

interface OlDoc {
  key?: unknown;
  title?: unknown;
  author_name?: unknown;
  isbn?: unknown;
  cover_i?: unknown;
  number_of_pages_median?: unknown;
  first_publish_year?: unknown;
}

async function fromOpenLibraryDoc(d: OlDoc, title: string, fetchImpl: typeof fetch): Promise<LookupResult> {
  const workKey = typeof d.key === "string" && d.key.startsWith("/works/") ? d.key : null;
  let synopsis: string | null = null;
  if (workKey !== null) {
    try {
      const res = await fetchImpl(`https://openlibrary.org${workKey}.json`, {
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (res.ok) synopsis = descriptionOf(await res.json());
    } catch {
      synopsis = null;
    }
  }
  return empty({
    source: "openlibrary",
    agrees: true,
    title,
    authors: strings(d.author_name),
    matchIsbns: matchIsbnsOf(d.isbn),
    coverUrl: typeof d.cover_i === "number" && d.cover_i > 0 ? `https://covers.openlibrary.org/b/id/${d.cover_i}-L.jpg` : null,
    synopsis,
    pageCount: typeof d.number_of_pages_median === "number" && d.number_of_pages_median > 0 ? d.number_of_pages_median : null,
    publishDate: typeof d.first_publish_year === "number" ? String(d.first_publish_year) : null,
    openlibraryId: workKey === null ? null : workKey.slice("/works/".length),
  });
}

export async function lookupMetadata(
  query: { title: string; authors: string[] },
  opts: { fetchImpl: typeof fetch; googleBooksKey: string | null },
): Promise<LookupResult> {
  const { fetchImpl, googleBooksKey } = opts;
  const author = query.authors[0];
  let url = `https://openlibrary.org/search.json?title=${encodeURIComponent(query.title)}`;
  if (author !== undefined && author.trim() !== "") url += `&author=${encodeURIComponent(author)}`;
  url += "&limit=5&fields=key,title,author_name,isbn,cover_i,number_of_pages_median,first_publish_year";

  const data = await getJson(url, fetchImpl);
  const docs = Array.isArray((data as { docs?: unknown } | null)?.docs) ? ((data as { docs: OlDoc[] }).docs) : [];
  const olView = (d: OlDoc) =>
    !d || typeof d !== "object"
      ? null
      : { title: typeof d.title === "string" ? d.title : null, authors: strings(d.author_name) };
  const olBest = bestAgreeing(query, docs, olView);
  if (olBest !== null) return fromOpenLibraryDoc(olBest, olView(olBest)!.title!, fetchImpl);
  let bestMiss: { title: string; authors: string[] } | null = null;
  for (const d of docs) {
    const v = olView(d);
    if (v !== null && v.title !== null) {
      bestMiss = { title: v.title, authors: v.authors };
      break;
    }
  }

  if (googleBooksKey !== null) {
    let hits;
    try {
      hits = await searchGoogleBooks(query.title, author ?? null, googleBooksKey, fetchImpl);
    } catch (err) {
      if (err instanceof GoogleBooksError) {
        throw new LookupError(err.message, err.status === null || retryableStatus(err.status));
      }
      throw err;
    }
    const h = bestAgreeing(query, hits, (x) => x);
    if (h !== null && h.title !== null) {
      return empty({
        source: "google",
        agrees: true,
        title: h.title,
        authors: h.authors,
        matchIsbns: h.isbns.slice(0, MAX_MATCH_ISBNS),
        coverUrl: h.coverUrl,
        synopsis: h.synopsis,
        pageCount: h.pageCount,
        publishDate: h.publishDate,
        googleBooksId: h.id,
      });
    }
    const miss = hits.find((x) => x.title !== null);
    if (bestMiss === null && miss) bestMiss = { title: miss.title!, authors: miss.authors };
  }

  return empty(bestMiss ?? {});
}
