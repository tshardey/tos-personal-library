import type { BookWithCopies } from "@/lib/types";

/** 'all' | 'shared' | a member's userId */
export type OwnerFilter = "all" | "shared" | string;

function fold(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

export function filterBooks(
  books: BookWithCopies[],
  opts: { query: string; owner: OwnerFilter },
): BookWithCopies[] {
  const q = fold(opts.query.trim());
  return books.filter((b) => {
    if (opts.owner === "shared") {
      if (!b.copies.some((c) => c.ownerUserId === null)) return false;
    } else if (opts.owner !== "all") {
      if (!b.copies.some((c) => c.ownerUserId === opts.owner)) return false;
    }
    if (!q) return true;
    return [b.title, ...b.authors].some((s) => fold(s).includes(q));
  });
}
