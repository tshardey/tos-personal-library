import { useId, useMemo, useRef, useState } from "react";
import { useTagging } from "@/contexts/TaggingContext";
import { useCatalog } from "@/hooks/useCatalog";
import { seriesNames } from "@/lib/series";
import { SERIES_PER_BOOK_ESTIMATE_MICRO } from "@/lib/tagging/cost";
import { seriesEligible, seriesProgress } from "@/lib/tagging/eligibility";
import RetagConfirm from "./RetagConfirm";
import SeriesSuggestionItem from "./SeriesSuggestionItem";

/** D10: the Series section of `#/tags`: Find series behind a confirm step, then the pending suggestions. */
export default function SeriesSection() {
  const tagging = useTagging();
  const { books, refresh } = useCatalog();
  const { cards, jobs, budgets, seriesChecked, seriesSuggestions } = tagging;
  const headingId = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  const [message, setMessage] = useState<string | null>(null);

  const eligible = useMemo(() => seriesEligible(books, cards, seriesChecked, jobs), [books, cards, seriesChecked, jobs]);
  const progress = useMemo(() => seriesProgress(jobs), [jobs]);
  const names = useMemo(() => seriesNames(books), [books]);

  async function approve(id: string, name: string, volumes: Record<string, number | null>) {
    const n = await tagging.approveSeries(id, name, volumes);
    setMessage(`Added ${n} ${n === 1 ? "book" : "books"} to ${name}.`);
    void refresh();
    heading.current?.focus();
  }

  async function dismiss(id: string) {
    const name = seriesSuggestions.find((s) => s.id === id)?.name ?? "the series";
    await tagging.dismissSeries(id);
    setMessage(`Dismissed ${name}.`);
    heading.current?.focus();
  }

  return (
    <section aria-labelledby={headingId} className="space-y-2">
      <h3 id={headingId} ref={heading} tabIndex={-1} className="font-medium text-fg-strong">
        Series
      </h3>
      <p className="text-sm text-muted">
        New series names wait here for you. Series you already have are filled in by themselves.
      </p>
      <RetagConfirm
        label="Find series"
        bookIds={eligible}
        budget={budgets.tagging}
        onRetag={tagging.findSeries}
        perBookMicro={SERIES_PER_BOOK_ESTIMATE_MICRO}
        verb="Check"
        groupLabel="Confirm series check"
        queuedText={(n) => `Queued ${n} ${n === 1 ? "book" : "books"} for a series check.`}
        errorText="Couldn't queue the series check. Try again."
        emptyText="Every tagged book has been checked for a series."
      />
      {progress && (
        <p className="text-sm text-muted">
          {`Checked ${progress.done} of ${progress.total}. It carries on whenever either of you has the app open.`}
        </p>
      )}
      {message && (
        <p role="status" className="text-sm">
          {message}
        </p>
      )}
      {seriesSuggestions.length === 0 ? (
        <p className="text-sm text-muted">No series suggestions right now.</p>
      ) : (
        <ul className="space-y-2">
          {seriesSuggestions.map((s) => (
            <SeriesSuggestionItem
              key={s.id}
              suggestion={s}
              books={books}
              names={names}
              onApprove={approve}
              onDismiss={dismiss}
            />
          ))}
        </ul>
      )}
    </section>
  );
}
