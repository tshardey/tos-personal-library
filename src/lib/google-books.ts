import { isbn10To13, normalizeIsbn10, normalizeIsbn13 } from "./libib/isbn";

/** What Google Books knows about one ISBN. Either field may be null. */
export interface GoogleBooksVolume {
  coverUrl: string | null;
  synopsis: string | null;
}

/** A failed Google Books request. The message never carries the request URL, so never the key. */
export class GoogleBooksError extends Error {
  status: number | null;
  constructor(status: number | null, message: string) {
    super(message);
    this.name = "GoogleBooksError";
    this.status = status;
  }
}

/** The browser-exposed Google Books key (HTTP-referrer restricted), or null when unset. */
export function googleBooksApiKey(): string | null {
  return import.meta.env.VITE_GOOGLE_BOOKS_API_KEY?.trim() || null;
}

interface VolumeInfo {
  industryIdentifiers?: unknown;
  imageLinks?: { thumbnail?: unknown; smallThumbnail?: unknown };
  description?: unknown;
}

/** True when the volume lists this ISBN-13, directly or as the matching ISBN-10. */
function hasIsbn(info: VolumeInfo, isbn13: string): boolean {
  if (!Array.isArray(info.industryIdentifiers)) return false;
  return info.industryIdentifiers.some((id: unknown) => {
    const raw = (id as { identifier?: unknown } | null)?.identifier;
    if (typeof raw !== "string") return false;
    const as13 = normalizeIsbn13(raw);
    if (as13 !== null) return as13 === isbn13;
    const as10 = normalizeIsbn10(raw);
    return as10 !== null && isbn10To13(as10) === isbn13;
  });
}

/** Thumbnail (or small thumbnail), forced to https, without the page-curl effect. */
export function coverOf(info: VolumeInfo): string | null {
  const links = info.imageLinks;
  const raw = [links?.thumbnail, links?.smallThumbnail].find(
    (v): v is string => typeof v === "string" && v.trim() !== "",
  );
  if (raw === undefined) return null;
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  url.protocol = "https:";
  url.searchParams.delete("edge");
  return url.toString();
}

const BLOCK_TAG = /<\s*\/?\s*(p|div|li|ul|ol|h[1-6]|blockquote|tr|table|section|article)\b[^>]*>/gi;

/**
 * The description as plain text: tags removed, entities decoded, spaces collapsed. A <br> is a
 * line break and a block tag (opening or closing) is a paragraph break. DOMParser documents are inert, so no
 * script runs and no image loads; <script> and <style> contents are dropped.
 */
export function plainText(html: string): string {
  const marked = html.replace(/<\s*br\b[^>]*>/gi, "\n").replace(BLOCK_TAG, "\n\n");
  const doc = new DOMParser().parseFromString(marked, "text/html");
  doc.querySelectorAll("script, style").forEach((el) => el.remove());
  const text = doc.body.textContent ?? "";
  return text
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function synopsisOf(info: VolumeInfo): string | null {
  if (typeof info.description !== "string") return null;
  const text = plainText(info.description);
  return text === "" ? null : text;
}

/** GET a Google Books URL as JSON. Errors never carry the URL, so never the key. */
async function getJson(url: string, fetchImpl: typeof fetch): Promise<unknown> {
  let res: Response;
  try {
    res = await fetchImpl(url, { signal: AbortSignal.timeout(60_000) });
  } catch (err) {
    const name = err instanceof Error ? err.name : "Error";
    throw new GoogleBooksError(null, `Google Books request failed (${name})`);
  }
  if (!res.ok) throw new GoogleBooksError(res.status, `Google Books answered ${res.status}`);
  try {
    return await res.json();
  } catch {
    throw new GoogleBooksError(res.status, "Google Books sent a reply that isn't JSON");
  }
}

/**
 * Looks up one ISBN-13. Returns the first volume that lists this ISBN (13 or 10), or null when
 * none does. Throws GoogleBooksError on an HTTP error or a network failure (including the 60 s
 * timeout).
 */
export async function lookupGoogleBooksIsbn(
  isbn13: string,
  key: string,
  fetchImpl: typeof fetch,
): Promise<GoogleBooksVolume | null> {
  const url =
    `https://www.googleapis.com/books/v1/volumes?q=isbn:${encodeURIComponent(isbn13)}` +
    `&key=${encodeURIComponent(key)}`;
  const data = await getJson(url, fetchImpl);
  const items = (data as { items?: unknown } | null)?.items;
  if (!Array.isArray(items)) return null;
  for (const item of items) {
    const info = (item as { volumeInfo?: unknown } | null)?.volumeInfo;
    if (!info || typeof info !== "object") continue;
    if (!hasIsbn(info as VolumeInfo, isbn13)) continue;
    return { coverUrl: coverOf(info as VolumeInfo), synopsis: synopsisOf(info as VolumeInfo) };
  }
  return null;
}

export interface GoogleBooksSearchHit {
  id: string;
  title: string | null;
  authors: string[];
  isbns: string[];
  coverUrl: string | null;
  synopsis: string | null;
  pageCount: number | null;
  publishDate: string | null;
  language: string | null;
}

const strOrNull = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v : null);

