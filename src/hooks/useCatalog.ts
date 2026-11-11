import { useCallback, useEffect, useState } from "react";
import { useHousehold } from "@/contexts/HouseholdContext";
import { listBooks, listBookTags } from "@/lib/library-repo";
import type { BookWithCopies } from "@/lib/types";

const NO_TAGS: Map<string, string[]> = new Map();

export function useCatalog(): {
  books: BookWithCopies[];
  tags: Map<string, string[]>;
  loading: boolean;
  error: string | null;
  /** Tags load on their own: a failure (e.g. before the db push) never blocks the catalogue. */
  tagsError: string | null;
  reload(): Promise<void>;
} {
  const { household } = useHousehold();
  const householdId = household?.id ?? null;
  const [books, setBooks] = useState<BookWithCopies[]>([]);
  const [tags, setTags] = useState<Map<string, string[]>>(NO_TAGS);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tagsError, setTagsError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!householdId) {
      setBooks([]);
      setTags(NO_TAGS);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    setTagsError(null);
    const [booksResult, tagsResult] = await Promise.allSettled([listBooks(householdId), listBookTags(householdId)]);
    if (booksResult.status === "fulfilled") {
      setBooks(booksResult.value);
    } else {
      console.error("Failed to load catalog", booksResult.reason);
      setError("Couldn't load your books.");
    }
    if (tagsResult.status === "fulfilled") {
      setTags(tagsResult.value);
    } else {
      console.error("Failed to load book tags", tagsResult.reason);
      setTags(NO_TAGS);
      setTagsError("Tome of Secrets tags unavailable");
    }
    setLoading(false);
  }, [householdId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { books, tags, loading, error, tagsError, reload };
}
