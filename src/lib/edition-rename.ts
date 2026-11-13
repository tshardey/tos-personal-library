import { markEdited } from "@/lib/edited-fields";
import { MAX_LABEL } from "@/lib/editions";
import type { BookWithCopies, Copy, CopyInput } from "@/lib/types";

/** One stored edition label (trimmed, exact spelling) and how many copies carry it. */
export interface LabelCount {
  label: string;
  count: number;
}

const key = (s: string): string => s.toLowerCase();

/** A copy's label as the rename screen sees it: trimmed, "" for none. */
export function copyLabel(copy: Copy): string {
  return (copy.editionNote ?? "").trim();
}

/**
 * Every distinct edition label in the catalogue with its copy count, alphabetical. Unlike
 * editionLabels (which folds case for pickers), spellings that differ only by case are listed
 * apart, so one can be merged into the other.
 */
export function labelCounts(books: BookWithCopies[]): LabelCount[] {
  const counts = new Map<string, number>();
  for (const copy of books.flatMap((b) => b.copies)) {
    const label = copyLabel(copy);
    if (label !== "") counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort(
      (a, b) =>
        a.label.localeCompare(b.label, undefined, { sensitivity: "base" }) || a.label.localeCompare(b.label),
    );
}

export type RenamePlan =
  | {
      kind: "rename" | "merge" | "clear";
      from: string;
      /** The label to write; null clears it. For a merge, the existing label's spelling. */
      to: string | null;
      /** Copies whose stored note changes. */
      copies: Copy[];
      /** Copies carrying `to` after the change (0 for a clear). */
      resultCount: number;
    }
  | { kind: "invalid"; reason: string };

/**
 * What renaming `from` to the typed name would do. Copies match `from` exactly after trimming. A
 * new name equal to another label ignoring case and surrounding spaces merges into that label's
 * spelling (the one on more copies if several); a blank name clears the label.
 */
export function planRename(books: BookWithCopies[], from: string, typed: string): RenamePlan {
  const source = from.trim();
  const copies = books.flatMap((b) => b.copies).filter((c) => source !== "" && copyLabel(c) === source);
  if (copies.length === 0) return { kind: "invalid", reason: `No copies are labelled "${source}".` };
  const text = typed.trim();
  if (text === "") return { kind: "clear", from: source, to: null, copies, resultCount: 0 };
  if (text.length > MAX_LABEL) return { kind: "invalid", reason: `Labels are at most ${MAX_LABEL} characters.` };
  if (text === source) return { kind: "invalid", reason: "That is already the label's name." };
  const others = labelCounts(books)
    .filter((l) => l.label !== source && key(l.label) === key(text))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
  if (others.length > 0) {
    const into = others[0];
    return { kind: "merge", from: source, to: into.label, copies, resultCount: into.count + copies.length };
  }
  return { kind: "rename", from: source, to: text, copies, resultCount: copies.length };
}

export type CopyWriter = (id: string, patch: Partial<CopyInput>, editedFields: string[]) => Promise<void>;

/**
 * Writes the plan's label to each copy, adding editionNote to its user_edited_fields so a libib
 * re-import leaves it alone. Only edition_note and user_edited_fields are written. Continues past a
 * failed copy and reports how many changed and failed.
 */
export async function applyRename(
  plan: Extract<RenamePlan, { copies: Copy[] }>,
  write: CopyWriter,
): Promise<{ changed: number; failed: number }> {
  let changed = 0;
  let failed = 0;
  const BATCH = 8;
  for (let i = 0; i < plan.copies.length; i += BATCH) {
    const results = await Promise.allSettled(
      plan.copies
        .slice(i, i + BATCH)
        .map((c) => write(c.id, { editionNote: plan.to }, markEdited(c.userEditedFields, ["editionNote"]))),
    );
    for (const r of results) {
      if (r.status === "fulfilled") changed++;
      else failed++;
    }
  }
  return { changed, failed };
}
