import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui";
import { useReading } from "@/contexts/ReadingContext";
import { dismissMatch, linkHistory, listPossibleMatches } from "@/lib/reading/reading-repo";
import type { PossibleMatch } from "@/lib/reading/types";
import type { BookWithCopies } from "@/lib/types";

interface Props {
  books: BookWithCopies[];
  /** Change to refetch the list (after an upload). */
  refreshKey?: number;
}

const key = (m: PossibleMatch) => `${m.historyId}:${m.bookId}`;

export default function PossibleMatches({ books, refreshKey = 0 }: Props) {
  const { reload } = useReading();
  const [matches, setMatches] = useState<PossibleMatch[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [rowError, setRowError] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const busy = useRef(false);
  const byId = useMemo(() => new Map(books.map((b) => [b.id, b])), [books]);

  useEffect(() => {
    let live = true;
    listPossibleMatches().then(
      (rows) => {
        if (!live) return;
        setLoadError(false);
        setMatches(rows);
      },
      (err) => {
        console.error("Possible matches failed", err instanceof Error ? err.name : "unknown");
        if (live) setLoadError(true);
      },
    );
    return () => {
      live = false;
    };
  }, [refreshKey]);

  async function act(m: PossibleMatch, run: () => Promise<unknown>, afterRemoved?: () => Promise<void>) {
    if (busy.current) return;
    busy.current = true;
    setBusyKey(key(m));
    setRowError(null);
    try {
      await run();
      setMatches((cur) => (cur ?? []).filter((x) => key(x) !== key(m)));
      await afterRemoved?.();
    } catch (err) {
      console.error("Possible match action failed", err instanceof Error ? err.name : "unknown");
      setRowError("Couldn't update that match.");
    } finally {
      busy.current = false;
      setBusyKey(null);
    }
  }

  const shown = (matches ?? []).filter((m) => byId.has(m.bookId));
  return (
    <section aria-label="Possible matches" className="space-y-2">
      <h3 className="font-medium text-fg-strong">Possible matches</h3>
      {loadError && (
        <p role="alert" className="text-sm text-danger">
          Couldn't load possible matches.
        </p>
      )}
      {matches !== null && shown.length === 0 && <p className="text-sm text-muted">No possible matches to review.</p>}
      {shown.length > 0 && (
        <ul className="space-y-2">
          {shown.map((m) => {
            const book = byId.get(m.bookId)!;
            const disabled = busyKey !== null;
            return (
              <li key={key(m)} className="rounded-xl border border-line bg-raised p-3 text-sm">
                <p>{`From StoryGraph: ${m.sgTitle} by ${m.sgAuthors.join(", ")}`}</p>
                <a href={`#/book/${book.id}`} className="mt-2 flex items-center gap-3 underline">
                  {book.coverUrl ? (
                    <img src={book.coverUrl} alt="" className="h-16 w-11 rounded object-cover" />
                  ) : (
                    <span className="h-16 w-11 rounded bg-control" aria-hidden="true" />
                  )}
                  <span>
                    <span className="block font-medium">{book.title}</span>
                    <span className="block text-muted">{book.authors.join(", ")}</span>
                  </span>
                </a>
                <div className="mt-2 flex gap-2">
                  <Button
                    variant="primary"
                    disabled={disabled}
                    onClick={() => void act(m, () => linkHistory(m.historyId, m.bookId), reload)}
                  >
                    Link
                  </Button>
                  <Button disabled={disabled} onClick={() => void act(m, () => dismissMatch(m.historyId, m.bookId))}>
                    Not this book
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {rowError && (
        <p role="alert" className="text-sm text-danger">
          {rowError}
        </p>
      )}
    </section>
  );
}
