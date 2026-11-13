import type { BookWithCopies } from "@/lib/types";

/**
 * D9: the last catalogue loaded, so a return to the library renders at full height on its first
 * frame. In memory only. Kept apart from useCatalog (which re-exports clearCatalogCache) so that
 * AuthContext and the test setup can clear it without importing the data layer.
 */
export interface CatalogSnapshot {
  householdId: string;
  books: BookWithCopies[];
  tags: Map<string, string[]>;
}

let cache: CatalogSnapshot | null = null;

export function readCatalogCache(householdId: string | null): CatalogSnapshot | null {
  return householdId !== null && cache?.householdId === householdId ? cache : null;
}

export function writeCatalogCache(snapshot: CatalogSnapshot): void {
  cache = snapshot;
}

export function clearCatalogCache(): void {
  cache = null;
}
