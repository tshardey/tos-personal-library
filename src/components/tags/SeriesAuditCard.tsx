import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui";
import { canonicalSeries, joinsExisting, MAX_SERIES, parseVolume } from "@/lib/series";
import { auditTag, auditText, nowText } from "@/lib/tagging/eligibility";
import type { AuditDecision, SeriesAuditFlag } from "@/lib/tagging/types";
import type { Book } from "@/lib/types";

const input = "mt-1 block w-full min-h-11 sm:min-h-9 rounded-md border border-field bg-control px-3 text-sm text-fg";

/** One pending audit flag: Now beside Audit, the reason, and Use audit's answer, Keep it or Edit…. Errors show here; the section owns status lines. */
export default function SeriesAuditCard({
  flag,
  book,
  names,
  onApply,
  onKeep,
  onEdit,
}: {
  flag: SeriesAuditFlag;
  book: Book;
  /** The household's existing series spellings. */
  names: string[];
  onApply(id: string): Promise<AuditDecision>;
  onKeep(id: string): Promise<AuditDecision>;
  onEdit(id: string, name: string | null, volume: number | null): Promise<AuditDecision>;
}) {
  const tag = auditTag(flag);
  const startName = flag.kind === "wrong_number" ? flag.currentName : (flag.proposedName ?? "");
  const startVolume = flag.proposedVolume === null ? "" : String(flag.proposedVolume);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(startName);
  const [volume, setVolume] = useState(startVolume);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(false);
  const busy = useRef(false);
  const editButton = useRef<HTMLButtonElement>(null);
  const refocus = useRef(false);

  useEffect(() => {
    if (!editing && refocus.current) {
      refocus.current = false;
      editButton.current?.focus();
    }
  }, [editing]);

  const parsed = parseVolume(volume);
  const joins = joinsExisting(name, names);

  async function act(run: () => Promise<unknown>) {
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    setError(false);
    try {
      await run();
    } catch (err) {
      console.error("Series audit decision failed", err instanceof Error ? err.name : "unknown");
      setError(true);
    } finally {
      busy.current = false;
      setPending(false);
    }
  }

  function save() {
    if (parsed === undefined) return;
    const series = canonicalSeries(name, names);
    // A blank name clears the series, and the number goes with it.
    void act(async () => {
      await onEdit(flag.id, series, series === null ? null : parsed);
      setEditing(false);
    });
  }

  function cancel() {
    refocus.current = true;
    setError(false);
    setName(startName);
    setVolume(startVolume);
    setEditing(false);
  }

  return (
    <li aria-label={`${book.title}: ${tag}`} className="rounded-xl border border-line bg-raised p-3">
      <div className="flex flex-wrap items-center gap-2">
        <a href={`#/book/${book.id}`} className="inline-flex min-h-11 items-center text-sm font-medium underline sm:min-h-9">
          {book.title}
        </a>
        <span className="inline-flex items-center rounded-full bg-control px-2 py-0.5 text-xs font-medium text-fg">{tag}</span>
      </div>
      {book.authors.length > 0 && <p className="text-sm text-muted">{book.authors.join(", ")}</p>}
      <dl className="mt-2 grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-muted">
            Now
          </dt>
          <dd>{nowText(flag)}</dd>
        </div>
        <div>
          <dt className="text-muted">
            Audit
          </dt>
          <dd>{auditText(flag)}</dd>
        </div>
      </dl>
      {flag.why && <p className="mt-2 text-sm text-muted">{flag.why}</p>}
      {editing ? (
        <div className="mt-2 space-y-2 text-sm">
          <label className="block">
            Series name
            <input type="text" value={name} maxLength={MAX_SERIES} onChange={(e) => setName(e.target.value)} className={input} />
          </label>
          {joins && <p className="text-muted">{`Joins your series "${joins}".`}</p>}
          <label className="block">
            Number
            <input type="text" inputMode="decimal" value={volume} onChange={(e) => setVolume(e.target.value)} className={input} />
          </label>
          {parsed === undefined && (
            <p role="alert" className="text-danger">
              Use a number from 0 to 9999, or leave it blank.
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" disabled={pending || parsed === undefined} onClick={save}>
              Save
            </Button>
            <Button disabled={pending} onClick={cancel}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <div className="mt-2 flex flex-wrap gap-2">
          <Button variant="primary" disabled={pending} onClick={() => void act(() => onApply(flag.id))}>
            Use audit's answer
          </Button>
          <Button disabled={pending} onClick={() => void act(() => onKeep(flag.id))}>
            Keep it
          </Button>
          <Button ref={editButton} disabled={pending} onClick={() => setEditing(true)}>
            Edit…
          </Button>
        </div>
      )}
      {error && (
        <p role="alert" className="mt-1 text-sm text-danger">
          Couldn't save that. Try again.
        </p>
      )}
    </li>
  );
}
