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
  let res: Response;
  try {
    res = await fetchImpl(url, { signal: AbortSignal.timeout(60_000) });
  } catch (err) {
    const name = err instanceof Error ? err.name : "Error";
    throw new GoogleBooksError(null, `Google Books request failed (${name})`);
  }
  if (!res.ok) throw new GoogleBooksError(res.status, `Google Books answered ${res.status}`);
  let data: unknown;
  try {
    data = await res.json();
  } catch {
    throw new GoogleBooksError(res.status, "Google Books sent a reply that isn't JSON");
  }
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
