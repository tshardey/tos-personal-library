import { useCallback, useEffect, useMemo, useState } from "react";
import { useHousehold } from "@/contexts/HouseholdContext";
import { useReading } from "@/contexts/ReadingContext";
import { useCatalog } from "@/hooks/useCatalog";
import { localDay } from "@/lib/date-added";
import { countUnmatchedHistory } from "@/lib/reading/reading-repo";
import HistoryUpload from "./HistoryUpload";
import PossibleMatches from "./PossibleMatches";
import ReadSummary from "./ReadSummary";
import ReadingStatsPanel from "./ReadingStatsPanel";

/** D10: `#/reading` — stats, StoryGraph upload, Possible matches, footnote. */
export default function ReadingHistoryPage() {
  const { available, loading, byBook, userId, reload } = useReading();
  const { household, members } = useHousehold();
  const { books, loading: catalogLoading } = useCatalog();
  const [refreshKey, setRefreshKey] = useState(0);
  const [unmatched, setUnmatched] = useState<number | null>(null);
  const householdId = household?.id ?? null;
  const today = useMemo(() => localDay(new Date().toISOString()), []);

  const refreshUnmatched = useCallback(async () => {
    if (householdId === null) return;
    try {
      setUnmatched(await countUnmatchedHistory(householdId));
    } catch (err) {
      console.error("Unmatched count failed", err instanceof Error ? err.name : "unknown");
    }
  }, [householdId]);

  useEffect(() => {
    if (available) void refreshUnmatched();
  }, [available, refreshUnmatched]);

  return (
    <section className="mx-auto max-w-3xl space-y-4 px-4 py-4 sm:px-6">
      <h2 className="text-xl font-semibold text-fg-strong">Reading history</h2>
      {!loading && !available && <p>Reading history isn't available yet.</p>}
      {available && householdId !== null && (
        <>
          {catalogLoading ? (
            <p>Loading…</p>
          ) : (
            <>
              <ReadSummary books={books} className="text-sm text-muted" />
              <ReadingStatsPanel books={books} byBook={byBook} members={members} me={userId} today={today} />
              <HistoryUpload
                householdId={householdId}
                onDone={() => {
                  void reload();
                  setRefreshKey((k) => k + 1);
                  void refreshUnmatched();
                }}
              />
              <PossibleMatches books={books} refreshKey={refreshKey} />
            </>
          )}
          {unmatched !== null && (
            <p className="text-sm text-muted">{`${unmatched} books from your history aren't on the shelf yet. They link by themselves when added.`}</p>
          )}
        </>
      )}
    </section>
  );
}
