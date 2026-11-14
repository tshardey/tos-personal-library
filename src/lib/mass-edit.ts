import { markEdited } from "@/lib/edited-fields";
import { canonicalLabel } from "@/lib/editions";
import { canonicalSeries, seriesNames } from "@/lib/series";
import type { Book, BookWithCopies, Copy, CopyPatch } from "@/lib/types";

/**
 * What the mass-edit sheet asks for. A key left undefined is "no change"; null clears the value.
 * `ownerUserId: null` is Shared. `unhauled: true` sets unhauled_at, false clears it.
 */
export interface MassEdit {
  editionNote?: string | null;
  location?: string | null;
  ownerUserId?: string | null;
  deluxe?: boolean;
  signed?: boolean;
  unhauled?: boolean;
  seriesName?: string | null;
  /** Library tag ids to add to / remove from every target book. A tag in both is ignored. */
  addLibraryTags?: string[];
  removeLibraryTags?: string[];
}

/** Which rows the edit reaches: copy changes go to these copies, the series to these books. */
export interface MassEditTargets {
  copyIds: ReadonlySet<string>;
  bookIds: ReadonlySet<string>;
}

export interface CopyChange {
  copy: Copy;
  book: Book;
  patch: CopyPatch;
  /** The copy's user_edited_fields after the write: existing plus each changed key, no duplicates. */
  editedFields: string[];
}

export interface BookChange {
  book: Book;
  patch: { seriesName: string | null };
  editedFields: string[];
}

/** One book's library tag writes: only tags that would change. */
export interface LibraryTagChange {
  book: Book;
  add: string[];
  remove: string[];
}

export interface ChangeSet {
  copies: CopyChange[];
  books: BookChange[];
  libraryTags: LibraryTagChange[];
}

const key = (s: string): string => s.toLowerCase();

/** Household location spellings, grouped like edition labels: trimmed, case-insensitive, most-used spelling. */
export function locationNames(books: BookWithCopies[]): string[] {
  const groups = new Map<string, Map<string, number>>();
  for (const copy of books.flatMap((b) => b.copies)) {
    const name = (copy.location ?? "").trim();
    if (name === "") continue;
    const spellings = groups.get(key(name)) ?? new Map<string, number>();
    spellings.set(name, (spellings.get(name) ?? 0) + 1);
    groups.set(key(name), spellings);
  }
  const names = [...groups.values()].map(
    (spellings) => [...spellings.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0],
  );
  return names.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
}

/** The location to store for typed text: an existing spelling on a case-insensitive hit, else the trimmed text; blank is null. */
export function canonicalLocation(typed: string, names: string[]): string | null {
  const text = typed.trim();
  if (text === "") return null;
  return names.find((n) => key(n) === key(text)) ?? text;
}

/** Typed values snapped to the household's existing spellings; blank text clears. */
function resolve(edit: MassEdit, books: BookWithCopies[], labels: string[]): MassEdit {
  const out = { ...edit };
  if (typeof edit.editionNote === "string") out.editionNote = canonicalLabel(edit.editionNote, labels);
  if (typeof edit.location === "string") out.location = canonicalLocation(edit.location, locationNames(books));
  if (typeof edit.seriesName === "string") out.seriesName = canonicalSeries(edit.seriesName, seriesNames(books));
  return out;
}

/**
 * The writes a mass edit needs. Only touched fields are considered, and a field is written only
 * where its value would change, so a copy already labelled "Allurial" isn't rewritten or counted.
 * `labels` are the household's edition labels (the picker's list). `now` stamps newly unhauled copies.
 */
export function buildChangeSet(
  books: BookWithCopies[],
  targets: MassEditTargets,
  rawEdit: MassEdit,
  labels: string[],
  now: string,
  libraryTagsByBook: ReadonlyMap<string, string[]> = new Map(),
): ChangeSet {
  const edit = resolve(rawEdit, books, labels);
  const copies: CopyChange[] = [];
  const bookChanges: BookChange[] = [];
  const tagChanges: LibraryTagChange[] = [];
  const toAdd = new Set(edit.addLibraryTags ?? []);
  const toRemove = new Set(edit.removeLibraryTags ?? []);
  for (const id of [...toAdd]) {
    if (toRemove.has(id)) {
      toAdd.delete(id);
      toRemove.delete(id);
    }
  }
  for (const book of books) {
    for (const copy of book.copies) {
      if (!targets.copyIds.has(copy.id)) continue;
      const patch: CopyPatch = {};
      if (edit.editionNote !== undefined && copy.editionNote !== edit.editionNote) patch.editionNote = edit.editionNote;
      if (edit.location !== undefined && copy.location !== edit.location) patch.location = edit.location;
      if (edit.ownerUserId !== undefined && copy.ownerUserId !== edit.ownerUserId) patch.ownerUserId = edit.ownerUserId;
      if (edit.deluxe !== undefined && copy.deluxe !== edit.deluxe) patch.deluxe = edit.deluxe;
      if (edit.signed !== undefined && copy.signed !== edit.signed) patch.signed = edit.signed;
      if (edit.unhauled === true && copy.unhauledAt === null) patch.unhauledAt = now;
      if (edit.unhauled === false && copy.unhauledAt !== null) patch.unhauledAt = null;
      const changed = Object.keys(patch);
      if (changed.length > 0) {
        copies.push({ copy, book, patch, editedFields: markEdited(copy.userEditedFields, changed) });
      }
    }
    if (edit.seriesName !== undefined && targets.bookIds.has(book.id) && book.seriesName !== edit.seriesName) {
      bookChanges.push({
        book,
        patch: { seriesName: edit.seriesName },
        editedFields: markEdited(book.userEditedFields, ["seriesName"]),
      });
    }
    if ((toAdd.size > 0 || toRemove.size > 0) && targets.bookIds.has(book.id)) {
      const has = new Set(libraryTagsByBook.get(book.id) ?? []);
      const add = [...toAdd].filter((t) => !has.has(t));
      const remove = [...toRemove].filter((t) => has.has(t));
      if (add.length + remove.length > 0) tagChanges.push({ book, add, remove });
    }
  }
  return { copies, books: bookChanges, libraryTags: tagChanges };
}

