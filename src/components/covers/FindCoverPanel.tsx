import { useState } from "react";
import { useCoverFinder } from "@/contexts/CoverFinderContext";
import { budgetUsedUp } from "@/lib/covers/cost";
import { COVER_REASONS, MAX_NOTE, REASON_LABELS, type CoverReason } from "@/lib/covers/types";
import type { BookWithCopies } from "@/lib/types";

const ACTIVE = new Set(["queued", "gathered", "processing"]);
const SAVE_ERROR = "Couldn't save this. Try again.";

const btn = "rounded bg-stone-800 px-3 py-2 text-white disabled:opacity-50";

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
  // The search id seen when a request was accepted; the local "looking" state lasts until the latest search differs.
  const [requestedFrom, setRequestedFrom] = useState<{ id: string | null } | null>(null);
  const requested = requestedFrom !== null && (search?.id ?? null) === requestedFrom.id;

  const status = search?.status;
  const looking = requested || (status !== undefined && ACTIVE.has(status));
  const ready = !requested && status === "ready";
  const retryable = !requested && (status === "nothing_found" || status === "failed");

  function openPanel() {
    setReasons(current ? [...current.reasons] : []);
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
      setRequestedFrom({ id: search?.id ?? null });
      setOpen(false);
      return true;
    });

  const doRetry = () =>
    guarded(async () => {
      const out = await retry(book.id);
      if (out !== "queued" && out !== "already_open") return false;
      setRequestedFrom({ id: search?.id ?? null });
      return true;
    });

  const doUnmark = () =>
    guarded(async () => {
      await unmark(book.id);
      return true;
    });

  const budgetCopy = <p className="text-sm text-stone-700">This month's cover-finding budget is used up.</p>;
  const alert = error && (
    <p role="alert" className="text-sm text-red-700">
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
          <button type="button" disabled={busy || usedUp} onClick={() => void doRetry()} className="underline disabled:opacity-50">
            Try again
          </button>
          {usedUp && budgetCopy}
        </div>
      )}
      {current && !open && (
        <p>
          Marked for a cover search.{" "}
          <button type="button" disabled={busy} onClick={() => void doUnmark()} className="underline">
            Remove mark
          </button>
        </p>
      )}
      {!open && !looking && !ready && (
        <button type="button" onClick={openPanel} className="underline">
          Find a better cover
        </button>
      )}
      {open && (
        <div className="space-y-3 rounded border border-stone-300 p-3">
          <div className="flex flex-wrap gap-2">
            {COVER_REASONS.map((r) => (
              <button
                key={r}
                type="button"
                aria-pressed={reasons.includes(r)}
                onClick={() => toggle(r)}
                className={`rounded-full border px-3 py-1 ${
                  reasons.includes(r) ? "border-stone-800 bg-stone-800 text-white" : "border-stone-400 bg-white"
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
              className="mt-1 w-full rounded border border-stone-400 p-2"
              rows={2}
            />
          </label>
          {usedUp && budgetCopy}
          {alert}
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={busy || usedUp} onClick={() => void doFindNow()} className={btn}>
              Find now
            </button>
            <button type="button" disabled={busy} onClick={() => void addToBatch()} className={btn}>
              {current ? "Update mark" : "Add to batch"}
            </button>
            <button type="button" disabled={busy} onClick={() => setOpen(false)} className="underline">
              Cancel
            </button>
          </div>
        </div>
      )}
      {!open && alert}
    </section>
  );
}
