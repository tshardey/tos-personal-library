import { useRef, useState } from "react";
import { Sheet } from "@/components/ui";
import { canonicalLabel, MAX_LABEL } from "@/lib/editions";

interface Props {
  value: string | null;
  labels: string[];
  onChange(label: string | null): void;
  label?: string;
  disabled?: boolean;
  /** Shown on the button instead of the value, e.g. "no change" before anything is picked. */
  valueText?: string;
}

/** D12: a button that opens a sheet to pick, add or clear a household edition label. */
export default function EditionPicker({ value, labels, onChange, label = "Edition", disabled, valueText }: Props) {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const filterRef = useRef<HTMLInputElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  // Sheet also returns focus to the opener on unmount; this covers browsers that do not focus a clicked button.
  function close() {
    setOpen(false);
    setTyped("");
    triggerRef.current?.focus();
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

  const option = "block w-full rounded px-2 py-2 text-left hover:bg-control";
  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        onClick={() => setOpen(true)}
        className="block w-full rounded border p-2 text-left text-sm disabled:opacity-50"
      >
        {`${label}: ${valueText ?? value ?? "none"}`}
      </button>
      {open && (
        <Sheet label={label} onClose={close} initialFocus={filterRef}>
          <input
            ref={filterRef}
            type="text"
            value={typed}
            maxLength={MAX_LABEL}
            onChange={(e) => setTyped(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== "Enter") return;
              e.preventDefault();
              const exact = labels.find((l) => l.toLowerCase() === needle);
              if (exact) pick(exact);
              else if (shown.length === 1) pick(shown[0]);
              else if (showAdd) pick(canonical);
            }}
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
            <p className="mt-2 text-sm text-danger">{`Labels are at most ${MAX_LABEL} characters.`}</p>
          )}
          <button type="button" onClick={close} className="mt-3 min-h-11 rounded border px-3 py-2 sm:min-h-10">
            Close
          </button>
        </Sheet>
      )}
    </>
  );
}
