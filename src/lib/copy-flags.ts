import type { BookWithCopies, Copy } from "@/lib/types";

export function isUnhauled(c: Copy): boolean {
  return c.unhauledAt !== null;
}

/** The copies that count for filters and badges: all of them when unhauled books are shown, else the on-shelf ones. */
export function countedCopies(b: BookWithCopies, showUnhauled: boolean): Copy[] {
  return showUnhauled ? b.copies : b.copies.filter((c) => !isUnhauled(c));
}

export function hasUnhauledCopy(b: BookWithCopies): boolean {
  return b.copies.some(isUnhauled);
}

export function bookBadges(b: BookWithCopies): { unhauled: boolean; deluxe: boolean; signed: boolean } {
  const onShelf = b.copies.filter((c) => !isUnhauled(c));
  return {
    unhauled: !b.onShelf,
    deluxe: onShelf.some((c) => c.deluxe),
    signed: onShelf.some((c) => c.signed),
  };
}
