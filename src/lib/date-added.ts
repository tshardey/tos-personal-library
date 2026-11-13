import type { BookWithCopies } from "@/lib/types";
import { countedCopies } from "@/lib/copy-flags";

/** The instant as YYYY-MM-DD in the viewer's time zone. */
export function localDay(iso: string): string {
  const d = new Date(iso);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}

/** Days with counted copies, newest first, with copy counts; a selected day with none stays listed at 0. */
export function dateAddedOptions(
  books: BookWithCopies[],
  showUnhauled: boolean,
  selected: string | null,
): { day: string; copies: number }[] {
  const counts = new Map<string, number>();
  for (const b of books) {
    for (const c of countedCopies(b, showUnhauled)) {
      const day = localDay(c.createdAt);
      counts.set(day, (counts.get(day) ?? 0) + 1);
    }
  }
  if (selected && !counts.has(selected)) counts.set(selected, 0);
  return [...counts.entries()]
    .map(([day, copies]) => ({ day, copies }))
    .sort((a, b) => (a.day < b.day ? 1 : a.day > b.day ? -1 : 0));
}

export function dayLabel(day: string, now: Date = new Date()): string {
  const [y, m, d] = day.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  return date.toLocaleDateString(
    undefined,
    y === now.getFullYear()
      ? { month: "short", day: "numeric" }
      : { month: "short", day: "numeric", year: "numeric" },
  );
}
