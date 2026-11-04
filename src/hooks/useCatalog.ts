import { useCallback, useEffect, useState } from "react";
import { useHousehold } from "@/contexts/HouseholdContext";
import { listBooks } from "@/lib/library-repo";
import type { BookWithCopies } from "@/lib/types";

export function useCatalog(): {
  books: BookWithCopies[];
  loading: boolean;
  error: string | null;
  reload(): Promise<void>;
} {
  const { household } = useHousehold();
  const householdId = household?.id ?? null;
  const [books, setBooks] = useState<BookWithCopies[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!householdId) {
      setBooks([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      setBooks(await listBooks(householdId));
    } catch (err) {
      console.error("Failed to load catalog", err);
      setError("Couldn't load your books.");
    } finally {
      setLoading(false);
    }
  }, [householdId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { books, loading, error, reload };
}
