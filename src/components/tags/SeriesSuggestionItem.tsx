import { useRef, useState } from "react";
import { Button } from "@/components/ui";
import { joinsExisting, MAX_SERIES, parseVolume, seriesFillTargets } from "@/lib/series";
import type { SeriesSuggestion } from "@/lib/tagging/types";
import type { Book } from "@/lib/types";

const input = "mt-1 block w-full min-h-11 sm:min-h-9 rounded-md border border-field bg-control px-3 text-sm text-fg";

/** One pending series suggestion: an editable name, the books it would fill with editable numbers, Approve and Dismiss. */
export default function SeriesSuggestionItem({
  suggestion: s,
  books,
  names,
  onApprove,
  onDismiss,
}: {
  suggestion: SeriesSuggestion;
  /** The household's books: the source of the fill targets. */
  books: Book[];
  /** The household's existing series spellings. */
  names: string[];
  onApprove(id: string, name: string, volumes: Record<string, number | null>): Promise<unknown>;
  onDismiss(id: string): Promise<unknown>;
}) {
  const [name, setName] = useState(s.name);
  const [typed, setTyped] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const busy = useRef(false);

  const targets = seriesFillTargets(s, books);
  const text = (id: string, volume: number | null) => typed[id] ?? (volume === null ? "" : String(volume));
  const parsed = targets.map((t) => ({ ...t, text: text(t.book.id, t.volume) }));
  const anyInvalid = parsed.some((t) => parseVolume(t.text) === undefined);
  const joins = joinsExisting(name, names);
  const trimmed = name.trim();

  async function act(run: () => Promise<unknown>, failure: string) {
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    setError(null);
    try {
      await run();
    } catch (err) {
      console.error("Series suggestion action failed", err instanceof Error ? err.name : "unknown");
      setError(failure);
    } finally {
      busy.current = false;
      setPending(false);
    }
  }

  function approve() {
    const volumes: Record<string, number | null> = {};
    for (const t of parsed) volumes[t.book.id] = parseVolume(t.text) ?? null;
    void act(() => onApprove(s.id, trimmed, volumes), "Couldn't approve the series.");
  }

  return (
    <li aria-label={s.name} className="rounded-xl border border-line bg-raised p-3">
      <label className="block text-sm">
        Series name
        <input
          type="text"
          value={name}
          maxLength={MAX_SERIES}
          onChange={(e) => setName(e.target.value)}
          className={input}
        />
      </label>
      {joins && <p className="mt-1 text-sm text-muted">{`Joins your series "${joins}".`}</p>}
      {parsed.length === 0 ? (
        <p className="mt-2 text-sm text-muted">These books have a series now.</p>
      ) : (
        <ul className="mt-2 space-y-2 text-sm">
          {parsed.map((t) => {
            const invalid = parseVolume(t.text) === undefined;
            return (
              <li key={t.book.id}>
                <a href={`#/book/${t.book.id}`} className="inline-flex min-h-11 items-center underline sm:min-h-9">
                  {t.book.title}
                </a>
                <label className="block">
                  <span className="sr-only">{`Number for ${t.book.title}`}</span>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={t.text}
                    onChange={(e) => setTyped((prev) => ({ ...prev, [t.book.id]: e.target.value }))}
                    className={input}
                  />
                </label>
                {t.why && <p className="text-muted">{t.why}</p>}
                {invalid && (
                  <p role="alert" className="text-danger">
                    Use a number from 0 to 9999, or leave it blank.
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <div className="mt-2 flex gap-2">
        <Button variant="primary" disabled={pending || anyInvalid || parsed.length === 0 || trimmed === ""} onClick={approve}>
          Approve
        </Button>
        <Button disabled={pending} onClick={() => void act(() => onDismiss(s.id), "Couldn't dismiss the series.")}>
          Dismiss
        </Button>
      </div>
      {error && (
        <p role="alert" className="mt-1 text-sm text-danger">
          {error}
        </p>
      )}
    </li>
  );
}
