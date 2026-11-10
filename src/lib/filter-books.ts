import type { BookWithCopies } from "@/lib/types";

/** 'all' | 'shared' | a member's userId */
export type OwnerFilter = "all" | "shared" | string;

function fold(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

export function filterBooks(
  books: BookWithCopies[],
  opts: { query: string; owner: OwnerFilter; edition?: string | null },
): BookWithCopies[] {
  const edition = opts.edition ? opts.edition.trim().toLowerCase() : null;
  const q = fold(opts.query.trim());
  return books.filter((b) => {
    if (opts.owner === "shared") {
      if (!b.copies.some((c) => c.ownerUserId === null)) return false;
    } else if (opts.owner !== "all") {
      if (!b.copies.some((c) => c.ownerUserId === opts.owner)) return false;
    }
    if (edition && !b.copies.some((c) => c.editionNote?.trim().toLowerCase() === edition)) return false;
    if (!q) return true;
    const notes = b.copies.flatMap((c) => (c.editionNote ? [c.editionNote] : []));
    return [b.title, ...b.authors, ...notes].some((s) => fold(s).includes(q));
  });
}
