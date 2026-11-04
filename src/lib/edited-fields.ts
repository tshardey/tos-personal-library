function same(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((v, i) => v === b[i]);
  }
  return a === b;
}

/** Keys whose values differ between before and after (arrays compared element-wise). */
export function changedFields<T>(before: T, after: T, keys: (keyof T)[]): string[] {
  return keys.filter((k) => !same(before[k], after[k])).map(String);
}

/** Changed keys plus a patch holding only those keys' new values. */
export function diffPatch<T>(
  before: T,
  after: T,
  keys: (keyof T)[],
): { changed: string[]; patch: Partial<T> } {
  const changedKeys = keys.filter((k) => !same(before[k], after[k]));
  const patch: Partial<T> = {};
  for (const k of changedKeys) patch[k] = after[k];
  return { changed: changedKeys.map(String), patch };
}

/** Sorted union of existing and changed field names, without duplicates. */
export function markEdited(existing: string[], changed: string[]): string[] {
  return [...new Set([...existing, ...changed])].sort();
}
