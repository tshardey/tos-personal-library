import { useId, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui";
import { useCoverFinder } from "@/contexts/CoverFinderContext";
import { booksCovered, budgetUsedUp, estimateMicro } from "@/lib/covers/cost";
import { selectionTargets } from "@/lib/covers/eligibility";
import { COVER_REASONS, MAX_NOTE, REASON_LABELS, type CoverReason } from "@/lib/covers/types";
import { booksWord, estimateText } from "@/lib/covers/batch-text";
import type { BookWithCopies } from "@/lib/types";

const isAre = (n: number) => (n === 1 ? "is" : "are");

/**
 * Edit selected's Covers section: one set of reasons and note for every selected book, then
 * Add to batch (marks) or Find covers now (behind a confirm). Books follow the batch rules:
 * unhauled, already-open and nothing-found books are left out, and the confirm can retry the
 * nothing-found ones explicitly, as the single book's Try again does.
 */
export default function MassCoverSection({ selected, disabled = false }: { selected: BookWithCopies[]; disabled?: boolean }) {
  const { available, marks, latest, budget, markMany, findMany } = useCoverFinder();
  const [reasons, setReasons] = useState<CoverReason[]>([]);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [retry, setRetry] = useState(false);
  const [marked, setMarked] = useState<number | null>(null);
  const [markFailed, setMarkFailed] = useState(0);
  const [kept, setKept] = useState(0);
  const [queued, setQueued] = useState<number | null>(null);
  const [findFailed, setFindFailed] = useState(false);
  const inFlight = useRef(false);
  const headingId = useId();

  const t = useMemo(() => selectionTargets(selected, latest), [selected, latest]);
  const usedUp = budget !== null && budgetUsedUp(budget);
  const findCount = t.eligible.length + (retry ? t.nothingFound.length : 0);
  const covered = budget !== null && !usedUp ? booksCovered(budget) : null;
  const off = disabled || busy;
  // A blank mark (nothing ticked or typed) would wipe a book's own reasons and note, so it only marks unmarked books.
  const blank = reasons.length === 0 && note.trim() === "";
  const toMark = blank ? t.eligible.filter((id) => !marks.has(id)) : t.eligible;

  if (!available) return null;

  const sentNote = () => (note.trim() === "" ? null : note.trim());

  function clearMessages() {
    setMarked(null);
    setMarkFailed(0);
    setKept(0);
    setQueued(null);
    setFindFailed(false);
  }

  function toggle(r: CoverReason) {
    setReasons((prev) => (prev.includes(r) ? prev.filter((x) => x !== r) : [...prev, r]));
  }

  async function once(action: () => Promise<void>) {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    clearMessages();
    try {
      await action();
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  const addToBatch = () =>
    once(async () => {
      try {
        setKept(t.eligible.length - toMark.length);
        const out = await markMany(toMark, reasons, sentNote());
        setMarked(out.marked);
        setMarkFailed(out.failed);
      } catch (err) {
        console.error("Cover mark failed", err instanceof Error ? err.name : "unknown");
        setMarkFailed(toMark.length);
      }
    });

  const findNow = () =>
    once(async () => {
      try {
        const out = await findMany(t.eligible, retry ? t.nothingFound : [], reasons, sentNote());
        setQueued(out.queued);
        setConfirming(false);
        setRetry(false);
      } catch (err) {
        console.error("Cover request failed", err instanceof Error ? err.name : "unknown");
        setFindFailed(true);
      }
    });

  return (
    <section aria-labelledby={headingId} className="mt-3 space-y-2 text-sm">
      <h3 id={headingId} className="text-sm font-medium">
        Covers
      </h3>
      <p className="text-xs text-muted">Applies to every selected book.</p>
      <div className="flex flex-wrap gap-2">
        {COVER_REASONS.map((r) => (
          <button
            key={r}
            type="button"
            disabled={off}
            aria-pressed={reasons.includes(r)}
            onClick={() => toggle(r)}
            className={`min-h-11 rounded-full border px-3 py-1 disabled:opacity-50 sm:min-h-9 ${
              reasons.includes(r) ? "border-accent bg-accent text-on-accent" : "border-field bg-raised"
            }`}
          >
            {REASON_LABELS[r]}
          </button>
        ))}
      </div>
      <label className="block">
        <span className="block">What's wrong? (optional)</span>
        <textarea
          value={note}
          disabled={off}
          maxLength={MAX_NOTE}
          placeholder="e.g. this is the Spanish edition"
          onChange={(e) => setNote(e.target.value)}
          className="mt-1 w-full rounded border border-field p-2"
          rows={2}
        />
      </label>
      <div className="space-y-0.5 text-muted">
        {t.unhauled.length > 0 && <p>{`${t.unhauled.length} not on the shelf ${isAre(t.unhauled.length)} left out.`}</p>}
        {t.alreadyOpen.length > 0 && <p>{`${t.alreadyOpen.length} already being searched.`}</p>}
        {t.nothingFound.length > 0 && (
          <p>{`${t.nothingFound.length} tried before with nothing found ${isAre(t.nothingFound.length)} left out of Add to batch.`}</p>
        )}
        {usedUp && <p>This month's cover-finding budget is used up.</p>}
      </div>
      {!confirming && (
        <div className="flex flex-wrap gap-2">
          <Button disabled={off || toMark.length === 0} onClick={() => void addToBatch()}>
            Add to batch
          </Button>
          <Button
            disabled={off || usedUp || t.eligible.length + t.nothingFound.length === 0}
            onClick={() => {
              clearMessages();
              setConfirming(true);
            }}
          >
            Find covers now
          </Button>
        </div>
      )}
      {confirming && (
        <div role="group" aria-label="Confirm find covers" className="space-y-2 rounded-md border border-line bg-raised p-2">
          <p className="font-medium">{`Find covers for ${booksWord(findCount)} · ${estimateText(estimateMicro(findCount))}`}</p>
          {covered !== null && covered < findCount && (
            <p>{`This month's budget covers about ${covered} of these ${booksWord(findCount)}.`}</p>
          )}
          {t.nothingFound.length > 0 && (
            <label className="flex min-h-11 items-center gap-2 sm:min-h-9">
              <input
                type="checkbox"
                checked={retry}
                disabled={busy}
                onChange={(e) => setRetry(e.target.checked)}
                className="h-5 w-5 accent-accent"
              />
              <span>{`Also try again for ${t.nothingFound.length} tried before with nothing found`}</span>
            </label>
          )}
          <div className="flex gap-2">
            <Button variant="primary" disabled={off || usedUp || findCount === 0} onClick={() => void findNow()}>
              {busy ? "Starting…" : "Confirm"}
            </Button>
            <Button
              disabled={busy}
              onClick={() => {
                setConfirming(false);
                setRetry(false);
              }}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}
      {marked !== null && marked > 0 && (
        <p role="status">
          {`Marked ${booksWord(marked)}. Find covers from the `}
          <a href="#/covers" className="inline-flex min-h-11 items-center underline sm:min-h-9">
            Covers tab
          </a>
          .
        </p>
      )}
      {kept > 0 && <p>{`${kept} already marked kept ${kept === 1 ? "its" : "their"} reasons and note.`}</p>}
      {markFailed > 0 && (
        <p role="alert" className="text-danger">{`Couldn't mark ${booksWord(markFailed)}. Try again.`}</p>
      )}
      {queued !== null && (
        <p role="status">{`Searching ${booksWord(queued)}. It carries on whenever either of you has the app open.`}</p>
      )}
      {findFailed && (
        <p role="alert" className="text-danger">
          Couldn't start the search. Try again.
        </p>
      )}
    </section>
  );
}
