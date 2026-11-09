interface Props {
  entries: { id: string; title: string; authors: string[] }[];
  busy: boolean;
  onConfirm(): void;
  onCancel(): void;
}

/** D7: every title is listed before anything is written. */
export default function BulkConfirmSheet({ entries, busy, onConfirm, onCancel }: Props) {
  const heading = `Add ${entries.length} new books`;
  return (
    <div className="fixed inset-0 z-10 flex items-end justify-center bg-black/40 sm:items-center">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="bulk-heading"
        className="max-h-[80vh] w-full max-w-lg overflow-y-auto rounded-t bg-white p-4 sm:rounded"
      >
        <h3 id="bulk-heading" className="mb-2 text-lg font-semibold">
          {heading}
        </h3>
        <p className="mb-2 text-sm">Each of these is added as a new book, with a copy for its owner.</p>
        <ul className="mb-4 list-disc space-y-1 pl-6">
          {entries.map((e) => (
            <li key={e.id}>
              <span className="font-medium">{e.title}</span>
              {e.authors.length > 0 && <span className="text-stone-600">{` · ${e.authors.join(", ")}`}</span>}
            </li>
          ))}
        </ul>
        <div className="flex gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={onConfirm}
            className="rounded bg-stone-800 px-3 py-2 text-white disabled:opacity-50"
          >
            Add them
          </button>
          <button type="button" disabled={busy} onClick={onCancel} className="rounded border px-3 py-2">
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
