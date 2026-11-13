import { useMemo, useRef, useState } from "react";
import { useCoverFinder } from "@/contexts/CoverFinderContext";
import { booksCovered, budgetUsedUp, estimateMicro, formatUsd } from "@/lib/covers/cost";
import { batchSelection } from "@/lib/covers/eligibility";
import type { BookWithCopies } from "@/lib/types";

const booksWord = (n: number) => (n === 1 ? "1 book" : `${n} books`);

/** "under $0.01" reads on its own; a dollar amount is an estimate. */
function estimateText(micro: number): string {
  const usd = formatUsd(micro);
  return micro > 0 && !usd.startsWith("under") ? `about ${usd}` : usd;
}

/** `books` is the visible, filtered set. Fixed at the bottom, like the bulk confirm sheet's footer. */
export default function CoverBatchFooter({ books }: { books: BookWithCopies[] }) {
  const { latest, budget, requestBatch } = useCoverFinder();
  const [pending, setPending] = useState(false);
  const [queued, setQueued] = useState<number | null>(null);
  const [failed, setFailed] = useState(false);
  const busy = useRef(false);
  const { eligible, alreadyOpen, nothingFound } = useMemo(() => batchSelection(books, latest), [books, latest]);
  const n = eligible.length;
  const usedUp = budget !== null && budgetUsedUp(budget);
  const covered = budget !== null && !usedUp ? booksCovered(budget) : null;
  const disabled = pending || n === 0 || usedUp;

  async function go() {
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    setFailed(false);
    try {
      const out = await requestBatch(eligible);
      setQueued(out.queued);
    } catch {
      setQueued(null);
      setFailed(true);
    } finally {
      busy.current = false;
      setPending(false);
    }
  }

  return (
    <div className="fixed inset-x-0 bottom-0 z-10 border-t bg-white p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
      <div className="mx-auto flex max-w-3xl items-center justify-between gap-3">
        <p className="text-sm font-medium">{`${booksWord(n)} · ${estimateText(estimateMicro(n))}`}</p>
        <button
          type="button"
          disabled={disabled}
          onClick={() => void go()}
          className="rounded bg-stone-800 px-3 py-2 text-white disabled:opacity-50"
        >
          Find covers
        </button>
      </div>
      <div className="mx-auto max-w-3xl space-y-0.5 text-sm text-stone-700">
        {alreadyOpen > 0 && <p>{alreadyOpen} already being searched.</p>}
        {nothingFound > 0 && (
          <p>{`${nothingFound} tried before with nothing found ${nothingFound === 1 ? "is" : "are"} left out.`}</p>
        )}
        {covered !== null && covered < n && (
          <p>{`This month's budget covers about ${covered} of these ${booksWord(n)}.`}</p>
        )}
        {usedUp && <p>This month's cover-finding budget is used up.</p>}
        {n === 0 && <p>Nothing to search here.</p>}
        {queued !== null && (
          <p>{`Searching ${booksWord(queued)}. It carries on whenever either of you has the app open.`}</p>
        )}
        {failed && <p role="alert">Couldn't start the search. Try again.</p>}
      </div>
    </div>
  );
}
