import { useEffect, useState } from "react";
import { addBookTag, removeBookTag } from "@/lib/library-repo";
import { groupTags, isSharedTag, type TosTag } from "@/lib/tos-tags";

interface Props {
  bookId: string;
  householdId: string;
  tagIds: string[];
  tosTags: TosTag[];
  /** The tag list couldn't be fetched, so names may be missing. */
  stale: boolean;
  /** Tags couldn't be read from the library (e.g. before the db push); the section is read-only. */
  unavailable?: boolean;
  onChange(next: string[]): void;
}

/** D4: a book's Tome of Secrets tags, grouped by category, with an editor for the shared ones. */
export default function TosTagsSection({ bookId, householdId, tagIds, tosTags, stale, unavailable, onChange }: Props) {
  const [ids, setIds] = useState(tagIds);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setIds(tagIds);
  }, [tagIds]);

  const byId = new Map(tosTags.map((t) => [t.id, t]));
  const isShared = (id: string) => {
    const tag = byId.get(id);
    return tag !== undefined && isSharedTag(tag);
  };

  async function toggle(id: string, checked: boolean) {
    if (busy) return;
    const previous = ids;
    const next = checked ? [...previous, id] : previous.filter((t) => t !== id);
    setIds(next);
    setError(null);
    setBusy(true);
    try {
      if (checked) await addBookTag(bookId, householdId, id);
      else await removeBookTag(bookId, id);
      onChange(next);
    } catch (err) {
      console.error("Failed to save book tag", err instanceof Error ? err.name : "unknown");
      setIds(previous);
      setError("Couldn't save the tag.");
    } finally {
      setBusy(false);
    }
  }

  const groups = groupTags(ids, tosTags);
  const editable = groupTags(
    tosTags.filter(isSharedTag).map((t) => t.id),
    tosTags,
  );
  const locked = ids.filter((id) => !isShared(id));

  return (
    <section>
      <h3 className="mb-2 font-semibold">Tome of Secrets</h3>
      {unavailable ? (
        <p className="text-sm text-stone-700">Tome of Secrets tags unavailable.</p>
      ) : (
        <>
          {stale && <p className="mb-1 text-sm text-stone-600">Tag names couldn't be loaded; showing ids.</p>}
          {groups.length === 0 ? (
            <p className="text-sm text-stone-700">No Tome of Secrets tags yet.</p>
          ) : (
            <div className="space-y-1 text-sm">
              {groups.map((g) => (
                <p key={g.category}>
                  <span className="font-medium">{g.label}:</span> {g.tags.map((t) => t.label).join(", ")}
                </p>
              ))}
            </div>
          )}
        </>
      )}
      {error && (
        <p role="alert" className="mt-1 text-red-700">
          {error}
        </p>
      )}
      {!unavailable && !editing && (
        <button type="button" onClick={() => setEditing(true)} className="mt-2 text-sm underline">
          Edit tags
        </button>
      )}
      {!unavailable && editing && (
        <div className="mt-2 space-y-3 rounded border p-3">
          {editable.map((g) => (
            <fieldset key={g.category}>
              <legend className="text-sm font-medium">{g.label}</legend>
              {g.tags.map((t) => (
                <label key={t.id} className="flex items-center gap-2 py-1 text-sm">
                  <input
                    type="checkbox"
                    checked={ids.includes(t.id)}
                    disabled={busy}
                    onChange={(e) => void toggle(t.id, e.target.checked)}
                  />
                  {t.label}
                </label>
              ))}
            </fieldset>
          ))}
          {locked.length > 0 && (
            <ul className="space-y-1 text-sm text-stone-600">
              {locked.map((id) => (
                <li key={id}>{`${byId.get(id)?.label ?? id} (set in Tome of Secrets)`}</li>
              ))}
            </ul>
          )}
          <button type="button" onClick={() => setEditing(false)} className="rounded border px-3 py-2">
            Done
          </button>
        </div>
      )}
    </section>
  );
}
