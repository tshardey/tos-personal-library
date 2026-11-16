/** Lowercase with accents removed, so "Poète" and "poete" compare equal. */
export function fold(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

const STOPWORDS = new Set(["the", "a", "an"]);
const SPLIT = /[^\p{L}\p{N}]+/u;

/** Trigram similarity a typo'd search word needs with some word in the book. Tuned in search-words.test.ts. */
export const FUZZY_THRESHOLD = 0.45;
/** Shorter search words only match exactly: their few trigrams make fuzzy hits noise. */
const FUZZY_MIN_LENGTH = 4;

function words(folded: string): string[] {
  return folded.split(SPLIT).filter((w) => w !== "");
}

/**
 * The words of a typed search: folded, split on whitespace and punctuation, without "the", "a" and
 * "an". A search of only those words keeps them, so "the" still searches for "the". Blank gives [].
 */
export function searchWords(query: string): string[] {
  const all = words(fold(query));
  const kept = all.filter((w) => !STOPWORDS.has(w));
  return kept.length > 0 ? kept : all;
}

/** pg_trgm-style trigrams: the word padded with two spaces before and one after. */
function trigrams(word: string): Set<string> {
  const padded = `  ${word} `;
  const set = new Set<string>();
  for (let i = 0; i + 3 <= padded.length; i++) set.add(padded.slice(i, i + 3));
  return set;
}

/** Jaccard similarity of two trigram sets, |A∩B| / |A∪B|. */
function similarity(a: Set<string>, b: Set<string>): number {
  let shared = 0;
  for (const t of a) if (b.has(t)) shared++;
  return shared / (a.size + b.size - shared);
}

/**
 * True when every search word appears somewhere in the fields (title, authors, notes...), in any
 * order. A word matches as part of a longer word, so partial typing works; failing that, a word of
 * four or more letters matches a whole word in the fields whose trigram similarity reaches
 * FUZZY_THRESHOLD, so one typo still finds the book. No words matches everything.
 */
export function matchesSearchWords(query: string[], fields: string[]): boolean {
  if (query.length === 0) return true;
  const text = fields.map(fold).join("\n");
  let bookTrigrams: Set<string>[] | null = null;
  return query.every((w) => {
    if (text.includes(w)) return true;
    if (w.length < FUZZY_MIN_LENGTH) return false;
    bookTrigrams ??= [...new Set(words(text))].map(trigrams);
    const mine = trigrams(w);
    return bookTrigrams.some((t) => similarity(mine, t) >= FUZZY_THRESHOLD);
  });
}
