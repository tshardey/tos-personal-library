import { useState } from "react";
import EditionPicker from "@/components/edition/EditionPicker";
import { Button, Sheet } from "../ui";

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
    <Sheet
      label={heading}
      onClose={busy ? () => {} : onCancel}
      className="flex flex-col"
      footer={
        <>
          <div className="flex w-full items-end gap-2">
            <div className="min-w-0 flex-1">
              <EditionPicker
                value={edition}
                labels={labels}
                label="Set edition for selected"
                disabled={busy}
                onChange={setEdition}
              />
            </div>
            <Button disabled={busy || checked.length === 0} onClick={() => onSetEdition(checked, edition)}>
              Apply
            </Button>
          </div>
          <Button variant="primary" disabled={busy || checked.length === 0} onClick={() => onConfirm(checked)}>
            {checked.length === 1 ? "Add 1 book" : `Add ${checked.length} books`}
          </Button>
          <Button disabled={busy} onClick={onCancel}>
            Cancel
          </Button>
        </>
      }
    >
      <div className="mb-2">
        <h3 id="bulk-heading" className="mb-1 text-lg font-semibold text-fg-strong">
          {heading}
        </h3>
        <p className="text-sm">Each of these is added as a new book, with a copy for its owner.</p>
      </div>
      <ul className="min-h-0 flex-1 space-y-2 overflow-y-auto text-base">
          {entries.map((e) => (
            <li key={e.id} className="flex items-start gap-2">
              <input
                type="checkbox"
                aria-label={e.title}
                checked={!unchecked.has(e.id)}
                disabled={busy}
                onChange={() => toggle(e.id)}
                className="mt-1 h-5 w-5 accent-accent"
              />
              <span>
                <span className="font-medium">{e.title}</span>
                {e.authors.length > 0 && <span className="text-muted">{` · ${e.authors.join(", ")}`}</span>}
                <span className="block text-[13px] text-muted sm:text-sm">{`Edition: ${e.editionNote || "none"}`}</span>
              </span>
            </li>
          ))}
      </ul>
    </Sheet>
  );
}
