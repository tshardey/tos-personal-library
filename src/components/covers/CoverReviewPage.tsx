import { useMemo, useRef, useState } from "react";
import { useCoverFinder } from "@/contexts/CoverFinderContext";
import { useCatalog } from "@/hooks/useCatalog";
import { formatUsd } from "@/lib/covers/cost";
import { buildReviewRows, pickedCount, planApply, type ReviewRow as Row, type RowChoice } from "@/lib/covers/review";
import ReviewRow from "./ReviewRow";

interface Summary {
  applied: number;
  changed: number;
  gone: number;
}

/** The explicit choice if it still loads, else the default; a failed pick moves to the next tile, or keep. */
function effectiveChoice(row: Row, explicit: RowChoice | undefined, failed: ReadonlySet<string>): RowChoice | null {
  if (row.kind !== "results") return null;
  const wanted = explicit ?? row.defaultChoice;
  if (wanted === "keep") return "keep";
  if (wanted !== null && !failed.has(wanted)) return wanted;
  return row.search.results.find((r) => !failed.has(r.url))?.url ?? "keep";
}

export default function CoverReviewPage() {
  const { searches, budget, runReview, retry } = useCoverFinder();
  const { books, reload } = useCatalog();
  const [choices, setChoices] = useState<Map<string, RowChoice>>(new Map());
  const [failed, setFailed] = useState<Map<string, Set<string>>>(new Map());
  const [running, setRunning] = useState(false);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [error, setError] = useState(false);
  const busy = useRef(false);

  const rows = useMemo(() => buildReviewRows(searches, books), [searches, books]);
  const none: ReadonlySet<string> = useMemo(() => new Set<string>(), []);
  const effective = useMemo(() => {
    const m = new Map<string, RowChoice>();
    for (const row of rows) {
      const c = effectiveChoice(row, choices.get(row.search.id), failed.get(row.search.id) ?? none);
      if (c !== null) m.set(row.search.id, c);
    }
    return m;
  }, [rows, choices, failed, none]);
  const n = pickedCount(rows, effective);

  function tileError(searchId: string, url: string) {
    setFailed((prev) => {
      const next = new Map(prev);
      next.set(searchId, new Set(prev.get(searchId)).add(url));
      return next;
    });
  }

  async function apply() {
    if (busy.current) return;
    busy.current = true;
    setRunning(true);
    setError(false);
    try {
      setSummary(await runReview(planApply(rows, effective)));
      await reload();
    } catch {
      setError(true);
    } finally {
      busy.current = false;
      setRunning(false);
    }
  }

  const sentences: string[] = [];
  if (summary) {
    if (summary.applied > 0) sentences.push(`Applied ${summary.applied}.`);
    if (summary.changed > 0) sentences.push(`${summary.changed} covers were changed by someone else; check them again.`);
    if (summary.gone > 0) sentences.push(`${summary.gone} were already reviewed by someone else.`);
    if (sentences.length === 0) sentences.push("Nothing was changed.");
  }
  const hasFooter = rows.length > 0 || summary !== null || error;

  return (
    <div className={`p-3 sm:p-4 ${hasFooter ? "pb-32" : ""}`}>
      <h2 className="text-lg font-semibold">Covers to review</h2>
      {budget && (
        <p className="text-sm text-stone-600">{`This month: ${formatUsd(budget.spentMicro)} of ${formatUsd(budget.budgetMicro)} used.`}</p>
      )}
      {rows.length === 0 ? (
        <div className="mt-4 space-y-2">
          <p>No covers to review.</p>
          <a href="#/" className="underline">
            Back to library
          </a>
        </div>
      ) : (
        <ul className="mt-2">
          {rows.map((row) => (
            <ReviewRow
              key={row.search.id}
              row={row}
              choice={effective.get(row.search.id) ?? null}
              failed={failed.get(row.search.id) ?? none}
              onChoose={(c) => setChoices((prev) => new Map(prev).set(row.search.id, c))}
              onTileError={(url) => tileError(row.search.id, url)}
              onRetry={() => void retry(row.book.id)}
            />
          ))}
        </ul>
      )}
      {hasFooter && (
        <div className="fixed inset-x-0 bottom-0 z-10 border-t bg-white p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <div className="mx-auto flex max-w-3xl items-center justify-between gap-3">
            {rows.length > 0 && <p className="text-sm font-medium">{`${n} picked`}</p>}
            {rows.length > 0 && (
              <button
                type="button"
                disabled={running}
                onClick={() => void apply()}
                className="rounded bg-stone-800 px-3 py-2 text-white disabled:opacity-50"
              >
                {n > 0 ? `Apply ${n}` : "Done"}
              </button>
            )}
          </div>
          <div className="mx-auto max-w-3xl space-y-0.5 text-sm text-stone-700">
            {sentences.map((s) => (
              <p key={s}>{s}</p>
            ))}
            {error && <p>Couldn't apply those. Try again.</p>}
          </div>
        </div>
      )}
    </div>
  );
}
