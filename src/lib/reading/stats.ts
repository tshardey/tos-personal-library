import type { BookWithCopies } from "@/lib/types";
import type { ReadStatusMap } from "./types";

export interface ReadingStats {
  owned: number;
  read: number;
  pct: number;
  readThisYear: number;
  readSince: number | null;
  dnf: number;
}

/** D11: a hauled copy that is the member's own or Shared. */
export function ownsBook(book: BookWithCopies, userId: string): boolean {
  return book.copies.some((c) => c.unhauledAt === null && (c.ownerUserId === userId || c.ownerUserId === null));
}

/** D11: a member's stats over the books they own. `today` and `since` are YYYY-MM-DD. */
export function readingStats(
  books: BookWithCopies[],
  map: ReadStatusMap,
  userId: string,
  opts: { today: string; since: string | null },
): ReadingStats {
  const yearStart = `${opts.today.slice(0, 4)}-01-01`;
  let owned = 0;
  let read = 0;
  let readThisYear = 0;
  let readSince = 0;
  let dnf = 0;
  for (const book of books) {
    if (!ownsBook(book, userId)) continue;
    owned += 1;
    const entry = map.get(book.id)?.get(userId);
    if (!entry) continue;
    if (entry.state === "dnf") dnf += 1;
    if (entry.state !== "read") continue;
    read += 1;
    const day = entry.finishedOn;
    if (day === null) continue;
    if (day >= yearStart && day <= opts.today) readThisYear += 1;
    if (opts.since !== null && day >= opts.since) readSince += 1;
  }
  return {
    owned,
    read,
    pct: owned === 0 ? 0 : Math.round((read / owned) * 100),
    readThisYear,
    readSince: opts.since === null ? null : readSince,
    dnf,
  };
}
