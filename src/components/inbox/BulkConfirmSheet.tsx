import { useState } from "react";
import EditionPicker from "@/components/edition/EditionPicker";

export interface BulkEntry {
  id: string;
  title: string;
  authors: string[];
  /** The item's own edition label ("" for none): what the copy is written with. */
  editionNote: string;
}

interface Props {
  entries: BulkEntry[];
  labels: string[];
  busy: boolean;
  onConfirm(itemIds: string[]): void;
  onSetEdition(itemIds: string[], label: string | null): void;
  onCancel(): void;
}

/** D7: every title is listed before anything is written. D12: only the checked entries are edited or added. */
export default function BulkConfirmSheet({ entries, labels, busy, onConfirm, onSetEdition, onCancel }: Props) {
  // Unchecked rather than checked ids, so an entry that joins while the sheet is open starts checked.
  const [unchecked, setUnchecked] = useState<Set<string>>(new Set());
  const [edition, setEdition] = useState<string | null>(null);
  const checked = entries.filter((e) => !unchecked.has(e.id)).map((e) => e.id);
  const heading = `Add ${entries.length} new books`;

  function toggle(id: string) {
    setUnchecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div className="fixed inset-0 z-10 flex items-end justify-center bg-black/40 sm:items-center">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="bulk-heading"
        className="flex max-h-[80dvh] w-full max-w-lg flex-col rounded-t bg-white sm:rounded"
      >
        <div className="shrink-0 p-3 pb-2 sm:p-4 sm:pb-2">
          <h3 id="bulk-heading" className="mb-1 text-base font-semibold sm:mb-2 sm:text-lg">
            {heading}
          </h3>
          <p className="text-[13px] sm:text-sm">Each of these is added as a new book, with a copy for its owner.</p>
        </div>
        <ul className="min-h-0 flex-1 space-y-1.5 overflow-y-auto px-3 py-1 text-[15px] sm:space-y-2 sm:px-4 sm:text-base">
          {entries.map((e) => (
            <li key={e.id} className="flex items-start gap-2">
              <input
                type="checkbox"
                aria-label={e.title}
                checked={!unchecked.has(e.id)}
                disabled={busy}
                onChange={() => toggle(e.id)}
                className="mt-1 h-5 w-5"
              />
              <span>
                <span className="font-medium">{e.title}</span>
                {e.authors.length > 0 && <span className="text-stone-600">{` · ${e.authors.join(", ")}`}</span>}
                <span className="block text-[13px] text-stone-600 sm:text-sm">{`Edition: ${e.editionNote || "none"}`}</span>
              </span>
            </li>
          ))}
        </ul>
        <div className="shrink-0 border-t p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:p-4 sm:pb-[max(1rem,env(safe-area-inset-bottom))]">
          <div className="mb-2 flex items-end gap-2 sm:mb-3">
            <div className="min-w-0 flex-1">
              <EditionPicker
                value={edition}
                labels={labels}
                label="Set edition for selected"
                disabled={busy}
                onChange={setEdition}
              />
            </div>
            <button
              type="button"
              disabled={busy || checked.length === 0}
              onClick={() => onSetEdition(checked, edition)}
              className="min-h-10 rounded border px-3 py-2 disabled:opacity-50"
            >
              Apply
            </button>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={busy || checked.length === 0}
              onClick={() => onConfirm(checked)}
              className="min-h-10 rounded bg-stone-800 px-3 py-2 text-white disabled:opacity-50"
            >
              {checked.length === 1 ? "Add 1 book" : `Add ${checked.length} books`}
            </button>
            <button type="button" disabled={busy} onClick={onCancel} className="min-h-10 rounded border px-3 py-2">
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