/** Maps one Google Books volume item to a hit; null when it is off-shape. */
function hitOf(item: unknown): GoogleBooksSearchHit | null {
  const id = (item as { id?: unknown } | null)?.id;
  const info = (item as { volumeInfo?: unknown } | null)?.volumeInfo;
  if (typeof id !== "string" || !info || typeof info !== "object") return null;
  const v = info as VolumeInfo & { title?: unknown; authors?: unknown; pageCount?: unknown; publishedDate?: unknown; language?: unknown };
  const isbns = new Set<string>();
  if (Array.isArray(v.industryIdentifiers)) {
    for (const ident of v.industryIdentifiers) {
      const raw = (ident as { identifier?: unknown } | null)?.identifier;
      if (typeof raw !== "string") continue;
      const as13 = normalizeIsbn13(raw);
      if (as13 !== null) {
        isbns.add(as13);
        continue;
      }
      const as10 = normalizeIsbn10(raw);
      if (as10 !== null) isbns.add(isbn10To13(as10));
    }
  }
  return {
    id,
    title: strOrNull(v.title),
    authors: Array.isArray(v.authors) ? v.authors.filter((a): a is string => typeof a === "string") : [],
    isbns: [...isbns],
    coverUrl: coverOf(v),
    synopsis: synopsisOf(v),
    pageCount: typeof v.pageCount === "number" && v.pageCount > 0 ? v.pageCount : null,
    publishDate: strOrNull(v.publishedDate),
    language: strOrNull(v.language),
  };
}

/**
 * Title (and optional author) search, up to 5 hits. Throws GoogleBooksError on an HTTP error or a
 * network failure; [] when Google has no items.
 */
export async function searchGoogleBooks(
  title: string,
  author: string | null,
  key: string,
  fetchImpl: typeof fetch,
  opts?: { langRestrict?: string; printType?: "books" },
): Promise<GoogleBooksSearchHit[]> {
  let q = `intitle:${encodeURIComponent(`"${title}"`)}`;
  if (author !== null && author.trim() !== "") q += `+inauthor:${encodeURIComponent(`"${author}"`)}`;
  let extra = "";
  if (opts?.langRestrict) extra += `&langRestrict=${encodeURIComponent(opts.langRestrict)}`;
  if (opts?.printType) extra += `&printType=${opts.printType}`;
  const url = `https://www.googleapis.com/books/v1/volumes?q=${q}&maxResults=5${extra}&key=${encodeURIComponent(key)}`;
  const data = await getJson(url, fetchImpl);
  const items = (data as { items?: unknown } | null)?.items;
  if (!Array.isArray(items)) return [];
  const hits: GoogleBooksSearchHit[] = [];
  for (const item of items) {
    const hit = hitOf(item);
    if (hit !== null) hits.push(hit);
  }
  return hits;
}

/**
 * Searches by ISBN-13 (q=isbn:). Returns the first hit that lists this ISBN (13 or 10), or null when
 * none does. Throws GoogleBooksError on an HTTP error or network failure.
 */
export async function searchGoogleBooksIsbn(
  isbn13: string,
  key: string,
  fetchImpl: typeof fetch,
): Promise<GoogleBooksSearchHit | null> {
  const url =
    `https://www.googleapis.com/books/v1/volumes?q=isbn:${encodeURIComponent(isbn13)}&maxResults=5` +
    `&key=${encodeURIComponent(key)}`;
  const data = await getJson(url, fetchImpl);
  const items = (data as { items?: unknown } | null)?.items;
  if (!Array.isArray(items)) return null;
  for (const item of items) {
    const hit = hitOf(item);
    if (hit !== null && hit.isbns.includes(isbn13)) return hit;
  }
  return null;
}
