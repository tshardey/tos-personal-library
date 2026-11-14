import { useId, useRef, useState } from "react";
import { budgetUsedUp, formatUsd } from "@/lib/covers/cost";
import { booksCoveredBy } from "@/lib/tagging/cost";
import type { AiBudget } from "@/lib/tagging/types";

const booksWord = (n: number) => (n === 1 ? "1 book" : `${n} books`);

/** "under $0.01" reads on its own; a dollar amount is an estimate (as the cover batch footer). */
function estimateText(micro: number): string {
  const usd = formatUsd(micro);
  return micro > 0 && !usd.startsWith("under") ? `about ${usd}` : usd;
}

export interface RunAction {
  label: string;
  /** How many of the eligible ids (in order) this action sends; all when undefined. */
  limit?: number;
}

/**
 * D14: one tagging action on the Tag suggestions screen — the count and estimate, the buttons,
 * and the near-limit, used-up, empty and progress lines. Laid out like the cover batch footer,
 * but in the page flow so it never covers content.
 */
export default function TagRunPanel({
  title,
  eligible,
  perBookMicro,
  budget,
  actions,
  emptyText,
  progress,
  onRun,
}: {
  title: string;
  eligible: string[];
  perBookMicro: number;
  budget: AiBudget | null;
  actions: RunAction[];
  emptyText: string;
  /** An open run's progress, or null. */
  progress: { done: number; total: number } | null;
  onRun(ids: string[]): Promise<number>;
}) {
  const headingId = useId();
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  const busy = useRef(false);
  const n = eligible.length;
  const usedUp = budget !== null && budgetUsedUp(budget);
  const covered = budget !== null && !usedUp ? booksCoveredBy(budget, perBookMicro) : null;
  const disabled = pending || n === 0 || usedUp;

  async function go(action: RunAction) {
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    setFailed(false);
    try {
      await onRun(action.limit === undefined ? eligible : eligible.slice(0, action.limit));
    } catch (err) {
      console.error("Failed to start tagging", err instanceof Error ? err.name : "unknown");
      setFailed(true);
    } finally {
      busy.current = false;
      setPending(false);
    }
  }

  return (
    <section aria-labelledby={headingId} className="rounded border p-3">
      <h3 id={headingId} className="font-medium">
        {title}
      </h3>
      <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium">{`${booksWord(n)} · ${estimateText(n * perBookMicro)}`}</p>
        <div className="flex flex-wrap gap-2">
          {actions.map((a, i) => (
            <button
              key={a.label}
              type="button"
              disabled={disabled}
              onClick={() => void go(a)}
              className={
                i === 0
                  ? "min-h-10 rounded bg-stone-800 px-3 text-white disabled:opacity-50"
                  : "min-h-10 rounded border px-3 disabled:opacity-50"
              }
            >
              {a.label}
            </button>
          ))}
        </div>
      </div>
      <div className="mt-1 space-y-0.5 text-sm text-stone-700">
        {progress !== null && (
          <p role="status">{`Tagged ${progress.done} of ${progress.total}. It carries on whenever either of you has the app open.`}</p>
        )}
        {covered !== null && n > 0 && covered < n && (
          <p>{`This month's budget covers about ${covered} of these ${booksWord(n)}.`}</p>
        )}
        {usedUp && <p>This month's tagging budget is used up.</p>}
        {n === 0 && progress === null && <p>{emptyText}</p>}
        {failed && <p role="alert">Couldn't start tagging. Try again.</p>}
      </div>
    </section>
  );
}
