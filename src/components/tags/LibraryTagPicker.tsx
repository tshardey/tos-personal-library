import { useEffect, useRef, useState } from "react";
import { groupLibraryTags } from "@/lib/tagging/group";
import type { LibraryTag } from "@/lib/tagging/types";

/**
 * A button that opens grouped checkboxes over `offered` tag ids, with chips for the chosen ones.
 * Mass edit uses two (Add tags, Remove tags), each leaving out what the other has chosen.
 */
export default function LibraryTagPicker({
  label,
  vocabulary,
  offered,
  selected,
  onChange,
}: {
  label: string;
  vocabulary: LibraryTag[];
  offered: string[];
  selected: string[];
  onChange(ids: string[]): void;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const doneRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (open) doneRef.current?.focus();
  }, [open]);
  function close() {
    setOpen(false);
    triggerRef.current?.focus();
  }
  const labelOf = (id: string) => vocabulary.find((t) => t.id === id)?.label ?? id;
  const groups = groupLibraryTags(offered, vocabulary);
  function toggle(id: string, on: boolean) {
    onChange(on ? [...selected, id] : selected.filter((t) => t !== id));
  }
  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <button
          ref={triggerRef}
          type="button"
          onClick={() => setOpen(true)}
          className="min-h-10 rounded border px-3 text-sm"
        >
          {label}
        </button>
        {selected.map((id) => (
          <span key={id} className="rounded-full bg-stone-200 px-3 py-1 text-sm">
            {labelOf(id)}
          </span>
        ))}
        {selected.length > 0 && (
          <button type="button" onClick={() => onChange([])} className="text-sm underline">
            No change
          </button>
        )}
      </div>
      {open && (
        <div className="fixed inset-0 z-30 flex items-end justify-center bg-black/40 sm:items-center">
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
            className="flex max-h-[80vh] w-full max-w-lg flex-col rounded-t bg-white sm:rounded"
          >
            <div className="overflow-y-auto p-4">
              {groups.length === 0 && <p className="text-sm text-stone-700">No tags to choose.</p>}
              {groups.map((g) => (
                <fieldset key={g.category} className="mb-3">
                  <legend className="text-sm font-medium">{g.label}</legend>
                  {g.tags.map((t) => (
                    <label key={t.id} className="flex min-h-10 items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={selected.includes(t.id)}
                        onChange={(e) => toggle(t.id, e.target.checked)}
                        className="h-5 w-5 accent-stone-800"
                      />
                      {t.label}
                    </label>
                  ))}
                </fieldset>
              ))}
            </div>
            <div className="border-t p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
              <button ref={doneRef} type="button" onClick={close} className="min-h-10 rounded border px-3">
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
