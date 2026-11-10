import { useEffect, useRef, useState } from "react";
import { canonicalLabel, MAX_LABEL } from "@/lib/editions";

interface Props {
  value: string | null;
  labels: string[];
  onChange(label: string | null): void;
  label?: string;
  disabled?: boolean;
}

/** D12: a button that opens a sheet to pick, add or clear a household edition label. */
export default function EditionPicker({ value, labels, onChange, label = "Edition", disabled }: Props) {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const filterRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) filterRef.current?.focus();
  }, [open]);

  function close() {
    setOpen(false);
    setTyped("");
  }
  function pick(next: string | null) {
    onChange(next);
    close();
  }

  const trimmed = typed.trim();
  const needle = trimmed.toLowerCase();
  const shown = labels.filter((l) => l.toLowerCase().includes(needle));
  const tooLong = trimmed.length > MAX_LABEL;
  const canonical = canonicalLabel(typed, labels);
  const exists = labels.some((l) => l.toLowerCase() === needle);
  const showAdd = canonical !== null && !exists;

  const option = "block w-full rounded px-2 py-2 text-left hover:bg-stone-100";
  return (
    <>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen(true)}
        className="block w-full rounded border p-2 text-left text-sm disabled:opacity-50"
      >
        {`${label}: ${value ?? "none"}`}
      </button>
      {open && (
        <div className="fixed inset-0 z-20 flex items-end justify-center bg-black/40 sm:items-center">
          <div
            role="dialog"
            aria-modal="true"
            aria-label={label}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.stopPropagation();
                close();
              }
            }}
            className="max-h-[80vh] w-full max-w-lg overflow-y-auto rounded-t bg-white p-4 sm:rounded"
          >
            <input
              ref={filterRef}
              type="text"
              value={typed}
              maxLength={MAX_LABEL}
              onChange={(e) => setTyped(e.target.value)}
              aria-label="Filter editions"
              placeholder="Filter or add an edition"
              className="mb-2 block w-full rounded border p-2"
            />
            <ul className="space-y-1">
              <li>
                <button type="button" onClick={() => pick(null)} className={option}>
                  None
                </button>
              </li>
              {shown.map((l) => (
                <li key={l}>
                  <button type="button" onClick={() => pick(l)} className={option}>
                    {l}
                  </button>
                </li>
              ))}
              {showAdd && (
                <li>
                  <button type="button" onClick={() => pick(canonical)} className={`${option} font-medium`}>
                    {`Add "${trimmed}"`}
                  </button>
                </li>
              )}
            </ul>
            {tooLong && (
              <p className="mt-2 text-sm text-red-700">{`Labels are at most ${MAX_LABEL} characters.`}</p>
            )}
            <button type="button" onClick={close} className="mt-3 rounded border px-3 py-2">
              Close
            </button>
          </div>
        </div>
      )}
    </>
  );
}
