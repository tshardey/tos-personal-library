import { useEffect, useRef, useState } from "react";
import { canonicalSeries, MAX_SERIES } from "@/lib/series";

interface Props {
  value: string | null;
  volume: number | null;
  names: string[];
  onChange(name: string | null, volume: number | null): void;
  disabled?: boolean;
}

/** D5: a button that opens a sheet to pick, add or clear the book's series, plus a volume number. */
export default function SeriesPicker({ value, volume, names, onChange, disabled }: Props) {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [vol, setVol] = useState(volume === null ? "" : String(volume));
  const filterRef = useRef<HTMLInputElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) filterRef.current?.focus();
  }, [open]);
  useEffect(() => {
    setVol(volume === null ? "" : String(volume));
  }, [volume]);

  function close() {
    setOpen(false);
    setTyped("");
    triggerRef.current?.focus();
  }
  /** null for a blank field; undefined for text that is not a valid volume (it never overwrites the saved one). */
  function parsedVolume(): number | null | undefined {
    if (vol.trim() === "") return null;
    const n = Number(vol);
    return Number.isFinite(n) && n >= 0 && n <= 9999.5 ? n : undefined;
  }
  const volumeInvalid = parsedVolume() === undefined;
  function pick(next: string | null) {
    const n = parsedVolume();
    if (next !== null && n === undefined) return;
    onChange(next, next === null ? null : (n ?? null));
    close();
  }
  function commitVolume(e: React.FocusEvent<HTMLInputElement>) {
    // Moving focus to a choice in this sheet: that choice saves the volume itself, once.
    if (e.relatedTarget instanceof Node && dialogRef.current?.contains(e.relatedTarget)) return;
    if (value === null) return;
    const n = parsedVolume();
    if (n === undefined) return;
    if (n !== volume) onChange(value, n);
  }

  const trimmed = typed.trim();
  const needle = trimmed.toLowerCase();
  const shown = names.filter((n) => n.toLowerCase().includes(needle));
  const tooLong = trimmed.length > MAX_SERIES;
  const canonical = canonicalSeries(typed, names);
  const exists = names.some((n) => n.toLowerCase() === needle);
  const showAdd = canonical !== null && !exists;

  const option = "block w-full rounded px-2 py-2 text-left hover:bg-stone-100";
  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        onClick={() => setOpen(true)}
        className="block w-full rounded border p-2 text-left text-sm disabled:opacity-50"
      >
        {value === null ? "Series: none" : `Series: ${value}${volume !== null ? ` · Vol. ${volume}` : ""}`}
      </button>
      {open && (
        <div className="fixed inset-0 z-20 flex items-end justify-center bg-black/40 sm:items-center">
          <div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-label="Series"
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.stopPropagation();
                close();
              }
            }}
            className="max-h-[80vh] w-full max-w-lg overflow-y-auto rounded-t bg-white p-4 sm:rounded"
          >
            {volumeInvalid && <p role="alert" className="mb-2 text-sm text-red-700">Volume must be between 0 and 9999.5.</p>}
            <label className="mb-2 block text-sm">
              Volume
              <input
                type="number"
                step={0.5}
                min={0}
                max={9999.5}
                value={vol}
                onChange={(e) => setVol(e.target.value)}
                onBlur={commitVolume}
                className="mt-1 block w-full rounded border p-2"
              />
            </label>
            <input
              ref={filterRef}
              type="text"
              value={typed}
              maxLength={MAX_SERIES}
              onChange={(e) => setTyped(e.target.value)}
              onKeyDown={(e) => {
                if (e.key !== "Enter") return;
                e.preventDefault();
                const exact = names.find((n) => n.toLowerCase() === needle);
                if (exact) pick(exact);
                else if (shown.length === 1) pick(shown[0]);
                else if (showAdd) pick(canonical);
              }}
              aria-label="Filter series"
              placeholder="Filter or add a series"
              className="mb-2 block w-full rounded border p-2"
            />
            <ul className="space-y-1">
              <li>
                <button type="button" onClick={() => pick(null)} className={option}>
                  None
                </button>
              </li>
              {shown.map((n) => (
                <li key={n}>
                  <button type="button" onClick={() => pick(n)} className={option}>
                    {n}
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
            {tooLong && <p className="mt-2 text-sm text-red-700">{`Series names are at most ${MAX_SERIES} characters.`}</p>}
            <button type="button" onClick={close} className="mt-3 rounded border px-3 py-2">
              Close
            </button>
          </div>
        </div>
      )}
    </>
  );
}
