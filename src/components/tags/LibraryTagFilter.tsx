import { useRef, useState } from "react";
import { Button, Sheet } from "@/components/ui";
import { groupLibraryTags } from "@/lib/tagging/group";
import type { LibraryTag } from "@/lib/tagging/types";

/** D14: the `Library tags` button, its chips and sheet. Same pattern as the ToS tag filter; the book needs every chosen tag. */
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
  const closeRef = useRef<HTMLButtonElement>(null);
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
        <Button
          size="sm"
          onClick={(e) => {
            // The sheet returns focus to whatever had it, so the button takes it first (Safari doesn't on click).
            e.currentTarget.focus();
            setOpen(true);
          }}
        >
          Library tags
        </Button>
        {selected.map((id) => (
          <span key={id} className="rounded-full bg-control px-3 py-1 text-sm">
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
        <Sheet
          label="Library tags"
          onClose={() => setOpen(false)}
          initialFocus={closeRef}
          footer={
            <>
              <Button onClick={() => onChange([])}>Clear</Button>
              <Button ref={closeRef} onClick={() => setOpen(false)}>
                Close
              </Button>
            </>
          }
        >
          {groups.map((g) => (
            <fieldset key={g.category} className="mb-3">
              <legend className="text-sm font-medium">{g.label}</legend>
              {g.tags.map((t) => (
                <label key={t.id} className="flex min-h-11 items-center gap-2 text-sm sm:min-h-9">
                  <input type="checkbox" checked={selected.includes(t.id)} onChange={(e) => toggle(t.id, e.target.checked)} />
                  {t.label}
                </label>
              ))}
            </fieldset>
          ))}
        </Sheet>
      )}
    </>
  );
}
