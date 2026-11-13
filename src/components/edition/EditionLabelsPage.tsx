import { useId, useMemo, useState } from "react";
import { useHousehold } from "@/contexts/HouseholdContext";
import { useCatalog } from "@/hooks/useCatalog";
import { applyRename, copyLabel, labelCounts, planRename, type RenamePlan } from "@/lib/edition-rename";
import { MAX_LABEL } from "@/lib/editions";
import { useLibraryView } from "@/lib/library-view";
import { updateCopy } from "@/lib/library-repo";

const plural = (n: number) => `${n} ${n === 1 ? "copy" : "copies"}`;

type Ready = Exclude<RenamePlan, { kind: "invalid" }>;

function describePlan(plan: Ready): string {
  const n = plural(plan.copies.length);
  switch (plan.kind) {
    case "merge":
      return `Merges into "${plan.to}". ${n} will change; "${plan.to}" will have ${plural(plan.resultCount)}.`;
    case "clear":
      return `Clears the label from ${n}.`;
    default:
      return `Renames the label on ${n}.`;
  }
}

function confirmText(plan: Ready): string {
  const n = plural(plan.copies.length);
  switch (plan.kind) {
    case "merge":
      return `Change ${n} from "${plan.from}" to "${plan.to}"?`;
    case "clear":
      return `Remove the label "${plan.from}" from ${n}?`;
    default:
      return `Rename "${plan.from}" to "${plan.to}" on ${n}?`;
  }
}

/** A tool to rename, merge or clear the household's copy edition labels. */
export default function EditionLabelsPage() {
  const { household } = useHousehold();
  const { books, loading, error, reload } = useCatalog();
  const [view, patchView] = useLibraryView(household?.id ?? null);
  const labels = useMemo(() => labelCounts(books), [books]);
  const [editing, setEditing] = useState<string | null>(null);
  const [typed, setTyped] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ text: string; error: boolean } | null>(null);
  const listId = useId();

  const plan = editing === null ? null : planRename(books, editing, typed);

  function start(label: string) {
    setEditing(label);
    setTyped(label);
    setConfirming(false);
    setStatus(null);
  }
  function cancel() {
    setEditing(null);
    setConfirming(false);
  }

  async function run(p: Ready) {
    setBusy(true);
    try {
      const { changed, failed } = await applyRename(p, updateCopy);
      await reload();
      // A library filter on the old label would match nothing now; point it at the new one.
      const filter = view.edition?.trim().toLowerCase();
      if (failed === 0 && filter && filter === p.from.toLowerCase()) {
        const left = books
          .flatMap((b) => b.copies)
          .some((c) => !p.copies.includes(c) && copyLabel(c).toLowerCase() === filter);
        if (!left) patchView({ edition: p.to });
      }
      const verb = p.kind === "clear" ? "Cleared the label on" : "Changed";
      setStatus(
        failed > 0
          ? { text: `${verb} ${plural(changed)}. ${plural(failed)} couldn't be changed; try again.`, error: true }
          : { text: `${verb} ${plural(changed)}.`, error: false },
      );
      setEditing(null);
      setConfirming(false);
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <p className="p-6">Loading…</p>;
  if (error) {
    return (
      <div className="p-6">
        <p role="alert" className="mb-3 text-red-700">
          {error}
        </p>
        <button type="button" onClick={() => void reload()} className="rounded bg-stone-800 px-3 py-2 text-white">
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="p-3 sm:p-4">
      <h2 className="text-lg font-semibold">Edition labels</h2>
      <p className="text-sm text-stone-600">Rename a label, merge it into another, or clear it from its copies.</p>
      {status && (
        <p role={status.error ? "alert" : "status"} className={`mt-2 text-sm ${status.error ? "text-red-700" : ""}`}>
          {status.text}
        </p>
      )}
      <datalist id={listId}>
        {labels.map((l) => (
          <option key={l.label} value={l.label} />
        ))}
      </datalist>
      {labels.length === 0 ? (
        <p className="mt-4">No copies have an edition label yet.</p>
      ) : (
        <ul className="mt-3 divide-y border-y" aria-label="Edition labels">
          {labels.map((l) => (
            <li key={l.label} className="py-2" aria-label={l.label}>
              <div className="flex items-center justify-between gap-2">
                <span className="min-w-0 break-words">
                  {l.label} <span className="text-sm text-stone-600">{`· ${plural(l.count)}`}</span>
                </span>
                {editing !== l.label && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => start(l.label)}
                    aria-label={`Rename ${l.label}`}
                    className="min-h-10 shrink-0 rounded border px-3 disabled:opacity-50"
                  >
                    Rename
                  </button>
                )}
              </div>
              {editing === l.label && plan && (
                <form
                  className="mt-2 space-y-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (plan.kind !== "invalid") setConfirming(true);
                  }}
                >
                  <label className="block text-sm">
                    New name (blank clears the label)
                    <input
                      type="text"
                      value={typed}
                      list={listId}
                      maxLength={MAX_LABEL}
                      disabled={busy || confirming}
                      autoFocus
                      onChange={(e) => {
                        setTyped(e.target.value);
                        setConfirming(false);
                      }}
                      className="mt-1 block w-full rounded border p-2"
                    />
                  </label>
                  <p className="text-sm text-stone-700">
                    {plan.kind === "invalid" ? plan.reason : describePlan(plan)}
                  </p>
                  {confirming && plan.kind !== "invalid" ? (
                    <div role="group" aria-label="Confirm" className="space-y-2 rounded border border-amber-400 bg-amber-50 p-2">
                      <p className="text-sm font-medium">{confirmText(plan)}</p>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void run(plan)}
                          className="min-h-10 rounded bg-stone-800 px-3 text-white disabled:opacity-50"
                        >
                          {busy ? "Changing…" : `Change ${plural(plan.copies.length)}`}
                        </button>
                        <button type="button" disabled={busy} onClick={() => setConfirming(false)} className="min-h-10 rounded border px-3">
                          Back
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex gap-2">
                      <button
                        type="submit"
                        disabled={plan.kind === "invalid"}
                        className="min-h-10 rounded bg-stone-800 px-3 text-white disabled:opacity-50"
                      >
                        {plan.kind === "merge" ? "Merge" : plan.kind === "clear" ? "Clear label" : "Rename"}
                      </button>
                      <button type="button" onClick={cancel} className="min-h-10 rounded border px-3">
                        Cancel
                      </button>
                    </div>
                  )}
                </form>
              )}
            </li>
          ))}
        </ul>
      )}
      <a href="#/" className="mt-4 inline-block underline">
        Back to library
      </a>
    </div>
  );
}
