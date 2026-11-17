import { useRef, useState } from "react";
import { Sheet } from "@/components/ui";
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
          <span key={id} className="rounded-full bg-control px-3 py-1 text-sm">
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
        <Sheet
          label={label}
          onClose={close}
          initialFocus={doneRef}
          footer={
            <button ref={doneRef} type="button" onClick={close} className="min-h-11 rounded border px-3 sm:min-h-9">
              Done
            </button>
          }
        >
          {groups.length === 0 && <p className="text-sm text-muted">No tags to choose.</p>}
          {groups.map((g) => (
            <fieldset key={g.category} className="mb-3">
              <legend className="text-sm font-medium">{g.label}</legend>
              {g.tags.map((t) => (
                <label key={t.id} className="flex min-h-10 items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={selected.includes(t.id)}
                    onChange={(e) => toggle(t.id, e.target.checked)}
                    className="h-5 w-5 accent-accent"
                  />
                  {t.label}
                </label>
              ))}
            </fieldset>
          ))}
        </Sheet>
      )}
    </div>
  );
}
