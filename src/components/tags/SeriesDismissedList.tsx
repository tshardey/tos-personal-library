import { useId, useState } from "react";
import { Button } from "@/components/ui";
import { isSeriesHandSet } from "@/lib/series";
import type { SeriesDismissal } from "@/lib/tagging/types";
import type { Book } from "@/lib/types";

const newestFirst = (a: SeriesDismissal, b: SeriesDismissal) => {
  if (a.decidedAt === b.decidedAt) return 0;
  if (a.decidedAt === null) return 1;
  if (b.decidedAt === null) return -1;
  return a.decidedAt < b.decidedAt ? 1 : -1;
};

/** The collapsed Dismissed (N) disclosure with Undo. A book that has a series now, or is hand-set, can't come back and isn't listed. */
export default function SeriesDismissedList({
  items,
  books,
  onUndo,
}: {
  items: SeriesDismissal[];
  books: Book[];
  onUndo(d: SeriesDismissal): Promise<unknown>;
}) {
  const [open, setOpen] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const panel = useId();
  const byId = new Map(books.map((b) => [b.id, b]));

  const listed: { d: SeriesDismissal; key: string; label: string; undoLabel: string }[] = [];
  for (const d of [...items].sort(newestFirst)) {
    if (d.kind === "name") {
      listed.push({ d, key: d.suggestionId, label: d.name, undoLabel: d.name });
      continue;
    }
    const book = byId.get(d.bookId);
    if (!book || book.seriesName !== null || isSeriesHandSet(book)) continue;
    listed.push({
      d,
      key: `${d.suggestionId}:${d.bookId}`,
      label: `${book.title}, from ${d.name}`,
      undoLabel: `${book.title} from ${d.name}`,
    });
  }
  if (listed.length === 0) return null;

  async function undo(d: SeriesDismissal, key: string) {
    setFailed(null);
    setBusy(key);
    try {
      await onUndo(d);
    } catch (err) {
      console.error("Undo dismissal failed", err instanceof Error ? err.name : "unknown");
      setFailed(key);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-2">
      <Button aria-expanded={open} aria-controls={panel} onClick={() => setOpen((o) => !o)}>
        {`Dismissed (${listed.length})`}
      </Button>
      <ul id={panel} hidden={!open} className="space-y-2">
        {listed.map(({ d, key, label, undoLabel }) => (
          <li
            key={key}
            className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line bg-raised p-3 text-sm"
          >
            <span>{label}</span>
            <Button aria-label={`Undo dismissal of ${undoLabel}`} disabled={busy === key} onClick={() => void undo(d, key)}>
              Undo
            </Button>
            {failed === key && (
              <p role="alert" className="w-full text-danger">
                Couldn't undo that. Try again.
              </p>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
