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

/** Sorted union of existing and changed field names, without duplicates. */
export function markEdited(existing: string[], changed: string[]): string[] {
  return [...new Set([...existing, ...changed])].sort();
}
