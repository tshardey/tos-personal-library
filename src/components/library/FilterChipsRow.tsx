import type { ReactNode } from "react";
import { Button, Chip } from "@/components/ui";
import type { FilterChip } from "@/lib/filter-chips";

/**
 * The count the page passes in (its single live count), one removable Chip per active filter,
 * and Clear all once there are two or more.
 */
export default function FilterChipsRow({
  chips,
  count,
  onRemove,
  onClearAll,
}: {
  chips: FilterChip[];
  count: ReactNode;
  onRemove(c: FilterChip): void;
  onClearAll(): void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 px-4 pb-2 text-sm sm:px-6">
      {count}
      {chips.map((c) => (
        <Chip key={c.key} label={c.label} onRemove={() => onRemove(c)} />
      ))}
      {chips.length >= 2 && (
        <Button variant="ghost" size="sm" onClick={onClearAll}>
          Clear all
        </Button>
      )}
    </div>
  );
}
