import { coverOf, searchGoogleBooks } from "../google-books";
import { canonicalIsbns, normalizeIsbn13 } from "../libib/isbn";
import { authorsOverlap } from "../libib/match-keys";
import { agrees, LookupError } from "../photo/lookup";
import { sizeOk, type MeasureImage } from "./measure";
import type { CoverCandidate, CoverSearchBook } from "./types";

export const MAX_CANDIDATES = 6;
export const MAX_MEASURED = 8;
export const MAX_OPENLIBRARY = 5;
export const MAX_GOOGLE = 2;

/** record_cover_candidates refuses a longer edition title. */
const MAX_EDITION_TITLE = 200;
const TIMEOUT_MS = 60_000;
const MAX_WORKS = 2;

export interface RawCandidate {
  url: string;
  source: "openlibrary" | "google";
  language: "en" | null;
  editionTitle: string | null;
  isbnMatch: boolean;
}

const retryableStatus = (s: number) => s === 429 || s >= 500;

/** GET JSON from OpenLibrary. Errors never carry the URL. */
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

interface OlWork {
  key?: unknown;
  author_name?: unknown;
  author_alternative_name?: unknown;
}

interface OlEdition {
  title?: unknown;
  subtitle?: unknown;
  covers?: unknown;
  languages?: unknown;
  isbn_13?: unknown;
}

/** A work's authors: the listed names plus their alternative spellings (other scripts). */
const workAuthorsOf = (w: OlWork): string[] => [...strings(w.author_name), ...strings(w.author_alternative_name)];

function editionTitleOf(e: OlEdition): string | null {
  if (typeof e.title !== "string" || e.title.trim() === "") return null;
  return typeof e.subtitle === "string" && e.subtitle.trim() !== "" ? `${e.title}: ${e.subtitle}` : e.title;
}

/** English when listed; an absent or empty list is unknown; any other language is "other". */
function languageOf(e: OlEdition): "en" | null | "other" {
  if (!Array.isArray(e.languages) || e.languages.length === 0) return null;
  const english = e.languages.some((l) => (l as { key?: unknown } | null)?.key === "/languages/eng");
  return english ? "en" : "other";
}

export async function openLibraryCandidates(
  book: CoverSearchBook,
  fetchImpl: typeof fetch,
): Promise<RawCandidate[]> {
  const author = book.authors[0];
  let url = `https://openlibrary.org/search.json?q=${encodeURIComponent(book.title)}`;
  if (author !== undefined && author.trim() !== "") url += `&author=${encodeURIComponent(author)}`;
  url += "&limit=5&fields=key,title,author_name,author_alternative_name,cover_i,language";

  const data = await getJson(url, fetchImpl);
  const docs = (Array.isArray((data as { docs?: unknown } | null)?.docs) ? (data as { docs: unknown[] }).docs : []).filter(
    (d): d is OlWork => !!d && typeof d === "object",
  );
  const works = docs
    .filter((d) => book.authors.length === 0 || authorsOverlap(book.authors, workAuthorsOf(d)))
    .slice(0, MAX_WORKS);

  const isbns = canonicalIsbns(book);
  const out: RawCandidate[] = [];
  for (const w of works) {
    if (typeof w.key !== "string" || !w.key.startsWith("/works/")) continue;
    let data2: unknown;
    try {
      data2 = await getJson(`https://openlibrary.org${w.key}/editions.json?limit=1000`, fetchImpl);
    } catch (err) {
      if (err instanceof LookupError && !err.retryable) continue;
      throw err;
    }
    const entries = (data2 as { entries?: unknown } | null)?.entries;
    if (!Array.isArray(entries)) continue;
    const workAuthors = workAuthorsOf(w);
    for (const raw of entries) {
      if (!raw || typeof raw !== "object") continue;
      const e = raw as OlEdition;
      const cover = Array.isArray(e.covers) ? e.covers[0] : undefined;
      if (typeof cover !== "number" || !(cover > 0)) continue;
      const title = editionTitleOf(e);
      // editions.json has no author names, so the work's authors stand in (D4).
      if (!agrees({ title: book.title, authors: book.authors }, { title, authors: workAuthors })) continue;
      const language = languageOf(e);
      if (language === "other") continue;
      const isbnMatch = strings(e.isbn_13).some((i) => {
        const n = normalizeIsbn13(i);
        return n !== null && isbns.has(n);
      });
      out.push({
        url: `https://covers.openlibrary.org/b/id/${cover}-L.jpg`,
        source: "openlibrary",
        language,
        editionTitle: title,
        isbnMatch,
      });
    }
    // The work's own cover_i is only ever the cover of an edition already kept above, so it adds nothing.
  }
  return out;
}

