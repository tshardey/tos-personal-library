import { useCallback, useEffect, useRef, useState } from "react";
import { useHousehold } from "@/contexts/HouseholdContext";
import { readCatalogCache, writeCatalogCache } from "@/lib/catalog-cache";
import { listBooks, listBookTags } from "@/lib/library-repo";
import type { BookWithCopies } from "@/lib/types";

export { clearCatalogCache } from "@/lib/catalog-cache";

const NO_TAGS: Map<string, string[]> = new Map();

export function useCatalog(): {
  books: BookWithCopies[];
  tags: Map<string, string[]>;
  loading: boolean;
  error: string | null;
  /** Tags load on their own: a failure (e.g. before the db push) never blocks the catalogue. */
  tagsError: string | null;
  reload(): Promise<void>;
  /** Reloads behind what is shown (no Loading); resolves false when the books couldn't be read. */
  refresh(): Promise<boolean>;
} {
  const { household } = useHousehold();
  const householdId = household?.id ?? null;
  // D9: a mount with a cache for this household starts from it, with no Loading screen.
  const [books, setBooks] = useState<BookWithCopies[]>(() => readCatalogCache(householdId)?.books ?? []);
  const [tags, setTags] = useState<Map<string, string[]>>(() => readCatalogCache(householdId)?.tags ?? NO_TAGS);
  const [loading, setLoading] = useState(() => readCatalogCache(householdId) === null);
  const [error, setError] = useState<string | null>(null);
  const [tagsError, setTagsError] = useState<string | null>(null);
  const tagsRef = useRef(tags);

  /** `background`: keep what is shown (no Loading), and keep it if the refresh fails. */
  const load = useCallback(
    async (background: boolean): Promise<boolean> => {
      if (!householdId) {
        setBooks([]);
        setTags(NO_TAGS);
        setLoading(false);
        return true;
      }
      if (!background) {
        setLoading(true);
        setError(null);
      }
      setTagsError(null);
      const [booksResult, tagsResult] = await Promise.allSettled([listBooks(householdId), listBookTags(householdId)]);
      let nextTags = NO_TAGS;
      if (tagsResult.status === "fulfilled") {
        nextTags = tagsResult.value;
      } else {
        const reason: unknown = tagsResult.reason;
        console.error(
          "Failed to load book tags",
          reason instanceof Error ? reason.name : ((reason as { code?: string } | null)?.code ?? "unknown"),
        );
        setTagsError("Tome of Secrets tags unavailable");
        // A background refresh keeps the tags already shown (or cached) rather than dropping them.
        if (background) nextTags = tagsRef.current;
      }
      tagsRef.current = nextTags;
      setTags(nextTags);
      if (booksResult.status === "fulfilled") {
        setBooks(booksResult.value);
        setError(null);
        writeCatalogCache({ householdId, books: booksResult.value, tags: nextTags });
      } else {
        const reason: unknown = booksResult.reason;
        console.error(
          "Failed to load catalog",
          reason instanceof Error ? reason.name : ((reason as { code?: string } | null)?.code ?? "unknown"),
        );
        if (!background) setError("Couldn't load your books.");
      }
      setLoading(false);
      return booksResult.status === "fulfilled";
    },
    [householdId],
  );

  const reload = useCallback(async () => {
    await load(false);
  }, [load]);
  const refresh = useCallback(() => load(true), [load]);

  useEffect(() => {
    const hit = readCatalogCache(householdId);
    if (hit) {
      // The same arrays on a fresh mount (no re-render); another household's cache on a switch.
      setBooks(hit.books);
      tagsRef.current = hit.tags;
      setTags(hit.tags);
      setLoading(false);
    }
    void load(hit !== null);
  }, [load, householdId]);

  return { books, tags, loading, error, tagsError, reload, refresh };
}
