import { Select } from "@/components/ui";
import { SORT_KEYS, SORT_LABELS, type SortKey } from "@/lib/sort-books";

/** D5's Sort select: the toolbar's on the computer, the Filters sheet's View group on the phone. */
export default function SortSelect({
  sort,
  onSort,
  seriesOrder,
  className,
}: {
  sort: SortKey;
  onSort(s: SortKey): void;
  /** In a series the wall is always in volume order, so the sort is disabled on "Series order". */
  seriesOrder: boolean;
  className?: string;
}) {
  return (
    <Select
      label="Sort"
      disabled={seriesOrder}
      value={seriesOrder ? "series" : sort}
      onChange={(e) => onSort(e.target.value as SortKey)}
      className={className}
    >
      {seriesOrder ? (
        <option value="series">Series order</option>
      ) : (
        SORT_KEYS.map((k) => (
          <option key={k} value={k}>
            {SORT_LABELS[k]}
          </option>
        ))
      )}
    </Select>
  );
}
