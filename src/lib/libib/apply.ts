import type { BookInput } from "../types";
import type { BookRef, ImportPlan, PlannedCopy } from "./plan";

const CHUNK_SIZE = 200;

export interface ImportStore {
  insertBooks(rows: { id: string; householdId: string; input: BookInput }[]): Promise<void>;
  /** origin 'libib' */
  insertCopies(
    rows: { bookId: string; ownerUserId: string | null; editionNote: string | null; libibId: string }[],
  ): Promise<void>;
  /** updates libib_id only */
  linkCopy(copyId: string, libibId: string): Promise<void>;
  /** false if the row changed */
  patchBook(bookId: string, expectedUpdatedAt: string, patch: Partial<BookInput>): Promise<boolean>;
  upsertLedger(householdId: string, rows: { libibId: string; copiesSeen: number }[]): Promise<void>;
}

export type ImportStage = "books" | "links" | "copies" | "patches" | "ledger";

export class ImportWriteError extends Error {
  stage: ImportStage;
  override cause: unknown;
  constructor(stage: ImportStage, cause: unknown) {
    super(`libib import failed at ${stage}`);
    this.name = "ImportWriteError";
    this.stage = stage;
    this.cause = cause;
  }
}

export interface ApplyResult {
  /** titles */
  patchesSkipped: string[];
}

function chunked<T>(items: T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += CHUNK_SIZE) out.push(items.slice(i, i + CHUNK_SIZE));
  return out;
}

/**
 * A row's copies travel in one request, so a failure can't leave only some of them: a restored
 * row with one of its two copies back would look complete. A chunk may run over by that row.
 */
function copyChunks(copies: PlannedCopy[]): PlannedCopy[][] {
  const byRow = new Map<string, PlannedCopy[]>();
  for (const copy of copies) {
    const row = byRow.get(copy.libibId);
    if (row) row.push(copy);
    else byRow.set(copy.libibId, [copy]);
  }
  const out: PlannedCopy[][] = [];
  let current: PlannedCopy[] = [];
  for (const row of byRow.values()) {
    current.push(...row);
    if (current.length >= CHUNK_SIZE) {
      out.push(current);
      current = [];
    }
  }
  if (current.length > 0) out.push(current);
  return out;
}

/**
 * Writes in D10's order; after a failure, a plan rebuilt from the catalog finishes the job.
 * Links go before copies, or a `link` row's added copies would make it known and it would never
 * link. The ledger goes last, because a row in it counts as seen even with no copy written.
 */
export async function applyImportPlan(
  plan: ImportPlan,
  householdId: string,
  store: ImportStore,
  opts: { newId(): string; onProgress?(done: number, total: number): void },
): Promise<ApplyResult> {
  const total =
    plan.newBooks.length +
    plan.links.length +
    plan.newCopies.length +
    plan.bookPatches.length +
    plan.ledger.length;
  let done = 0;
  const advance = (count: number) => {
    done += count;
    opts.onProgress?.(done, total);
  };

  async function stage(name: ImportStage, write: () => Promise<void>) {
    try {
      await write();
    } catch (cause) {
      throw new ImportWriteError(name, cause);
    }
  }

  const newBookIds = new Map(plan.newBooks.map((b) => [b.libibId, opts.newId()]));
  function bookIdOf(ref: BookRef): string {
    if (ref.kind === "existing") return ref.bookId;
    const id = newBookIds.get(ref.libibId);
    if (id === undefined) throw new Error("planned copy refers to a book not in the plan");
    return id;
  }

  await stage("books", async () => {
    for (const chunk of chunked(plan.newBooks)) {
      await store.insertBooks(
        chunk.map((b) => ({ id: newBookIds.get(b.libibId)!, householdId, input: b.input })),
      );
      advance(chunk.length);
    }
  });

  await stage("links", async () => {
    for (const link of plan.links) {
      await store.linkCopy(link.copyId, link.libibId);
      advance(1);
    }
  });

  await stage("copies", async () => {
    for (const chunk of copyChunks(plan.newCopies)) {
      await store.insertCopies(
        chunk.map((c) => ({
          bookId: bookIdOf(c.book),
          ownerUserId: c.ownerUserId,
          editionNote: c.editionNote,
          libibId: c.libibId,
        })),
      );
      advance(chunk.length);
    }
  });

  const patchesSkipped: string[] = [];
  await stage("patches", async () => {
    for (const p of plan.bookPatches) {
      const applied = await store.patchBook(p.bookId, p.expectedUpdatedAt, p.patch);
      if (!applied) patchesSkipped.push(p.title);
      advance(1);
    }
  });

  await stage("ledger", async () => {
    for (const chunk of chunked(plan.ledger)) {
      await store.upsertLedger(householdId, chunk);
      advance(chunk.length);
    }
  });

  return { patchesSkipped };
}
