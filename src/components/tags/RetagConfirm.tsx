import { useState } from "react";
import { budgetUsedUp, formatUsd, remainingMicro } from "@/lib/covers/cost";
import { booksCoveredBy, TAG_PER_BOOK_ESTIMATE_MICRO } from "@/lib/tagging/cost";
import type { AiBudget } from "@/lib/tagging/types";

/**
 * A full retag (reason `manual`) of some books behind a confirm step: the button spends nothing,
 * the confirm step shows the count, the estimate, the budget left and, when it falls short, how
 * many books the budget covers. Used by Retag selected (mass edit) and Retag all books.
 */
export default function RetagConfirm({
  label,
  bookIds,
  budget,
  disabled = false,
  onRetag,
}: {
  label: string;
  /** The books Confirm queues, in order. */
  bookIds: string[];
  /** This month's tagging budget, or null while it loads. */
  budget: AiBudget | null;
  /** Extra reasons the button is off, on top of no books or the budget cap. */
  disabled?: boolean;
  /** Queues the books; resolves to how many were newly queued. */
  onRetag(bookIds: string[]): Promise<number>;
}) {
  const [step, setStep] = useState<"idle" | "confirm" | "queueing">("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState(false);

  const usedUp = budget !== null && budgetUsedUp(budget);
  const books = bookIds.length;
  const covered = budget === null ? books : booksCoveredBy(budget, TAG_PER_BOOK_ESTIMATE_MICRO);
  const estimate = formatUsd(books * TAG_PER_BOOK_ESTIMATE_MICRO);
  const coverage =
    covered === 0
      ? books === 1
        ? "This month's budget doesn't cover this book. It carries on next month."
        : "This month's budget doesn't cover any of these books. They carry on next month."
      : `This month's budget covers about ${covered} of these ${books} books. The rest carry on next month.`;

  async function retag() {
    setStep("queueing");
    setMessage(null);
    setError(false);
    try {
      const queued = await onRetag(bookIds);
      setMessage(`Queued ${queued} ${queued === 1 ? "book" : "books"} for retagging.`);
    } catch (err) {
      console.error("Failed to retag books", err instanceof Error ? err.name : "unknown");
      setError(true);
    } finally {
      setStep("idle");
    }
  }

  return (
    <>
      {step === "idle" && (
        <button
          type="button"
          disabled={books === 0 || usedUp || disabled}
          onClick={() => {
            setMessage(null);
            setError(false);
            setStep("confirm");
          }}
          className="min-h-10 rounded border px-3 disabled:opacity-50"
        >
          {label}
        </button>
      )}
      {usedUp && <p className="text-sm text-stone-700">This month's tagging budget is used up.</p>}
      {step !== "idle" && (
        <div role="group" aria-label="Confirm retag" className="space-y-2 rounded border p-2 text-sm">
          <p className="font-medium">
            {`Retag ${books} ${books === 1 ? "book" : "books"} · ${estimate.startsWith("under") ? "" : "about "}${estimate}`}
          </p>
          {budget !== null && <p>{`${formatUsd(remainingMicro(budget))} of this month's tagging budget left.`}</p>}
          {budget !== null && covered < books && <p>{coverage}</p>}
          <div className="flex gap-2">
            <button
              type="button"
              disabled={step === "queueing" || usedUp}
              onClick={() => void retag()}
              className="min-h-10 rounded bg-stone-800 px-3 text-white disabled:opacity-50"
            >
              {step === "queueing" ? "Queueing…" : "Confirm"}
            </button>
            <button
              type="button"
              disabled={step === "queueing"}
              onClick={() => setStep("idle")}
              className="min-h-10 rounded border px-3 disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
      {message && <p role="status" className="text-sm">{message}</p>}
      {error && <p role="alert" className="text-sm text-red-700">Couldn't queue the retag. Try again.</p>}
    </>
  );
}
