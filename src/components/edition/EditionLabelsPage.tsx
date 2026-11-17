import { useId, useMemo, useState } from "react";
import { Button } from "@/components/ui";
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

  // After a rename, a reload keeps the list on screen; only a first load replaces the page.
  if (loading && books.length === 0) return <p className="mx-auto max-w-3xl px-4 py-6 sm:px-6">Loading…</p>;
  if (error && books.length === 0) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-6 sm:px-6">
        <p role="alert" className="mb-3 text-danger">
          {error}
        </p>
        <Button variant="primary" onClick={() => void reload()}>
          Retry
        </Button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-4 sm:px-6">
      <h2 className="text-xl font-semibold text-fg-strong">Edition labels</h2>
      <p className="text-sm text-muted">Rename a label, merge it into another, or clear it from its copies.</p>
      {status && (
        <p role={status.error ? "alert" : "status"} className={`mt-2 text-sm ${status.error ? "text-danger" : ""}`}>
          {status.text}
        </p>
      )}
      {error && (
        <p role="alert" className="mt-2 text-sm text-danger">
          {"Couldn't reload the labels. "}
          <Button variant="ghost" size="sm" onClick={() => void reload()} className="underline">
            Retry
          </Button>
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
        <ul className="mt-3 divide-y divide-line border-y border-line" aria-label="Edition labels">
          {labels.map((l) => (
            <li key={l.label} className="py-2" aria-label={l.label}>
              <div className="flex items-center justify-between gap-2">
                <span className="min-w-0 break-words">
                  {l.label} <span className="text-sm text-muted">{`· ${plural(l.count)}`}</span>
                </span>
                {editing !== l.label && (
                  <Button
                    disabled={busy}
                    onClick={() => start(l.label)}
                    aria-label={`Rename ${l.label}`}
                    className="shrink-0"
                  >
                    Rename
                  </Button>
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
                      className="mt-1 block w-full min-h-11 sm:min-h-9 rounded-md border border-field bg-control px-3 text-sm text-fg disabled:opacity-50"
                    />
                  </label>
                  <p className="text-sm text-muted">
                    {plan.kind === "invalid" ? plan.reason : describePlan(plan)}
                  </p>
                  {confirming && plan.kind !== "invalid" ? (
                    <div role="group" aria-label="Confirm" className="space-y-2 rounded-md border border-notice-line bg-notice p-2 text-fg">
                      <p className="text-sm font-medium">{confirmText(plan)}</p>
                      <div className="flex gap-2">
                        <Button variant="primary" disabled={busy} onClick={() => void run(plan)}>
                          {busy ? "Changing…" : `Change ${plural(plan.copies.length)}`}
                        </Button>
                        <Button disabled={busy} onClick={() => setConfirming(false)}>
                          Back
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex gap-2">
                      <Button type="submit" variant="primary" disabled={plan.kind === "invalid"}>
                        {plan.kind === "merge" ? "Merge" : plan.kind === "clear" ? "Clear label" : "Rename"}
                      </Button>
                      <Button onClick={cancel}>Cancel</Button>
                    </div>
                  )}
                </form>
              )}
            </li>
          ))}
        </ul>
      )}
      <a href="#/" className="mt-4 inline-flex min-h-11 items-center underline sm:min-h-9">
        Back to library
      </a>
    </div>
  );
}
