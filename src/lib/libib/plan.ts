import type { Book, BookInput, BookWithCopies } from "../types";
import { fillPatch } from "./fill-patch";
import { canonicalIsbns } from "./isbn";
import { authorsOverlap, baseTitleKey, titleKey } from "./match-keys";
import { ownerUserIdFor, type CollectionMapping } from "./owner-map";
import type { LibibRow, ParsedFile } from "./parse";

export type BookRef = { kind: "existing"; bookId: string } | { kind: "pending"; libibId: string };
export type ReviewDecision =
  | { action: "link"; copyId: string }
  | { action: "add_copy"; book: BookRef }
  | { action: "new_book" };
export type ReviewReason =
  | "rescan"
  | "existing_copy"
  | "same_title"
  | "similar_title"
  | "several_isbn_matches";

export interface ReviewItem {
  libibId: string;
  rowNumber: number;
  title: string;
  authors: string[];
  reason: ReviewReason;
  options: ReviewDecision[];
  chosen: ReviewDecision;
}

export interface PlannedCopy {
  book: BookRef;
  ownerUserId: string | null;
  editionNote: string | null;
  libibId: string;
}

export interface ImportSummary {
  newBooks: number;
  /** excludes the first copy of each new book */
  newCopies: number;
  filled: number;
  unchanged: number;
  review: number;
  removed: number;
  skippedCollection: number;
}

export interface ImportPlan {
  newBooks: { libibId: string; input: BookInput }[];
  newCopies: PlannedCopy[];
  links: { copyId: string; libibId: string }[];
  bookPatches: { bookId: string; expectedUpdatedAt: string; title: string; patch: Partial<BookInput> }[];
  ledger: { libibId: string; copiesSeen: number }[];
  review: ReviewItem[];
  removed: { libibId: string; title: string }[];
  summary: ImportSummary;
}

export interface PlanInput {
  file: ParsedFile;
  catalog: BookWithCopies[];
  ledger: Map<string, number>;
  /** every collection in file has a choice; caller enforces */
  mapping: CollectionMapping;
  decisions: Map<string, ReviewDecision>;
  /** libibIds ticked "Import again" */
  restore: Set<string>;
}

export type PlanState = "writes" | "ledger_only" | "removed_only" | "nothing";

/** A catalog copy (copyId set) or one planned in this run (copyId null). */
interface WorkCopy {
  copyId: string | null;
  ownerUserId: string | null;
  libibId: string | null;
  /** the target of a link in this run */
  consumed: boolean;
}

/** A catalog book or a pending new one, carrying this run's fills and copies. */
interface WorkBook {
  ref: BookRef;
  book: Book;
  copies: WorkCopy[];
  isbns: Set<string>;
  titleKey: string;
  baseTitleKey: string;
}

function workBook(ref: BookRef, book: Book, copies: WorkCopy[]): WorkBook {
  return {
    ref,
    book,
    copies,
    isbns: canonicalIsbns(book),
    titleKey: titleKey(book.title),
    baseTitleKey: baseTitleKey(book.title),
  };
}

/** fillPatch reads a Book; a pending book has only its input, nothing edited. */
function pendingBook(input: BookInput): Book {
  return {
    ...input,
    id: "",
    householdId: "",
    openlibraryId: null,
    googleBooksId: null,
    userEditedFields: [],
    createdAt: "",
    updatedAt: "",
  };
}

const oldestFirst = (a: Book, b: Book): number => {
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1;
  if (a.id !== b.id) return a.id < b.id ? -1 : 1;
  return 0;
};

function sameRef(a: BookRef, b: BookRef): boolean {
  if (a.kind === "existing") return b.kind === "existing" && a.bookId === b.bookId;
  return b.kind === "pending" && a.libibId === b.libibId;
}

function sameDecision(a: ReviewDecision, b: ReviewDecision): boolean {
  if (a.action === "link") return b.action === "link" && a.copyId === b.copyId;
  if (a.action === "add_copy") return b.action === "add_copy" && sameRef(a.book, b.book);
  return b.action === "new_book";
}

