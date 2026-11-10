import { canonicalIsbns, isbn10To13, normalizeIsbn10, normalizeIsbn13 } from "../libib/isbn";
import type { IntakeItem } from "../photo/types";
import type { BookWithCopies, HouseholdMember } from "../types";

export interface OwnedInfo {
  /** "Already in library — …", or null when no copy of this ISBN is recorded. */
  line: string | null;
  /** An open item in another batch has this ISBN; show ELSEWHERE_LINE. */
  elsewhere: boolean;
}

export const ELSEWHERE_LINE = "Also waiting in the inbox from another session.";

const CLOSED = new Set(["confirmed", "discarded"]);

function toIsbn13(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const i13 = normalizeIsbn13(raw);
  if (i13) return i13;
  const i10 = normalizeIsbn10(raw);
  return i10 ? isbn10To13(i10) : null;
}

/** "A's", "A's and B's", "A's, B's and C's". */
function joinOwners(parts: string[]): string {
  if (parts.length === 1) return parts[0];
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

/** Pure. Owners in member order, then a former member, then shared. */
export function ownedInfo(
  isbn13: string,
  catalog: BookWithCopies[],
  members: HouseholdMember[],
  openItems: IntakeItem[],
  batchId: string,
): OwnedInfo {
  const owners = new Set<string | null>();
  for (const book of catalog) {
    if (!canonicalIsbns(book).has(isbn13)) continue;
    for (const c of book.copies) owners.add(c.ownerUserId);
  }

  const parts: string[] = [];
  for (const m of members) if (owners.has(m.userId)) parts.push(`${m.displayName}'s`);
  const known = new Set(members.map((m) => m.userId));
  if ([...owners].some((o) => o !== null && !known.has(o))) parts.push("a former member's");
  if (owners.has(null)) parts.push("shared");

  let line: string | null = null;
  if (parts.length > 0) {
    line = `Already in library — ${joinOwners(parts)} ${parts.length === 1 ? "copy" : "copies"}`;
  }

  const elsewhere = openItems.some(
    (i) =>
      i.batchId !== batchId &&
      !CLOSED.has(i.status) &&
      (toIsbn13(i.scannedIsbn) === isbn13 || toIsbn13(i.extraction?.isbn) === isbn13),
  );
  return { line, elsewhere };
}