export const copiesWord = (n: number): string => `${n} ${n === 1 ? "copy" : "copies"}`;
export const seriesWord = (n: number): string => `${n} ${n === 1 ? "book's" : "books'"} series`;
export const tagsWord = (n: number): string => `${n} ${n === 1 ? "book's" : "books'"} tags`;

/** "14 copies and 3 books' series", "1 copy", "2 books' tags", "1 copy, 2 books' series and 3 books' tags". */
export function describeCounts(copies: number, books: number, tagBooks = 0): string {
  const parts = [
    copies > 0 && copiesWord(copies),
    books > 0 && seriesWord(books),
    tagBooks > 0 && tagsWord(tagBooks),
  ].filter((p): p is string => typeof p === "string");
  if (parts.length <= 1) return parts.join("");
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

export interface MassEditWriters {
  writeCopy(id: string, patch: CopyPatch, editedFields: string[]): Promise<void>;
  writeBook(id: string, patch: { seriesName: string | null }, editedFields: string[]): Promise<void>;
  /** Needed only when the change set has library tag changes; without them those books fail. */
  addLibraryTag?(bookId: string, tagId: string): Promise<void>;
  /** A delete, so the server trigger records the tag as removed by hand. */
  removeLibraryTag?(bookId: string, tagId: string): Promise<void>;
}

export interface MassEditResult {
  changedCopies: number;
  changedBooks: number;
  failedCopies: CopyChange[];
  failedBooks: BookChange[];
  changedTagBooks: number;
  /** A book is here if any of its tag writes failed. */
  failedTags: LibraryTagChange[];
}

/** At most this many writes in flight at once. */
export const WRITE_BATCH = 8;

/**
 * Runs the change set in batches of WRITE_BATCH. A failed write doesn't stop the rest: it is
 * returned so the person can see which ones and try them again.
 */
export async function applyChangeSet(set: ChangeSet, writers: MassEditWriters): Promise<MassEditResult> {
  type Job = { run: () => Promise<void>; fail: () => void; ok: () => void };
  const result: MassEditResult = {
    changedCopies: 0,
    changedBooks: 0,
    failedCopies: [],
    failedBooks: [],
    changedTagBooks: 0,
    failedTags: [],
  };
  const writeTags = async (c: LibraryTagChange): Promise<void> => {
    const { addLibraryTag, removeLibraryTag } = writers;
    if (!addLibraryTag || !removeLibraryTag) throw new Error("no tag writers");
    const settled = await Promise.allSettled([
      ...c.add.map((t) => addLibraryTag(c.book.id, t)),
      ...c.remove.map((t) => removeLibraryTag(c.book.id, t)),
    ]);
    const failed = settled.find((r) => r.status === "rejected");
    if (failed) throw (failed as PromiseRejectedResult).reason;
  };
  const jobs: Job[] = [
    ...set.copies.map((c) => ({
      run: () => writers.writeCopy(c.copy.id, c.patch, c.editedFields),
      ok: () => result.changedCopies++,
      fail: () => result.failedCopies.push(c),
    })),
    ...set.books.map((b) => ({
      run: () => writers.writeBook(b.book.id, b.patch, b.editedFields),
      ok: () => result.changedBooks++,
      fail: () => result.failedBooks.push(b),
    })),
    ...set.libraryTags.map((c) => ({
      run: () => writeTags(c),
      ok: () => result.changedTagBooks++,
      fail: () => result.failedTags.push(c),
    })),
  ];
  for (let i = 0; i < jobs.length; i += WRITE_BATCH) {
    const batch = jobs.slice(i, i + WRITE_BATCH);
    const settled = await Promise.allSettled(batch.map((j) => j.run()));
    settled.forEach((r, n) => (r.status === "fulfilled" ? batch[n].ok() : batch[n].fail()));
  }
  return result;
}

/** The targets for trying failed writes again, against a freshly loaded catalogue. */
export function retryTargets(result: MassEditResult): MassEditTargets {
  return {
    copyIds: new Set(result.failedCopies.map((c) => c.copy.id)),
    bookIds: new Set([...result.failedBooks.map((b) => b.book.id), ...result.failedTags.map((c) => c.book.id)]),
  };
}