/** Pure and deterministic: inputs are read, never changed. */
export function buildImportPlan(input: PlanInput): ImportPlan {
  const { file, catalog, ledger, mapping, decisions, restore } = input;

  // Oldest first, pending books appended: the first match of any scan is the oldest.
  const books = [...catalog]
    .sort(oldestFirst)
    .map((b) =>
      workBook(
        { kind: "existing", bookId: b.id },
        b,
        b.copies.map((c) => ({
          copyId: c.id,
          ownerUserId: c.ownerUserId,
          libibId: c.libibId,
          consumed: false,
        })),
      ),
    );
  const byRef = new Map<string, WorkBook>();
  const refKey = (ref: BookRef) =>
    ref.kind === "existing" ? `existing:${ref.bookId}` : `pending:${ref.libibId}`;
  const copyById = new Map<string, WorkCopy>();
  /** The first book holding a live, linked or planned copy with this libib id. */
  const holder = new Map<string, WorkBook>();
  const liveCount = new Map<string, number>();
  for (const w of books) {
    byRef.set(refKey(w.ref), w);
    for (const c of w.copies) {
      copyById.set(c.copyId!, c);
      if (c.libibId !== null) {
        if (!holder.has(c.libibId)) holder.set(c.libibId, w);
        liveCount.set(c.libibId, (liveCount.get(c.libibId) ?? 0) + 1);
      }
    }
  }

  const pendingInputs: { libibId: string; work: WorkBook }[] = [];
  const newCopies: PlannedCopy[] = [];
  const links: ImportPlan["links"] = [];
  const patches = new Map<string, ImportPlan["bookPatches"][number]>();
  const ledgerOut: ImportPlan["ledger"] = [];
  const review: ReviewItem[] = [];
  const removed: ImportPlan["removed"] = [];
  let filled = 0;
  let unchanged = 0;
  let skippedCollection = 0;

  /** Applies D4 fill-only to the working book; true when a catalog book gets a patch. */
  function fill(work: WorkBook, row: LibibRow): boolean {
    const { changed, patch } = fillPatch(work.book, row.book);
    if (changed.length === 0) return false;
    work.book = { ...work.book, ...patch };
    work.isbns = canonicalIsbns(work.book);
    if (work.ref.kind === "pending") return false;
    const entry = patches.get(work.ref.bookId);
    if (entry) entry.patch = { ...entry.patch, ...patch };
    else {
      patches.set(work.ref.bookId, {
        bookId: work.ref.bookId,
        expectedUpdatedAt: work.book.updatedAt,
        title: work.book.title,
        patch,
      });
    }
    return true;
  }

  function addCopies(work: WorkBook, row: LibibRow, ownerUserId: string | null, count: number) {
    for (let i = 0; i < count; i++) {
      newCopies.push({
        book: work.ref,
        ownerUserId,
        editionNote: row.editionNote,
        libibId: row.libibId,
      });
      work.copies.push({ copyId: null, ownerUserId, libibId: row.libibId, consumed: false });
    }
    if (count > 0 && !holder.has(row.libibId)) holder.set(row.libibId, work);
  }

  const addCopyOption = (w: WorkBook): ReviewDecision => ({ action: "add_copy", book: w.ref });
  const linkOption = (c: WorkCopy): ReviewDecision => ({ action: "link", copyId: c.copyId! });

  /** A retained add_copy to a pending X means the book now holding X's copy. */
  function retainedDecision(libibId: string): ReviewDecision | undefined {
    const retained = decisions.get(libibId);
    if (retained?.action !== "add_copy" || retained.book.kind !== "pending") return retained;
    const held = holder.get(retained.book.libibId);
    return held ? { action: "add_copy", book: held.ref } : undefined;
  }

  function ask(
    row: LibibRow,
    reason: ReviewReason,
    options: ReviewDecision[],
    fallback: ReviewDecision,
  ): ReviewDecision {
    const retained = retainedDecision(row.libibId);
    const chosen = (retained && options.find((o) => sameDecision(o, retained))) ?? fallback;
    review.push({
      libibId: row.libibId,
      rowNumber: row.rowNumber,
      title: row.book.title,
      authors: row.book.authors,
      reason,
      options,
      chosen,
    });
    return chosen;
  }

  /** D3: an ISBN matched exactly one book. */
  function decideIsbnMatch(row: LibibRow, match: WorkBook, ownerUserId: string | null): ReviewDecision {
    const add = addCopyOption(match);
    const sameOwner = match.copies.filter((c) => c.ownerUserId === ownerUserId && !c.consumed);
    const absent = sameOwner.filter((c) => c.libibId !== null && !file.allIds.has(c.libibId));
    const noId = sameOwner.filter((c) => c.libibId === null);
    if (absent.length > 0) {
      const options = [...absent, ...noId].map(linkOption);
      return ask(row, "rescan", [...options, add], options[0]);
    }
    if (noId.length > 0) return ask(row, "existing_copy", [...noId.map(linkOption), add], add);
    return add;
  }

  function decide(row: LibibRow, ownerUserId: string | null): ReviewDecision {
    const newBook: ReviewDecision = { action: "new_book" };

    const rowIsbns = canonicalIsbns(row.book);
    const isbnMatches = books.filter((w) => [...rowIsbns].some((i) => w.isbns.has(i)));
    if (isbnMatches.length > 1) {
      const options = isbnMatches.map(addCopyOption);
      return ask(row, "several_isbn_matches", options, options[0]);
    }
    if (isbnMatches.length === 1) return decideIsbnMatch(row, isbnMatches[0], ownerUserId);

    const key = titleKey(row.book.title);
    const baseKey = baseTitleKey(row.book.title);
    const authorsMatch = (w: WorkBook) => authorsOverlap(row.book.authors, w.book.authors);
    const strong = key === "" ? [] : books.filter((w) => w.titleKey === key && authorsMatch(w));

    const adoptable = strong.find((w) => w.copies.length === 0);
    if (adoptable) return addCopyOption(adoptable);

    if (strong.length > 0) {
      const options = strong.map(addCopyOption);
      return ask(row, "same_title", [...options, newBook], options[0]);
    }
    const weak =
      baseKey === "" ? [] : books.filter((w) => w.baseTitleKey === baseKey && authorsMatch(w));
    if (weak.length > 0) {
      return ask(row, "similar_title", [...weak.map(addCopyOption), newBook], newBook);
    }
    return newBook;
  }

  /** Runs the ladder and applies its outcome. `link` fills too, or the next run would. */
  function runLadder(row: LibibRow, ownerUserId: string | null, count: number) {
    const decision = decide(row, ownerUserId);
    if (decision.action === "new_book") {
      const ref: BookRef = { kind: "pending", libibId: row.libibId };
      const work = workBook(ref, pendingBook(row.book), []);
      books.push(work);
      byRef.set(refKey(ref), work);
      pendingInputs.push({ libibId: row.libibId, work });
      addCopies(work, row, ownerUserId, count);
      return;
    }
    let work: WorkBook;
    let remaining = count;
    if (decision.action === "link") {
      const target = copyById.get(decision.copyId)!;
      work = books.find((w) => w.copies.includes(target))!;
      target.consumed = true;
      target.libibId = row.libibId;
      links.push({ copyId: decision.copyId, libibId: row.libibId });
      if (!holder.has(row.libibId)) holder.set(row.libibId, work);
      remaining -= 1;
    } else {
      work = byRef.get(refKey(decision.book))!;
    }
    addCopies(work, row, ownerUserId, remaining);
    if (fill(work, row)) filled += 1;
  }

  for (const row of file.rows) {
    const choice = mapping[row.collection];
    if (choice === undefined || choice === "skip") {
      skippedCollection += 1;
      continue;
    }
    const ownerUserId = ownerUserIdFor(choice);
    const stored = ledger.get(row.libibId);
    const live = liveCount.get(row.libibId) ?? 0;
    const seen = Math.max(stored ?? 0, live);
    const copiesSeen = Math.max(seen, row.copies);
    const missing = row.copies - seen;

    if (live > 0) {
      const work = holder.get(row.libibId)!;
      if (missing > 0) addCopies(work, row, ownerUserId, missing);
      if (fill(work, row)) filled += 1;
      else if (missing <= 0) unchanged += 1;
      if (copiesSeen !== stored) ledgerOut.push({ libibId: row.libibId, copiesSeen });
      continue;
    }

    if (seen > 0 && missing <= 0 && !restore.has(row.libibId)) {
      removed.push({ libibId: row.libibId, title: row.book.title });
      continue;
    }
    runLadder(row, ownerUserId, missing > 0 ? missing : row.copies);
    ledgerOut.push({ libibId: row.libibId, copiesSeen });
  }

  const newBooks = pendingInputs.map(({ libibId, work }) => ({
    libibId,
    input: toBookInput(work.book),
  }));

  return {
    newBooks,
    newCopies,
    links,
    bookPatches: [...patches.values()],
    ledger: ledgerOut,
    review,
    removed,
    summary: {
      newBooks: newBooks.length,
      newCopies: newCopies.length - newBooks.length,
      filled,
      unchanged,
      review: review.length,
      removed: removed.length,
      skippedCollection,
    },
  };
}

function toBookInput(b: Book): BookInput {
  return {
    title: b.title,
    authors: b.authors,
    synopsis: b.synopsis,
    coverUrl: b.coverUrl,
    isbn13: b.isbn13,
    isbn10: b.isbn10,
    pageCount: b.pageCount,
    publisher: b.publisher,
    publishDate: b.publishDate,
  };
}

export function sameSummary(a: ImportSummary, b: ImportSummary): boolean {
  return (
    a.newBooks === b.newBooks &&
    a.newCopies === b.newCopies &&
    a.filled === b.filled &&
    a.unchanged === b.unchanged &&
    a.review === b.review &&
    a.removed === b.removed &&
    a.skippedCollection === b.skippedCollection
  );
}

export function planState(plan: ImportPlan): PlanState {
  if (
    plan.newBooks.length > 0 ||
    plan.newCopies.length > 0 ||
    plan.links.length > 0 ||
    plan.bookPatches.length > 0
  ) {
    return "writes";
  }
  if (plan.ledger.length > 0) return "ledger_only";
  if (plan.removed.length > 0) return "removed_only";
  return "nothing";
}
