import { useEffect, useRef, useState } from "react";
import { groupLibraryTags } from "@/lib/tagging/group";
import type { LibraryTag } from "@/lib/tagging/types";

/** D14: the `Library tags` button, its chips and dialog. Same pattern as the ToS tag filter; the book needs every chosen tag. */
export default function LibraryTagFilter({
  vocabulary,
  selected,
  onChange,
}: {
  vocabulary: LibraryTag[];
  selected: string[];
  onChange(ids: string[]): void;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (open) closeRef.current?.focus();
  }, [open]);
  function close() {
    setOpen(false);
    triggerRef.current?.focus();
  }
  const active = vocabulary.filter((t) => t.active);
  if (active.length === 0 && selected.length === 0) return null;
  const groups = groupLibraryTags(
    active.map((t) => t.id),
    active,
  );
  const labelOf = (id: string) => vocabulary.find((t) => t.id === id)?.label ?? id;
  function toggle(id: string, on: boolean) {
    onChange(on ? [...selected, id] : selected.filter((t) => t !== id));
  }
  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <button ref={triggerRef} type="button" onClick={() => setOpen(true)} className="rounded border px-3 py-1 text-sm">
          Library tags
        </button>
        {selected.map((id) => (
          <span key={id} className="rounded-full bg-stone-200 px-3 py-1 text-sm">
            {labelOf(id)}
          </span>
        ))}
        {selected.length > 0 && (
          <button type="button" onClick={() => onChange([])} className="text-sm underline">
            Clear
          </button>
        )}
      </div>
      {open && (
        <div className="fixed inset-0 z-20 flex items-end justify-center bg-black/40 sm:items-center">
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Library tags"
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.stopPropagation();
                close();
              }
            }}
            className="max-h-[80vh] w-full max-w-lg overflow-y-auto rounded-t bg-white p-4 sm:rounded"
          >
            {groups.map((g) => (
              <fieldset key={g.category} className="mb-3">
                <legend className="text-sm font-medium">{g.label}</legend>
                {g.tags.map((t) => (
                  <label key={t.id} className="flex items-center gap-2 py-1 text-sm">
                    <input type="checkbox" checked={selected.includes(t.id)} onChange={(e) => toggle(t.id, e.target.checked)} />
                    {t.label}
                  </label>
                ))}
              </fieldset>
            ))}
            <div className="flex gap-2">
              <button type="button" onClick={() => onChange([])} className="rounded border px-3 py-2">
                Clear
              </button>
              <button ref={closeRef} type="button" onClick={close} className="rounded border px-3 py-2">
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
