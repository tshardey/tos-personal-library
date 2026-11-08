import { EDITION_RE } from "./parse";

/** Shared normalisation: NFD, strip marks, lowercase, drop apostrophes, "&" to "and", non-letters/digits to spaces. */
export function baseNormalize(s: string): string {
  return s
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/['’‘]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function stripEdition(title: string): string {
  const m = EDITION_RE.exec(title);
  return m && title.slice(0, m.index).trim() ? title.slice(0, m.index) : title;
}

/** Comparable key for a title. "" means "nothing to match on": callers must not match on it. */
export function titleKey(title: string): string {
  const tokens = baseNormalize(stripEdition(title)).split(" ").filter(Boolean);
  if (tokens.length > 1 && ["the", "a", "an"].includes(tokens[0])) tokens.shift();
  return tokens.join(" ");
}

/** titleKey of the text before the first ":" or " - ". */
export function baseTitleKey(title: string): string {
  const i = title.search(/:| - /);
  return titleKey(i === -1 ? title : title.slice(0, i));
}

const isLetter = (t: string): boolean => [...t].length === 1 && /\p{L}/u.test(t);

/** Comparable key for a person's name; runs of single-letter tokens (initials) are joined. */
export function authorKey(name: string): string {
  const out: string[] = [];
  let prevInitial = false;
  for (const token of baseNormalize(name).split(" ").filter(Boolean)) {
    const initial = isLetter(token);
    if (initial && prevInitial) out[out.length - 1] += token;
    else out.push(token);
    prevInitial = initial;
  }
  return out.join(" ");
}

/** True when both lists are empty, or any non-empty author key is shared. */
export function authorsOverlap(a: string[], b: string[]): boolean {
  if (a.length === 0 && b.length === 0) return true;
  const keys = new Set(a.map(authorKey).filter(Boolean));
  return b.map(authorKey).some((k) => k !== "" && keys.has(k));
}
