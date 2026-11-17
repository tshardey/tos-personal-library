import type { Ref } from "react";
import { Badge, Button, FilterIcon, SearchIcon, SelectIcon, SparkleIcon } from "@/components/ui";
import { DESKTOP, useMediaQuery } from "@/hooks/useMediaQuery";
import type { CoverSize } from "@/lib/cover-size";
import type { SortKey } from "@/lib/sort-books";
import CoverSizeControl from "./CoverSizeControl";
import SortSelect from "./SortSelect";

interface Props {
  query: string;
  onQuery(q: string): void;
  /** D11: absent while tagging is unavailable. `note` explains a disabled button. */
  ask?: { disabled: boolean; note: string | null; onAsk(): void };
  filtersCount: number;
  filtersOpen: boolean;
  onToggleFilters(): void;
  filtersId: string;
  /** The Filters button, so closing the panel can hand focus back to it. */
  filtersRef?: Ref<HTMLButtonElement>;
  sort: SortKey;
  onSort(s: SortKey): void;
  /** In a series the wall is always in volume order, so the sort is disabled on "Series order". */
  seriesOrder: boolean;
  size: CoverSize;
  onSize(s: CoverSize): void;
  selecting: boolean;
  /** False while there is nothing to select: no books shown, the Nothing found list, or Ask results. */
  canSelect: boolean;
  allShownSelected: boolean;
  onSelect(): void;
  onSelectAll(): void;
}

/**
 * The library's one-line toolbar. Phone: search, Ask, Filters, Select. Computer: the same plus
 * Sort and the cover size steps (on the phone those live in the Filters sheet, Task 11).
 */
export default function LibraryToolbar({
  query,
  onQuery,
  ask,
  filtersCount,
  filtersOpen,
  onToggleFilters,
  filtersId,
  filtersRef,
  sort,
  onSort,
  seriesOrder,
  size,
  onSize,
  selecting,
  canSelect,
  allShownSelected,
  onSelect,
  onSelectAll,
}: Props) {
  const desktop = useMediaQuery(DESKTOP);
  return (
    <div className="space-y-1 px-4 py-2 sm:px-6">
      <div className="flex items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <SearchIcon className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
          <input
            type="search"
            value={query}
            onChange={(e) => onQuery(e.target.value)}
            placeholder="Search title or author"
            aria-label="Search books"
            className="min-h-11 w-full min-w-0 rounded-md border border-field bg-control pl-9 pr-3 text-sm text-fg sm:min-h-9"
          />
        </div>
        {ask &&
          (desktop ? (
            <Button variant="primary" size="sm" disabled={ask.disabled} onClick={ask.onAsk} className="shrink-0">
              Ask ✨
            </Button>
          ) : (
            <Button
              variant="primary"
              aria-label="Ask ✨"
              disabled={ask.disabled}
              onClick={ask.onAsk}
              className="size-11 shrink-0 px-0 sm:size-9"
            >
              <SparkleIcon className="size-5" />
            </Button>
          ))}
        <Button
          ref={filtersRef}
          size="sm"
          aria-label={filtersCount > 0 ? `Filters, ${filtersCount} active` : "Filters"}
          aria-haspopup={desktop ? undefined : "dialog"}
          aria-expanded={filtersOpen}
          aria-controls={filtersOpen ? filtersId : undefined}
          onClick={(e) => {
            // Safari doesn't focus a clicked button; the sheet hands focus back to whatever had it.
            e.currentTarget.focus();
            onToggleFilters();
          }}
          className="shrink-0"
        >
          {/* The aria-label is the name ("Filters, 2 active"); the visible text says the same on every width. */}
          <FilterIcon className="hidden size-4 sm:block" />
          Filters
          {filtersCount > 0 && <Badge tone="accent">{filtersCount}</Badge>}
        </Button>
        {desktop && (
          <>
            <SortSelect sort={sort} onSort={onSort} seriesOrder={seriesOrder} className="shrink-0" />
            <CoverSizeControl size={size} onSize={onSize} />
          </>
        )}
        {canSelect &&
          (selecting ? (
            <Button size="sm" disabled={allShownSelected} onClick={onSelectAll} className="shrink-0">
              Select all
            </Button>
          ) : (
            <Button size="sm" onClick={onSelect} className="shrink-0">
              <SelectIcon className="hidden size-4 sm:block" />
              Select
            </Button>
          ))}
      </div>
      {ask?.note && <p className="text-sm text-muted">{ask.note}</p>}
    </div>
  );
}
