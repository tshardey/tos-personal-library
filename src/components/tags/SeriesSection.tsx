import { useId, useMemo, useRef, useState } from "react";
import { useTagging } from "@/contexts/TaggingContext";
import { useCatalog } from "@/hooks/useCatalog";
import { seriesNames } from "@/lib/series";
import { AUDIT_PER_BOOK_ESTIMATE_MICRO, SERIES_PER_BOOK_ESTIMATE_MICRO } from "@/lib/tagging/cost";
import { auditEligible, auditRetryCount, auditText, seriesEligible, seriesProgress, seriesRetryCount } from "@/lib/tagging/eligibility";
import type { AuditDecision, SeriesAuditFlag, SeriesDismissal } from "@/lib/tagging/types";
import RetagConfirm from "./RetagConfirm";
import SeriesAuditCard from "./SeriesAuditCard";
import SeriesDismissedList from "./SeriesDismissedList";
import SeriesSuggestionItem from "./SeriesSuggestionItem";

/** D10: the Series section of `#/tags`: Find series behind a confirm step, then the pending suggestions. */
export default function SeriesSection() {
  const tagging = useTagging();
  const { books, refresh } = useCatalog();
  const { cards, jobs, budgets, seriesChecked, seriesSuggestions, auditAvailable, seriesAuditFlags, seriesAudited, seriesDismissals } = tagging;
  const headingId = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  const [message, setMessage] = useState<string | null>(null);

  const eligible = useMemo(() => seriesEligible(books, cards, seriesChecked, jobs), [books, cards, seriesChecked, jobs]);
  const retries = useMemo(() => seriesRetryCount(eligible, jobs), [eligible, jobs]);
  const progress = useMemo(() => seriesProgress(jobs), [jobs]);
  const names = useMemo(() => seriesNames(books), [books]);
  const auditable = useMemo(() => auditEligible(books, cards, seriesAudited, jobs), [books, cards, seriesAudited, jobs]);
  const auditRetries = useMemo(() => auditRetryCount(auditable, jobs), [auditable, jobs]);
  const auditRun = useMemo(() => seriesProgress(jobs, "audit"), [jobs]);
  const flagged = useMemo(() => {
    const byId = new Map(books.map((b) => [b.id, b]));
    return seriesAuditFlags.flatMap((flag) => {
      const book = byId.get(flag.bookId);
      return book ? [{ flag, book }] : [];
    });
  }, [books, seriesAuditFlags]);

  async function approve(id: string, name: string, volumes: Record<string, number | null>) {
    const n = await tagging.approveSeries(id, name, volumes);
    // Approving a new name with no book left to fill still records the mapping, so the name is applied from now on.
    const existing = seriesSuggestions.find((s) => s.id === id)?.kind === "existing";
    setMessage(
      n === 0 && !existing
        ? `Approved ${name}. No books were left to fill.`
        : `Added ${n} ${n === 1 ? "book" : "books"} to ${name}.`,
    );
    void refresh();
    heading.current?.focus();
  }

  async function dismiss(id: string) {
    const target = seriesSuggestions.find((s) => s.id === id);
    const name = target?.name ?? "the series";
    await tagging.dismissSeries(id);
    setMessage(target?.kind === "existing" ? `Dismissed ${name} for these books.` : `Dismissed ${name}.`);
    heading.current?.focus();
  }

  /** Reports a decision's answer, then moves focus to the heading. A rejected call is left for the card to show. */
  async function decide(flag: SeriesAuditFlag, title: string, run: () => Promise<AuditDecision>): Promise<AuditDecision> {
    const decision = await run();
    const lines: Record<AuditDecision, string> = {
      applied: `Changed ${title} to ${auditText(flag)}.`,
      kept: `Kept ${title} as it is.`,
      edited: `Saved the series for ${title}.`,
      stale: `${title}'s series changed since the audit. Nothing was changed.`,
      not_pending: `${title} was already settled.`,
    };
    setMessage(lines[decision]);
    if (decision === "applied" || decision === "edited") void refresh();
    heading.current?.focus();
    return decision;
  }

  async function undo(d: SeriesDismissal) {
    const answer = await tagging.undoDismissal(d);
    const book = d.kind === "book" ? books.find((b) => b.id === d.bookId) : undefined;
    const title = book?.title ?? "That book";
    // A deviation from D12: not_dismissed and not_eligible get their own lines, since nothing was put back.
    let line: string;
    if (answer === "restored") line = d.kind === "name" ? `Put ${d.name} back in the suggestions.` : `Put ${title} back in ${d.name}.`;
    else if (d.kind === "name") line = `${d.name} was already back.`;
    else if (answer === "not_dismissed") line = `${title} was already back in ${d.name}.`;
    else line = `${title} can't go back to ${d.name}.`;
    setMessage(line);
    heading.current?.focus();
  }

  return (
    <section aria-labelledby={headingId} className="space-y-2">
      <h3 id={headingId} ref={heading} tabIndex={-1} className="font-medium text-fg-strong">
        Series
      </h3>
      <p className="text-sm text-muted">
        New series names wait here for you. So does a book for a series you already have when none of its authors has a book in that series yet. Otherwise series you already have are filled in by themselves.
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
        note={
          retries === 0
            ? undefined
            : `Includes ${retries} ${retries === 1 ? "book" : "books"} whose last series check failed.`
        }
      />
      {progress && (
        <p className="text-sm text-muted">
          {`Checked ${progress.done} of ${progress.total}. It carries on whenever either of you has the app open.`}
        </p>
      )}
      {auditAvailable && (
        <>
          <p className="text-sm text-muted">
            Audit series checks the series the tagger filled in or you approved. It never changes a book by itself; anything that looks wrong waits below for you.
          </p>
          <RetagConfirm
            label="Audit series"
            bookIds={auditable}
            budget={budgets.tagging}
            onRetag={tagging.auditSeries}
            perBookMicro={AUDIT_PER_BOOK_ESTIMATE_MICRO}
            verb="Audit"
            groupLabel="Confirm series audit"
            queuedText={(n) => `Queued ${n} ${n === 1 ? "book" : "books"} for a series audit.`}
            errorText="Couldn't queue the series audit. Try again."
            emptyText="Every series has been audited, apart from the ones you set by hand."
            note={
              auditRetries === 0
                ? undefined
                : `Includes ${auditRetries} ${auditRetries === 1 ? "book" : "books"} whose last audit failed.`
            }
          />
          {auditRun && (
            <p className="text-sm text-muted">
              {`Audited ${auditRun.done} of ${auditRun.total}. It carries on whenever either of you has the app open.`}
            </p>
          )}
        </>
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
      {auditAvailable && flagged.length > 0 && (
        <div className="space-y-2">
          <h4 className="font-medium text-fg-strong">Check these series</h4>
          <ul className="space-y-2">
            {flagged.map(({ flag, book }) => (
              <SeriesAuditCard
                key={flag.id}
                flag={flag}
                book={book}
                names={names}
                onApply={(id) => decide(flag, book.title, () => tagging.applyAudit(id))}
                onKeep={(id) => decide(flag, book.title, () => tagging.keepAudit(id))}
                onEdit={(id, name, volume) => decide(flag, book.title, () => tagging.editAudit(id, name, volume))}
              />
            ))}
          </ul>
        </div>
      )}
      {auditAvailable && <SeriesDismissedList items={seriesDismissals} books={books} onUndo={undo} />}
    </section>
  );
}
