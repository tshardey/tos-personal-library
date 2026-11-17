import { useState } from "react";
import { Button, Sheet } from "@/components/ui";
import { useCoverFinder } from "@/contexts/CoverFinderContext";
import { budgetUsedUp } from "@/lib/covers/cost";
import { COVER_REASONS, MAX_NOTE, REASON_LABELS, type CoverReason } from "@/lib/covers/types";
import type { BookWithCopies } from "@/lib/types";

const ACTIVE = new Set(["queued", "gathered", "processing"]);
const SAVE_ERROR = "Couldn't save this. Try again.";
/** Underline buttons get a 44px target below `sm` (D11). */
const UNDERLINE = "inline-flex min-h-11 items-center underline sm:min-h-9";

/** A deluxe copy usually gets an angled photo of the physical book as its cover, so "angled" starts ticked. */
const defaultReasons = (book: BookWithCopies): CoverReason[] => (book.copies.some((c) => c.deluxe) ? ["angled"] : []);

export default function FindCoverPanel({ book }: { book: BookWithCopies }) {
  const { marks, latest, budget, mark, unmark, findNow, retry } = useCoverFinder();
  const current = marks.get(book.id);
  const search = latest.get(book.id);
  const usedUp = budget !== null && budgetUsedUp(budget);

  const [open, setOpen] = useState(false);
  const [reasons, setReasons] = useState<CoverReason[]>([]);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  // The search id seen when a request was accepted; the local "looking" state lasts until the latest search differs in id or status.
  const [requestedFrom, setRequestedFrom] = useState<{ id: string | null; status: string | null } | null>(null);
  const requested = requestedFrom !== null && (search?.id ?? null) === requestedFrom.id &&
    (search?.status ?? null) === requestedFrom.status;

  const status = search?.status;
  const looking = requested || (status !== undefined && ACTIVE.has(status));
  const ready = !requested && status === "ready";
  const retryable = !requested && (status === "nothing_found" || status === "failed");

  function openPanel() {
    setReasons(current ? [...current.reasons] : defaultReasons(book));
    setNote(current?.note ?? "");
    setError(false);
    setOpen(true);
  }

  function toggle(r: CoverReason) {
    setReasons((prev) => (prev.includes(r) ? prev.filter((x) => x !== r) : [...prev, r]));
  }

  async function guarded(action: () => Promise<boolean>) {
    setBusy(true);
    setError(false);
    try {
      if (!(await action())) setError(true);
    } catch (err) {
      console.error("Cover request failed", err instanceof Error ? err.name : "unknown");
      setError(true);
    } finally {
      setBusy(false);
    }
  }

  const sentNote = () => (note.trim() === "" ? null : note.trim());

  const addToBatch = () =>
    guarded(async () => {
      await mark(book.id, reasons, sentNote());
      setOpen(false);
      return true;
    });

  const doFindNow = () =>
    guarded(async () => {
      const out = await findNow(book.id, reasons, sentNote());
      if (out !== "queued" && out !== "already_open") return false;
      setRequestedFrom({ id: search?.id ?? null, status: search?.status ?? null });
      setOpen(false);
      return true;
    });

  const doRetry = () =>
    guarded(async () => {
      const out = await retry(book.id);
      if (out !== "queued" && out !== "already_open") return false;
      setRequestedFrom({ id: search?.id ?? null, status: search?.status ?? null });
      return true;
    });

  const doUnmark = () =>
    guarded(async () => {
      await unmark(book.id);
      return true;
    });

  const budgetCopy = <p className="text-sm text-muted">This month's cover-finding budget is used up.</p>;
  const alert = error && (
    <p role="alert" className="text-sm text-danger">
      {SAVE_ERROR}
    </p>
  );

  return (
    <section aria-label="Cover finder" className="space-y-2 text-sm">
      {looking && <p>Looking for covers…</p>}
      {ready && (
        <p>
          New covers are ready.{" "}
          <a href="#/covers" className="underline">
            Review covers
          </a>
        </p>
      )}
      {retryable && (
        <div className="space-y-1">
          <p>{status === "failed" ? "The cover search failed." : "Nothing good found."}</p>
          <button type="button" disabled={busy || usedUp} onClick={() => void doRetry()} className={`${UNDERLINE} disabled:opacity-50`}>
            Try again
          </button>
          {usedUp && budgetCopy}
        </div>
      )}
      {current && !open && (
        <p>
          Marked for a cover search.{" "}
          <button type="button" disabled={busy} onClick={() => void doUnmark()} className={UNDERLINE}>
            Remove mark
          </button>
        </p>
      )}
      {!looking && !ready && (
        // Stays mounted while the sheet is open, so closing the sheet returns focus to it.
        <Button variant="secondary" onClick={openPanel} className="w-full">
          Find cover
        </Button>
      )}
      {open && (
        <Sheet
          label="Find cover"
          title="Find cover"
          onClose={() => setOpen(false)}
          footer={
            <>
              <Button variant="primary" disabled={busy || usedUp} onClick={() => void doFindNow()}>
                Find now
              </Button>
              <Button variant="primary" disabled={busy} onClick={() => void addToBatch()}>
                {current ? "Update mark" : "Add to batch"}
              </Button>
              <Button variant="ghost" disabled={busy} onClick={() => setOpen(false)}>
                Cancel
              </Button>
            </>
          }
        >
          <div className="space-y-3 text-sm">
            <div className="flex flex-wrap gap-2">
              {COVER_REASONS.map((r) => (
                <button
                  key={r}
                  type="button"
                  aria-pressed={reasons.includes(r)}
                  onClick={() => toggle(r)}
                  className={`min-h-11 rounded-full border px-3 py-1 sm:min-h-9 ${
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
                maxLength={MAX_NOTE}
                placeholder="e.g. this is the Spanish edition"
                onChange={(e) => setNote(e.target.value)}
                className="mt-1 w-full rounded border border-field p-2"
                rows={2}
              />
            </label>
            {usedUp && budgetCopy}
            {alert}
          </div>
        </Sheet>
      )}
      {!open && alert}
    </section>
  );
}
