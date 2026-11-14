import { useEffect, useState } from "react";
import { useTagging } from "@/contexts/TaggingContext";
import { budgetUsedUp } from "@/lib/covers/cost";
import { groupLibraryTags } from "@/lib/tagging/group";

const NO_IDS: string[] = [];

/** D14: a book's library tags, grouped by category, with an editor and a Retag button. */
export default function LibraryTagsSection({ bookId }: { bookId: string }) {
  const { available, vocabulary, libraryTagsByBook, latestJob, budgets, setBookLibraryTag, retag } = useTagging();
  const stored = libraryTagsByBook.get(bookId) ?? NO_IDS;
  const [ids, setIds] = useState(stored);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [retagging, setRetagging] = useState(false);

  useEffect(() => {
    setIds(stored);
  }, [stored]);

  if (!available) return null;

  const job = latestJob.get(bookId);
  const open = job?.status === "queued" || job?.status === "processing";
  const failed = job?.status === "failed";
  const usedUp = budgets.tagging !== null && budgetUsedUp(budgets.tagging);

  async function toggle(id: string, checked: boolean) {
    if (busy) return;
    const previous = ids;
    setIds(checked ? [...previous, id] : previous.filter((t) => t !== id));
    setError(null);
    setBusy(true);
    try {
      await setBookLibraryTag(bookId, id, checked);
    } catch (err) {
      console.error("Failed to save library tag", err instanceof Error ? err.name : "unknown");
      setIds(previous);
      setError("Couldn't save the tag.");
    } finally {
      setBusy(false);
    }
  }

  async function doRetag() {
    if (retagging) return;
    setRetagging(true);
    setError(null);
    try {
      await retag(bookId);
    } catch (err) {
      console.error("Failed to retag book", err instanceof Error ? err.name : "unknown");
      setError("Couldn't start tagging.");
    } finally {
      setRetagging(false);
    }
  }

  const groups = groupLibraryTags(ids, vocabulary);
  const active = vocabulary.filter((t) => t.active).map((t) => t.id);
  // Keep tags the book already has even if retired, so they can be unchecked.
  const editable = groupLibraryTags([...active, ...ids.filter((id) => !active.includes(id))], vocabulary);
  const retagLabel = open ? "Tagging…" : failed ? "Tagging failed. Try again." : "Retag this book";

  return (
    <section>
      <h3 className="mb-2 font-semibold">Library tags</h3>
      {groups.length === 0 ? (
        <p className="text-sm text-stone-700">No library tags yet.</p>
      ) : (
        <div className="space-y-1 text-sm">
          {groups.map((g) => (
            <p key={g.category}>
              <span className="font-medium">{g.label}:</span> {g.tags.map((t) => t.label).join(", ")}
            </p>
          ))}
        </div>
      )}
      {error && (
        <p role="alert" className="mt-1 text-red-700">
          {error}
        </p>
      )}
      <div className="mt-2 flex flex-wrap items-center gap-3 text-sm">
        {!editing && vocabulary.length > 0 && (
          <button type="button" onClick={() => setEditing(true)} className="underline">
            Edit tags
          </button>
        )}
        <button
          type="button"
          onClick={() => void doRetag()}
          disabled={open || retagging || usedUp}
          className="underline disabled:opacity-50 disabled:no-underline"
        >
          {retagLabel}
        </button>
      </div>
      {usedUp && <p className="mt-1 text-sm text-stone-700">This month's tagging budget is used up.</p>}
      {editing && vocabulary.length > 0 && (
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
          <button type="button" onClick={() => setEditing(false)} className="rounded border px-3 py-2">
            Done
          </button>
        </div>
      )}
    </section>
  );
}