export async function googleCandidates(
  book: CoverSearchBook,
  key: string,
  fetchImpl: typeof fetch,
): Promise<RawCandidate[]> {
  try {
    const hits = await searchGoogleBooks(book.title, book.authors[0] ?? null, key, fetchImpl, { langRestrict: "en" });
    const out: RawCandidate[] = [];
    for (const h of hits) {
      if (h.language !== "en") continue;
      if (!agrees({ title: book.title, authors: book.authors }, { title: h.title, authors: h.authors })) continue;
      const cover = coverOf({ imageLinks: { thumbnail: h.coverUrl } });
      if (cover === null) continue;
      const u = new URL(cover);
      u.searchParams.set("fife", "w800");
      out.push({ url: u.toString(), source: "google", language: "en", editionTitle: h.title, isbnMatch: false });
    }
    return out.slice(0, MAX_GOOGLE);
  } catch {
    return [];
  }
}

const rank = (c: RawCandidate): number => {
  if (c.source === "google") return 3;
  if (c.isbnMatch) return 0;
  return c.language === "en" ? 1 : 2;
};

/** D4 step 4: ISBN match, English, unknown, Google; capped per source; deduplicated; not the current cover. */
export function orderCandidates(raw: RawCandidate[], currentCover: string | null): RawCandidate[] {
  const sorted = raw
    .map((c, i) => ({ c, i }))
    .sort((a, b) => rank(a.c) - rank(b.c) || a.i - b.i)
    .map((x) => x.c);
  const seen = new Set<string>();
  let ol = 0;
  let g = 0;
  const out: RawCandidate[] = [];
  for (const c of sorted) {
    if (c.url === currentCover || seen.has(c.url)) continue;
    if (c.source === "openlibrary") {
      if (ol >= MAX_OPENLIBRARY) continue;
      ol += 1;
    } else {
      if (g >= MAX_GOOGLE) continue;
      g += 1;
    }
    seen.add(c.url);
    out.push(c);
  }
  return out;
}

export async function gatherCandidates(
  book: CoverSearchBook,
  deps: { fetchImpl: typeof fetch; googleKey: string | null; measure: MeasureImage },
): Promise<CoverCandidate[]> {
  const raw = await openLibraryCandidates(book, deps.fetchImpl);
  if (deps.googleKey !== null) raw.push(...(await googleCandidates(book, deps.googleKey, deps.fetchImpl)));
  const ordered = orderCandidates(raw, book.coverUrl).slice(0, MAX_MEASURED);
  const sizes = await Promise.all(ordered.map((c) => deps.measure(c.url)));
  const out: CoverCandidate[] = [];
  ordered.forEach((c, i) => {
    const size = sizes[i];
    if (size === null || !sizeOk(size) || out.length >= MAX_CANDIDATES) return;
    out.push({
      url: c.url,
      source: c.source,
      width: size.width,
      height: size.height,
      language: c.language,
      editionTitle: c.editionTitle === null ? null : c.editionTitle.slice(0, MAX_EDITION_TITLE),
    });
  });
  return out;
}
