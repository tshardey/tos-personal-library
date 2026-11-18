import { useMemo, useRef, useState } from "react";
import { useCoverFinder } from "@/contexts/CoverFinderContext";
import { booksWord, estimateText } from "@/lib/covers/batch-text";
import { booksCovered, budgetUsedUp, estimateMicro } from "@/lib/covers/cost";
import { batchSelection } from "@/lib/covers/eligibility";
import type { BookWithCopies } from "@/lib/types";

/**
 * A batch cover search over `books`: the count and estimate, Find covers, and why some books are
 * left out. Shared by the Library footer and the Covers tab. With a `title`, it is a labelled group
 * headed "title: count" (the Covers tab's lines); without, a bare row for the footer.
 */
export default function CoverBatch({ books, title }: { books: BookWithCopies[]; title?: string }) {
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
  // The title counts the whole set; unhauled books never belong to it (applyCoverFilter leaves them out).
  const total = books.filter((b) => b.onShelf).length;

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

  const body = (
    <>
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-medium">{`${booksWord(n)} · ${estimateText(estimateMicro(n))}`}</p>
        <button
          type="button"
          disabled={disabled}
          onClick={() => void go()}
          className="min-h-11 shrink-0 rounded bg-accent px-3 py-2 text-on-accent disabled:bg-control disabled:text-muted sm:min-h-9"
        >
          Find covers
        </button>
      </div>
      <div className="space-y-0.5 text-sm text-muted">
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
    </>
  );

  if (title === undefined) return body;
  return (
    <div role="group" aria-label={title} className="space-y-1 rounded-md border border-line bg-raised p-3">
      <h3 className="font-medium text-fg-strong">{`${title}: ${total}`}</h3>
      {body}
    </div>
  );
}
