// In-memory catalog and ledger for tests. Not imported by app code.
import type { BookInput, BookWithCopies, Copy } from "../types";
import type { ImportStage, ImportStore } from "./apply";

export type FakeCall =
  | { stage: "books"; rows: Parameters<ImportStore["insertBooks"]>[0] }
  | { stage: "links"; copyId: string; libibId: string }
  | { stage: "copies"; rows: Parameters<ImportStore["insertCopies"]>[0] }
  | { stage: "patches"; bookId: string }
  | { stage: "ledger"; rows: Parameters<ImportStore["upsertLedger"]>[1] };

export interface FakeStoreSeed {
  books?: BookWithCopies[];
  ledger?: Iterable<[string, number]>;
  /** Give all books in one insert the same createdAt, as Postgres's now() does. */
  tiedCreatedAt?: boolean;
}

export type SnapshotCopy = Omit<Copy, "id" | "bookId" | "createdAt" | "updatedAt">;
export type SnapshotBook = Omit<
  BookWithCopies,
  "id" | "householdId" | "createdAt" | "updatedAt" | "copies"
> & { copies: SnapshotCopy[] };

export interface FakeStore extends ImportStore {
  /** Successful writes, in order. A failed call writes nothing and isn't recorded. */
  readonly calls: FakeCall[];
  /** Call number `callIndex` of `stage`, counted from now, throws once and writes nothing. */
  failAt(stage: ImportStage, callIndex: number): void;
  /** Sorted books, each with its sorted copies, generated ids and timestamps removed. */
  snapshot(): SnapshotBook[];
  /** Ordered like the real read: title, then id. */
  listBooks(): BookWithCopies[];
  ledger(): Map<string, number>;
  deleteBook(id: string): void;
  deleteCopy(id: string): void;
  /** A change from outside the import: moves updatedAt, as the real trigger does. */
  editBook(id: string, patch: Partial<BookWithCopies>): void;
}

const byJson = <T>(items: T[]): T[] =>
  [...items].sort((a, b) => {
    const [x, y] = [JSON.stringify(a), JSON.stringify(b)];
    return x < y ? -1 : x > y ? 1 : 0;
  });

function omit<T extends object, K extends keyof T>(item: T, keys: K[]): Omit<T, K> {
  const out = { ...item };
  for (const key of keys) delete out[key];
  return out;
}

export function createFakeStore(seed: FakeStoreSeed = {}): FakeStore {
  const books: BookWithCopies[] = structuredClone(seed.books ?? []);
  const ledger = new Map<string, number>(seed.ledger ?? []);
  const calls: FakeCall[] = [];
  let armed: { stage: ImportStage; remaining: number } | null = null;
  let tick = 0;
  let copySeq = 0;

  const now = () => new Date(Date.UTC(2026, 5, 1) + ++tick * 1000).toISOString();

  function gate(stage: ImportStage) {
    if (armed?.stage !== stage) return;
    if (armed.remaining === 0) {
      armed = null;
      throw new Error(`fake store: ${stage} failed`);
    }
    armed.remaining -= 1;
  }

  function findBook(id: string): BookWithCopies {
    const found = books.find((b) => b.id === id);
    if (!found) throw new Error("fake store: no such book");
    return found;
  }

  return {
    calls,

    failAt(stage, callIndex) {
      armed = { stage, remaining: callIndex };
    },

    snapshot() {
      return byJson(
        books.map((b) => ({
          ...omit(b, ["id", "householdId", "createdAt", "updatedAt"]),
          copies: byJson(b.copies.map((c) => omit(c, ["id", "bookId", "createdAt", "updatedAt"]))),
        })),
      );
    },

    listBooks() {
      return structuredClone(books).sort((a, b) => {
        if (a.title !== b.title) return a.title < b.title ? -1 : 1;
        return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
      });
    },

    ledger() {
      return new Map(ledger);
    },

    deleteBook(id) {
      books.splice(books.indexOf(findBook(id)), 1);
    },

    deleteCopy(id) {
      for (const b of books) b.copies = b.copies.filter((c) => c.id !== id);
    },

    editBook(id, patch) {
      Object.assign(findBook(id), patch, { updatedAt: now() });
    },

    async insertBooks(rows) {
      gate("books");
      // The primary key: a reused id fails the whole request.
      if (rows.some((r) => books.some((b) => b.id === r.id))) {
        throw new Error("fake store: duplicate book id");
      }
      const shared = now();
      for (const { id, householdId, input } of rows) {
        const stamp = seed.tiedCreatedAt ? shared : now();
        books.push({
          ...structuredClone(input),
          id,
          householdId,
          openlibraryId: null,
          googleBooksId: null,
          userEditedFields: [],
          createdAt: stamp,
          updatedAt: stamp,
          copies: [],
        });
      }
      calls.push({ stage: "books", rows });
    },

    async linkCopy(copyId, libibId) {
      gate("links");
      for (const b of books) {
        for (const c of b.copies) if (c.id === copyId) c.libibId = libibId;
      }
      calls.push({ stage: "links", copyId, libibId });
    },

    async insertCopies(rows) {
      gate("copies");
      // Checked first, like the foreign key: one bad row fails the whole request.
      const targets = rows.map((r) => findBook(r.bookId));
      rows.forEach((r, i) => {
        const stamp = now();
        targets[i].copies.push({
          id: `fake-copy-${++copySeq}`,
          bookId: r.bookId,
          ownerUserId: r.ownerUserId,
          editionNote: r.editionNote,
          location: null,
          origin: "libib",
          libibId: r.libibId,
          photoPath: null,
          intakeItemId: null,
          userEditedFields: [],
          createdAt: stamp,
          updatedAt: stamp,
        });
      });
      calls.push({ stage: "copies", rows });
    },

    async patchBook(bookId, expectedUpdatedAt, patch: Partial<BookInput>) {
      gate("patches");
      const found = books.find((b) => b.id === bookId);
      if (!found || found.updatedAt !== expectedUpdatedAt) return false;
      Object.assign(found, structuredClone(patch), { updatedAt: now() });
      calls.push({ stage: "patches", bookId });
      return true;
    },

    async upsertLedger(_householdId, rows) {
      gate("ledger");
      for (const r of rows) ledger.set(r.libibId, r.copiesSeen);
      calls.push({ stage: "ledger", rows });
    },
  };
}
