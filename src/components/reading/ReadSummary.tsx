import { useMemo } from "react";
import { useHousehold } from "@/contexts/HouseholdContext";
import { useReading } from "@/contexts/ReadingContext";
import { readCatalogCache } from "@/lib/catalog-cache";
import { localDay } from "@/lib/date-added";
import { readingStats } from "@/lib/reading/stats";
import type { BookWithCopies } from "@/lib/types";

/**
 * "You've read X of Y (Z%)" for the viewer (D7). Uses `books` when given, else the cached
 * catalogue (no fetch). Renders nothing when reading is unavailable, there is no catalogue,
 * or the member owns nothing.
 */
export default function ReadSummary({ books, className }: { books?: BookWithCopies[]; className?: string }) {
  const { household } = useHousehold();
  const { available, byBook, userId } = useReading();
  const summary = useMemo(() => {
    if (!available || userId === null) return null;
    const list = books ?? readCatalogCache(household?.id ?? null)?.books;
    if (!list) return null;
    const s = readingStats(list, byBook, userId, { today: localDay(new Date().toISOString()), since: null });
    return s.owned === 0 ? null : s;
  }, [available, byBook, userId, books, household?.id]);

  if (!summary) return null;
  return <p className={className}>{`You've read ${summary.read} of ${summary.owned} (${summary.pct}%)`}</p>;
}
