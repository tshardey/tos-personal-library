import { useState } from "react";
import { Button } from "@/components/ui";
import { budgetUsedUp, formatUsd, remainingMicro } from "@/lib/covers/cost";
import { booksCoveredBy, FULL_TAG_PER_BOOK_ESTIMATE_MICRO } from "@/lib/tagging/cost";
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
  perBookMicro = FULL_TAG_PER_BOOK_ESTIMATE_MICRO,
  verb = "Retag",
  groupLabel = "Confirm retag",
  queuedText = (n) => `Queued ${n} ${n === 1 ? "book" : "books"} for retagging.`,
  errorText = "Couldn't queue the retag. Try again.",
  emptyText,
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
  /** The per-book cost estimate (default: a full tag plus the follow-up allowance), for the estimate and for how many books the budget covers. */
  perBookMicro?: number;
  /** The first word of the confirm line. */
  verb?: string;
  groupLabel?: string;
  queuedText?(n: number): string;
  errorText?: string;
  /** Shown when there are no books. */
  emptyText?: string;
}) {
  const [step, setStep] = useState<"idle" | "confirm" | "queueing">("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState(false);

  const usedUp = budget !== null && budgetUsedUp(budget);
  const books = bookIds.length;
  const covered = budget === null ? books : booksCoveredBy(budget, perBookMicro);
  const estimate = formatUsd(books * perBookMicro);
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
      setMessage(queuedText(queued));
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
        <Button
          disabled={books === 0 || usedUp || disabled}
          onClick={() => {
            setMessage(null);
            setError(false);
            setStep("confirm");
          }}
        >
          {label}
        </Button>
      )}
      {usedUp && <p className="text-sm text-muted">This month's tagging budget is used up.</p>}
      {books === 0 && emptyText && <p className="text-sm text-muted">{emptyText}</p>}
      {step !== "idle" && (
        <div role="group" aria-label={groupLabel} className="space-y-2 rounded-md border border-line bg-raised p-2 text-sm">
          <p className="font-medium">
            {`${verb} ${books} ${books === 1 ? "book" : "books"} · ${estimate.startsWith("under") ? "" : "about "}${estimate}`}
          </p>
          {budget !== null && <p>{`${formatUsd(remainingMicro(budget))} of this month's tagging budget left.`}</p>}
          {budget !== null && covered < books && <p>{coverage}</p>}
          <div className="flex gap-2">
            <Button variant="primary" disabled={step === "queueing" || usedUp} onClick={() => void retag()}>
              {step === "queueing" ? "Queueing…" : "Confirm"}
            </Button>
            <Button disabled={step === "queueing"} onClick={() => setStep("idle")}>
              Cancel
            </Button>
          </div>
        </div>
      )}
      {message && <p role="status" className="text-sm">{message}</p>}
      {error && <p role="alert" className="text-sm text-danger">{errorText}</p>}
    </>
  );
}
