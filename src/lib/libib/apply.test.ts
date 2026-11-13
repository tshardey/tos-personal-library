import { describe, expect, it } from "vitest";
import type { BookWithCopies, Copy } from "../types";
import { applyImportPlan, ImportWriteError, type ImportStage } from "./apply";
import { createFakeStore, type FakeStore, type FakeStoreSeed } from "./fake-store";
import { libibCsv } from "./fixtures";
import { parseLibibCsv } from "./parse";
import { buildImportPlan, planState, type ImportPlan, type ReviewDecision } from "./plan";

const HOUSEHOLD = "h1";
const COLLECTION = "Test Books";
const OTHER = "Other Books";
const OLD = "2026-01-01T00:00:00+00:00";

/** A synthetic, checksum-valid ISBN-13. */
function isbn(n: number): string {
  const body = `978${String(n).padStart(9, "0")}`;
  const sum = [...body].reduce((acc, d, i) => acc + Number(d) * (i % 2 === 0 ? 1 : 3), 0);
  return `${body}${(10 - (sum % 10)) % 10}`;
}

function seededCopy(over: Partial<Copy> & { id: string; bookId: string }): Copy {
  return {
    ownerUserId: "u1",
    editionNote: null,
    copyNote: null,
    location: null,
    origin: "libib",
    libibId: null,
    photoPath: null,
    intakeItemId: null,
    unhauledAt: null,
    deluxe: false,
    signed: false,
    userEditedFields: [],
    createdAt: OLD,
    updatedAt: OLD,
    ...over,
  };
}

/** `publisher` marks a seeded book, so a snapshot without ids still tells it from a new one. */
function seededBook(over: Partial<BookWithCopies> & { id: string }): BookWithCopies {
  return {
    householdId: HOUSEHOLD,
    title: "Sample Title",
    authors: ["Wren Halloway"],
    synopsis: null,
    coverUrl: null,
    isbn13: [],
    isbn10: [],
    openlibraryId: null,
    googleBooksId: null,
    pageCount: null,
    publisher: `Seeded ${over.id}`,
    publishDate: null,
    seriesName: null,
    seriesVolume: null,
    onShelf: true,
    userEditedFields: [],
    createdAt: OLD,
    updatedAt: OLD,
    copies: [],
    ...over,
  };
}

type CsvRow = Partial<Record<string, string>>;

interface Scenario {
  rows: CsvRow[];
  seed?: () => FakeStoreSeed;
  decisions?: Map<string, ReviewDecision>;
  restore?: Set<string>;
  /** Generated book ids, in order, for the first run. */
  ids?: string[];
}

const mapping = { [COLLECTION]: "u1", [OTHER]: "shared" };

function planFor(store: FakeStore, s: Scenario): ImportPlan {
  return buildImportPlan({
    file: parseLibibCsv(libibCsv(s.rows)),
    catalog: store.listBooks(),
    ledger: store.ledger(),
    mapping,
    decisions: s.decisions ?? new Map(),
    restore: s.restore ?? new Set(),
  });
}

let idSeq = 500_000;

/** Unique across runs, like a UUID. A step of -1 sorts later books first, for tied createdAt. */
function idSource(ids: string[] = [], step: 1 | -1 = 1) {
  const queue = [...ids];
  return () => queue.shift() ?? `generated-${String((idSeq += step)).padStart(6, "0")}`;
}

const apply = (plan: ImportPlan, store: FakeStore, ids?: string[], step?: 1 | -1) =>
  applyImportPlan(plan, HOUSEHOLD, store, { newId: idSource(ids, step) });

const finalState = (store: FakeStore) => ({
  books: store.snapshot(),
  ledger: [...store.ledger()].sort(([a], [b]) => (a < b ? -1 : 1)),
});

function failurePoints(store: FakeStore): { stage: ImportStage; callIndex: number }[] {
  const seen = new Map<ImportStage, number>();
  return store.calls.map(({ stage }) => {
    const callIndex = seen.get(stage) ?? 0;
    seen.set(stage, callIndex + 1);
    return { stage, callIndex };
  });
}

/** RF5: fail at every call of every stage, rerun from a rebuilt plan, compare with no failure. */
async function expectConverges(s: Scenario, stages: ImportStage[] = []) {
  const variants = [
    { tiedCreatedAt: false, step: 1 },
    { tiedCreatedAt: true, step: 1 },
    { tiedCreatedAt: true, step: -1 },
  ] as const;
  for (const { tiedCreatedAt, step } of variants) {
    const clean = createFakeStore({ ...s.seed?.(), tiedCreatedAt });
    await apply(planFor(clean, s), clean, s.ids, step);
    const want = finalState(clean);
    expect(planState(planFor(clean, s))).toBe("nothing");

    const points = failurePoints(clean);
    for (const stage of stages) expect(points.map((p) => p.stage)).toContain(stage);

    for (const { stage, callIndex } of points) {
      const label = `failed at ${stage} #${callIndex}, tied ${tiedCreatedAt}, id step ${step}`;
      const store = createFakeStore({ ...s.seed?.(), tiedCreatedAt });
      store.failAt(stage, callIndex);
      const error = await apply(planFor(store, s), store, s.ids, step).catch((e: unknown) => e);
      expect(error, label).toBeInstanceOf(ImportWriteError);
      expect((error as ImportWriteError).stage, label).toBe(stage);

      await apply(planFor(store, s), store, undefined, step);
      expect(finalState(store), label).toEqual(want);
      expect(planState(planFor(store, s)), label).toBe("nothing");
    }
  }
}

const ALL_STAGES: ImportStage[] = ["books", "links", "copies", "patches", "ledger"];

/** A fresh-catalog file: ISBN, no-ISBN, no-author, multi-copy and two-collection rows. */
const FRESH_ROWS: CsvRow[] = [
  {
    id: "NEWISBN",
    title: "Plain New (Deluxe Edition)",
    ean_isbn13: isbn(6),
    description: "A synopsis",
    length: "210",
    publisher: "Small Press",
  },
  { id: "NEWNOISBN", title: "No Isbn Book", creators: "Ash Morrow", ean_isbn13: "" },
  { id: "NOAUTHOR", title: "Anonymous Almanac", creators: "", ean_isbn13: "" },
  { id: "MULTI", title: "Many Copies", ean_isbn13: isbn(7), copies: "3" },
  { id: "COLL1", title: "Both Shelves", ean_isbn13: isbn(8) },
  { id: "COLL2", title: "Both Shelves", ean_isbn13: isbn(8), collection: OTHER, description: "Theirs" },
];

/** Rows that need the catalog below: review reasons, a fill on a new copy, a fill on a known row. */
const CATALOG_ROWS: CsvRow[] = [
  { id: "RESCAN", title: "Rescan Book", ean_isbn13: isbn(1) },
  { id: "EXISTING", title: "Photo Book", ean_isbn13: isbn(2) },
  { id: "SAMENOISBN", title: "Same Title Book", ean_isbn13: "" },
  { id: "SAMEDIFF", title: "Same Title Book", ean_isbn13: isbn(4) },
  { id: "FILL", title: "Fill Book", ean_isbn13: isbn(5), description: "Filled in", length: "99" },
  { id: "KNOWN", title: "Known Book", ean_isbn13: isbn(9), description: "Known synopsis" },
  { id: "PAIRX", title: "Pair Book", ean_isbn13: "" },
  { id: "PAIRY", title: "Pair Book", ean_isbn13: "" },
];

const MIXED_ROWS = [...FRESH_ROWS, ...CATALOG_ROWS];

function mixedSeed(): FakeStoreSeed {
  const withCopy = (id: string, over: Partial<BookWithCopies>, copy: Partial<Copy>) =>
    seededBook({ id, ...over, copies: [seededCopy({ id: `c-${id}`, bookId: id, ...copy })] });
  return {
    books: [
      withCopy("rescan", { title: "Rescan Book", isbn13: [isbn(1)] }, { libibId: "GONE" }),
      withCopy("photo", { title: "Photo Book", isbn13: [isbn(2)] }, { origin: "photo" }),
      withCopy("same", { title: "Same Title Book", isbn13: [isbn(3)] }, { libibId: "HADSAME" }),
      withCopy("fill", { title: "Fill Book", isbn13: [isbn(5)] }, { libibId: "HADFILL", ownerUserId: "u2" }),
      withCopy("known", { title: "Known Book", isbn13: [isbn(9)] }, { libibId: "KNOWN" }),
      withCopy("pair", { title: "Pair Book" }, { libibId: "HADPAIR" }),
    ],
    ledger: [["KNOWN", 1]],
  };
}

const ADD_TO_RESCAN: ReviewDecision = { action: "add_copy", book: { kind: "existing", bookId: "rescan" } };
const NON_DEFAULT = new Map<string, ReviewDecision>([
  ["RESCAN", ADD_TO_RESCAN],
  ["EXISTING", { action: "link", copyId: "c-photo" }],
  ["SAMENOISBN", { action: "new_book" }],
  ["SAMEDIFF", { action: "new_book" }],
  ["PAIRX", { action: "new_book" }],
  ["PAIRY", { action: "add_copy", book: { kind: "pending", libibId: "PAIRX" } }],
]);

describe("applyImportPlan: order and chunks", () => {
  it("writes books, then links, then copies, then patches, then the ledger", async () => {
    const store = createFakeStore(mixedSeed());
    await apply(planFor(store, { rows: MIXED_ROWS }), store);
    const stages = store.calls.map((c) => c.stage);
    expect([...new Set(stages)]).toEqual(ALL_STAGES);
    expect(stages).toEqual([...stages].sort((a, b) => ALL_STAGES.indexOf(a) - ALL_STAGES.indexOf(b)));
  });

  it("a 450-row plan produces 3 chunks each of books, copies and ledger", async () => {
    const rows = Array.from({ length: 450 }, (_, i) => ({
      id: `ROW${i}`,
      title: `Book ${i}`,
      ean_isbn13: isbn(1000 + i),
    }));
    const store = createFakeStore();
    await apply(planFor(store, { rows }), store);
    const sizes = (stage: "books" | "copies" | "ledger") =>
      store.calls.flatMap((c) => (c.stage === stage ? [c.rows.length] : []));
    expect(sizes("books")).toEqual([200, 200, 50]);
    expect(sizes("copies")).toEqual([200, 200, 50]);
    expect(sizes("ledger")).toEqual([200, 200, 50]);
  });

  it("onProgress climbs to total", async () => {
    const store = createFakeStore(mixedSeed());
    const plan = planFor(store, { rows: MIXED_ROWS });
    const seen: [number, number][] = [];
    await applyImportPlan(plan, HOUSEHOLD, store, {
      newId: idSource(),
      onProgress: (done, total) => seen.push([done, total]),
    });
    const total =
      plan.newBooks.length +
      plan.links.length +
      plan.newCopies.length +
      plan.bookPatches.length +
      plan.ledger.length;
    expect(seen.at(-1)).toEqual([total, total]);
    expect(seen.every(([, t]) => t === total)).toBe(true);
    const dones = seen.map(([d]) => d);
    expect(dones).toEqual([...dones].sort((a, b) => a - b));
  });

  it("pending refs resolve to the generated book id", async () => {
    const store = createFakeStore();
    const rows = [
      { id: "A", title: "First", ean_isbn13: isbn(1) },
      { id: "B", title: "Second", ean_isbn13: isbn(2) },
    ];
    await apply(planFor(store, { rows }), store, ["gen-a", "gen-b"]);
    const catalog = store.listBooks();
    expect(catalog.find((b) => b.title === "First")?.id).toBe("gen-a");
    expect(catalog.find((b) => b.title === "First")?.copies.map((c) => c.libibId)).toEqual(["A"]);
    expect(catalog.find((b) => b.title === "Second")?.id).toBe("gen-b");
    expect(catalog.find((b) => b.title === "Second")?.copies.map((c) => c.libibId)).toEqual(["B"]);
  });

  it("wraps a failure with its stage and cause, and stops", async () => {
    const store = createFakeStore();
    store.failAt("copies", 0);
    const error = await apply(planFor(store, { rows: FRESH_ROWS }), store).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ImportWriteError);
    expect((error as ImportWriteError).stage).toBe("copies");
    expect(((error as ImportWriteError).cause as Error).message).toContain("copies failed");
    expect(store.calls.map((c) => c.stage)).toEqual(["books"]);
  });

  it("a pending ref with no planned book fails at copies rather than sending no id", async () => {
    const store = createFakeStore();
    const plan = planFor(store, { rows: FRESH_ROWS });
    plan.newBooks = [];
    await expect(apply(plan, store)).rejects.toMatchObject({ stage: "copies" });
    expect(store.calls).toEqual([]);
  });
});

describe("applyImportPlan: idempotent", () => {
  it("a rebuild from the store has nothing to write, twice", async () => {
    const s = { rows: FRESH_ROWS };
    const store = createFakeStore();
    await apply(planFor(store, s), store);
    const after = store.snapshot();

    for (let run = 0; run < 2; run++) {
      const plan = planFor(store, s);
      expect(plan.newBooks).toEqual([]);
      expect(plan.newCopies).toEqual([]);
      expect(plan.links).toEqual([]);
      expect(plan.bookPatches).toEqual([]);
      expect(plan.ledger).toEqual([]);
      expect(plan.summary).toMatchObject({
        newBooks: 0,
        newCopies: 0,
        review: 0,
        unchanged: FRESH_ROWS.length,
      });
      expect(planState(plan)).toBe("nothing");
      await apply(plan, store);
      expect(store.snapshot()).toEqual(after);
    }
  });

  it("the fresh file landed as intended", async () => {
    const store = createFakeStore();
    await apply(planFor(store, { rows: FRESH_ROWS }), store);
    const byTitle = new Map(store.listBooks().map((b) => [b.title, b]));
    expect(byTitle.size).toBe(5);
    expect(byTitle.get("Many Copies")?.copies).toHaveLength(3);
    expect(byTitle.get("Both Shelves")?.copies.map((c) => c.ownerUserId).sort()).toEqual([null, "u1"].sort());
    expect(byTitle.get("Both Shelves")?.synopsis).toBe("Theirs");
    expect(byTitle.get("Plain New")?.copies[0].editionNote).toBe("Deluxe Edition");
    expect(byTitle.get("Anonymous Almanac")?.authors).toEqual([]);
    expect(store.ledger().get("MULTI")).toBe(3);
  });
});

describe("applyImportPlan: convergence (RF5)", () => {
  it("default decisions, every stage and call", async () => {
    await expectConverges({ rows: MIXED_ROWS, seed: mixedSeed }, ALL_STAGES);
  });

  it("retained non-default decisions, every stage and call", async () => {
    const s: Scenario = { rows: MIXED_ROWS, seed: mixedSeed, decisions: NON_DEFAULT };

    // Each decision is on offer and honoured, not silently dropped as stale.
    const review = planFor(createFakeStore(mixedSeed()), s).review;
    for (const [libibId, decision] of NON_DEFAULT) {
      expect(review.find((r) => r.libibId === libibId)?.chosen, libibId).toEqual(decision);
    }

    const byDefault = createFakeStore(mixedSeed());
    await apply(planFor(byDefault, { rows: MIXED_ROWS }), byDefault);
    const chosen = createFakeStore(mixedSeed());
    await apply(planFor(chosen, s), chosen);
    expect(chosen.snapshot()).not.toEqual(byDefault.snapshot());

    await expectConverges(s, ALL_STAGES);
  });

  it("a file bigger than one chunk, failing on a later chunk", async () => {
    const rows = Array.from({ length: 450 }, (_, i) => ({
      id: `ROW${i}`,
      title: `Book ${i}`,
      ean_isbn13: i % 2 === 0 ? isbn(1000 + i) : "",
    }));
    await expectConverges({ rows });
  });
});

describe("applyImportPlan: convergence, named shapes", () => {
  it("a link row with copies: 2", async () => {
    const s: Scenario = {
      rows: [{ id: "N", ean_isbn13: isbn(1), copies: "2" }],
      seed: () => ({
        books: [
          seededBook({
            id: "b1",
            isbn13: [isbn(1)],
            copies: [seededCopy({ id: "c-old", bookId: "b1", libibId: "OLD" })],
          }),
        ],
      }),
    };
    await expectConverges(s, ["links", "copies", "ledger"]);

    const store = createFakeStore(s.seed!());
    await apply(planFor(store, s), store);
    expect(store.listBooks()[0].copies.map((c) => c.libibId)).toEqual(["N", "N"]);
  });

  const sameTitleCatalog = (): FakeStoreSeed => ({
    books: [
      seededBook({
        id: "b1",
        isbn13: [isbn(1)],
        copies: [seededCopy({ id: "c0", bookId: "b1", libibId: "Y0" })],
      }),
    ],
    ledger: [["Y0", 1]],
  });

  it("same-title no-ISBN Y and X against a catalog book, Y adds and X retains new_book", async () => {
    const s: Scenario = {
      rows: [
        { id: "Y", ean_isbn13: "" },
        { id: "X", ean_isbn13: "" },
      ],
      seed: sameTitleCatalog,
      decisions: new Map([["X", { action: "new_book" }]]),
    };
    await expectConverges(s, ["books", "copies", "ledger"]);

    const store = createFakeStore(s.seed!());
    await apply(planFor(store, s), store);
    const copiesOf = (publisher: string | null) =>
      store.listBooks().find((b) => b.publisher === publisher)?.copies.map((c) => c.libibId).sort();
    expect(copiesOf("Seeded b1")).toEqual(["Y", "Y0"]);
    expect(copiesOf(null)).toEqual(["X"]);
  });

  it("the same with X on a differing ISBN", async () => {
    const s: Scenario = {
      rows: [
        { id: "Y", ean_isbn13: "" },
        { id: "X", ean_isbn13: isbn(2) },
      ],
      seed: sameTitleCatalog,
      decisions: new Map([["X", { action: "new_book" }]]),
    };
    await expectConverges(s, ["books", "copies", "ledger"]);
  });

  for (const ids of [
    ["m-low", "z-high"],
    ["z-high", "m-low"],
  ]) {
    it(`fresh catalog, plain no-ISBN A and ISBN B retaining new_book, ids ${ids.join(", ")}`, async () => {
      const s: Scenario = {
        rows: [
          { id: "A", ean_isbn13: "" },
          { id: "B", ean_isbn13: isbn(2) },
        ],
        decisions: new Map([["B", { action: "new_book" }]]),
        ids,
      };
      await expectConverges(s, ["books", "copies", "ledger"]);

      const store = createFakeStore();
      await apply(planFor(store, s), store, ids);
      const catalog = store.listBooks();
      expect(catalog).toHaveLength(2);
      expect(catalog.find((b) => b.isbn13.length === 0)?.copies.map((c) => c.libibId)).toEqual(["A"]);
      expect(catalog.find((b) => b.isbn13.length === 1)?.copies.map((c) => c.libibId)).toEqual(["B"]);
    });
  }

  const restoreSeed = (): FakeStoreSeed => ({
    books: [seededBook({ id: "b1", isbn13: [isbn(1)] })],
    ledger: [["X", 2]],
  });
  const RESTORE_ROW = { id: "X", ean_isbn13: isbn(1), copies: "2" };

  it("a restore row with ledger 2, no live copy and copies: 2", async () => {
    const s: Scenario = { rows: [RESTORE_ROW], seed: restoreSeed, restore: new Set(["X"]) };
    await expectConverges(s, ["copies", "ledger"]);

    const store = createFakeStore(s.seed!());
    await apply(planFor(store, s), store);
    expect(store.listBooks()[0].copies.map((c) => c.libibId)).toEqual(["X", "X"]);
  });

  it("a row's copies land in one insertCopies call, even at a chunk boundary", async () => {
    const before = Array.from({ length: 199 }, (_, i) => ({
      id: `ROW${i}`,
      title: `Book ${i}`,
      ean_isbn13: isbn(1000 + i),
    }));
    const after = { id: "LAST", title: "Last Book", ean_isbn13: isbn(2000) };
    const s: Scenario = {
      rows: [...before, RESTORE_ROW, after],
      seed: restoreSeed,
      restore: new Set(["X"]),
    };
    const store = createFakeStore(s.seed!());
    await apply(planFor(store, s), store);

    const copyCalls = store.calls.flatMap((c) => (c.stage === "copies" ? [c.rows] : []));
    expect(copyCalls.map((rows) => rows.length)).toEqual([201, 1]);
    expect(copyCalls[0].filter((r) => r.libibId === "X")).toHaveLength(2);

    await expectConverges(s, ["copies"]);
  });
});

describe("applyImportPlan: accepted gap", () => {
  it("D10 gap: copies rise over hand-deleted copies adds one extra if the ledger write fails", async () => {
    // Ledger 2, live 1, copies 3. Nothing records the intent before the ledger, so the retry
    // can't see the copy the failed run added. A future fix should change this expectation.
    const s: Scenario = {
      rows: [{ id: "X", ean_isbn13: isbn(1), copies: "3" }],
      seed: () => ({
        books: [
          seededBook({
            id: "b1",
            isbn13: [isbn(1)],
            copies: [seededCopy({ id: "c1", bookId: "b1", libibId: "X" })],
          }),
        ],
        ledger: [["X", 2]],
      }),
    };
    const liveCopies = (store: FakeStore) => store.listBooks()[0].copies.length;

    const clean = createFakeStore(s.seed!());
    await apply(planFor(clean, s), clean);
    expect(liveCopies(clean)).toBe(2);

    const store = createFakeStore(s.seed!());
    store.failAt("ledger", 0);
    await expect(apply(planFor(store, s), store)).rejects.toBeInstanceOf(ImportWriteError);
    await apply(planFor(store, s), store);
    expect(liveCopies(store)).toBe(3);
    expect(store.ledger().get("X")).toBe(3);
    expect(planState(planFor(store, s))).toBe("nothing");
  });
});

describe("applyImportPlan: after an import", () => {
  it("failing at copies leaves no ledger entries", async () => {
    const store = createFakeStore();
    store.failAt("copies", 0);
    await expect(apply(planFor(store, { rows: FRESH_ROWS }), store)).rejects.toBeInstanceOf(ImportWriteError);
    expect(store.ledger().size).toBe(0);
  });

  it("delete then re-import: stays removed, no writes", async () => {
    const s = {
      rows: [
        { id: "A", title: "Book A", ean_isbn13: isbn(1) },
        { id: "B", title: "Book B", ean_isbn13: isbn(2) },
      ],
    };
    const store = createFakeStore();
    await apply(planFor(store, s), store);
    const [a, b] = store.listBooks();
    store.deleteBook(a.id);
    store.deleteCopy(b.copies[0].id);

    const plan = planFor(store, s);
    expect(plan.summary.removed).toBe(2);
    expect(plan.removed.map((r) => r.libibId).sort()).toEqual(["A", "B"]);
    expect(plan.newBooks).toEqual([]);
    expect(plan.newCopies).toEqual([]);
    expect(plan.links).toEqual([]);
    expect(plan.bookPatches).toEqual([]);
    expect(plan.ledger).toEqual([]);
  });

  it("a patch race adds the title to patchesSkipped and the import continues", async () => {
    const s: Scenario = {
      rows: [
        { id: "R", title: "Raced Book", ean_isbn13: isbn(1), description: "Filled" },
        { id: "W", title: "Won Book", ean_isbn13: isbn(2), description: "Filled" },
      ],
      seed: () => ({
        books: [
          seededBook({
            id: "raced",
            title: "Raced Book",
            isbn13: [isbn(1)],
            copies: [seededCopy({ id: "c1", bookId: "raced", libibId: "R" })],
          }),
          seededBook({
            id: "won",
            title: "Won Book",
            isbn13: [isbn(2)],
            copies: [seededCopy({ id: "c2", bookId: "won", libibId: "W" })],
          }),
        ],
      }),
    };
    const store = createFakeStore(s.seed!());
    const plan = planFor(store, s);
    store.editBook("raced", { synopsis: "Mine" });

    const result = await apply(plan, store);

    expect(result.patchesSkipped).toEqual(["Raced Book"]);
    const byId = new Map(store.listBooks().map((b) => [b.id, b]));
    expect(byId.get("raced")?.synopsis).toBe("Mine");
    expect(byId.get("won")?.synopsis).toBe("Filled");
    expect(store.ledger().get("R")).toBe(1);
  });

  it("no race, nothing skipped", async () => {
    const store = createFakeStore(mixedSeed());
    const result = await apply(planFor(store, { rows: MIXED_ROWS }), store);
    expect(result.patchesSkipped).toEqual([]);
  });

  it("edits survive a re-import, and importing never marks a field edited", async () => {
    const first = { id: "A", ean_isbn13: isbn(1), length: "100" };
    const store = createFakeStore();
    await apply(planFor(store, { rows: [first] }), store);
    const { id } = store.listBooks()[0];
    store.editBook(id, { pageCount: 321, userEditedFields: ["pageCount"] });

    const rerun = { rows: [{ ...first, length: "200", publisher: "Late Press" }] };
    const plan = planFor(store, rerun);
    expect(plan.bookPatches.map((p) => p.patch)).toEqual([{ publisher: "Late Press" }]);
    await apply(plan, store);

    const [book] = store.listBooks();
    expect(book.pageCount).toBe(321);
    expect(book.publisher).toBe("Late Press");
    expect(book.userEditedFields).toEqual(["pageCount"]);
  });
});

describe("fake store", () => {
  it("failAt fires once, on the given call", async () => {
    const store = createFakeStore();
    store.failAt("ledger", 1);
    const rows = [{ libibId: "A", copiesSeen: 1 }];
    await store.upsertLedger(HOUSEHOLD, rows);
    await expect(store.upsertLedger(HOUSEHOLD, rows)).rejects.toThrow();
    await store.upsertLedger(HOUSEHOLD, rows);
    expect(store.calls).toHaveLength(2);
  });

  it("gives each inserted book a later createdAt", async () => {
    const store = createFakeStore();
    await apply(planFor(store, { rows: FRESH_ROWS }), store);
    const stamps = store
      .listBooks()
      .map((b) => b.createdAt)
      .sort();
    expect(new Set(stamps).size).toBe(stamps.length);
  });

  it("snapshot ignores insert order and generated ids", async () => {
    const rows = [
      { id: "A", title: "Book A", ean_isbn13: isbn(1) },
      { id: "B", title: "Book B", ean_isbn13: isbn(2) },
    ];
    const one = createFakeStore();
    await apply(planFor(one, { rows }), one, ["x1", "x2"]);
    const two = createFakeStore();
    await apply(planFor(two, { rows: [...rows].reverse() }), two, ["y1", "y2"]);
    expect(one.snapshot()).toEqual(two.snapshot());
    expect(JSON.stringify(one.snapshot())).not.toContain("x1");
  });
});

describe("applyImportPlan: copy flags survive a re-import (D2)", () => {
  const UNHAULED_AT = "2026-05-01T00:00:00Z";
  const flagged = (over: Partial<Copy> = {}) =>
    seededCopy({ id: "c1", bookId: "b1", unhauledAt: UNHAULED_AT, deluxe: true, signed: true, ...over });
  const flagsOf = (store: FakeStore) =>
    store.listBooks().flatMap((b) => b.copies.map((c) => [c.unhauledAt, c.deluxe, c.signed]));

  it("an unhauled copy with its id: nothing is planned and the flags stay", async () => {
    const store = createFakeStore({
      books: [seededBook({ id: "b1", isbn13: [isbn(7)], onShelf: false, copies: [flagged({ libibId: "L" })] })],
      ledger: [["L", 1]],
    });
    const plan = planFor(store, { rows: [{ id: "L", ean_isbn13: isbn(7), title: "Sample Title" }] });
    expect(plan.newCopies).toEqual([]);
    expect(plan.links).toEqual([]);
    await apply(plan, store);
    expect(flagsOf(store)).toEqual([[UNHAULED_AT, true, true]]);
  });

  it("an unhauled copy without an id is linked: only libib_id changes", async () => {
    const store = createFakeStore({
      books: [seededBook({ id: "b1", isbn13: [isbn(7)], onShelf: false, copies: [flagged()] })],
    });
    const plan = planFor(store, { rows: [{ id: "L", ean_isbn13: isbn(7), title: "Sample Title" }] });
    expect(plan.review[0].chosen).toEqual({ action: "link", copyId: "c1" });
    expect(plan.newCopies).toEqual([]);
    expect(plan.links).toEqual([{ copyId: "c1", libibId: "L" }]);
    await apply(plan, store);
    const [c] = store.listBooks()[0].copies;
    expect(c).toMatchObject({ libibId: "L", unhauledAt: UNHAULED_AT, deluxe: true, signed: true });
    expect(store.listBooks()[0].copies).toHaveLength(1);
  });

  it("a deluxe, signed copy keeps both flags while the import fills the book", async () => {
    const store = createFakeStore({
      books: [seededBook({ id: "b1", isbn13: [isbn(7)], copies: [flagged({ libibId: "L", unhauledAt: null })] })],
      ledger: [["L", 1]],
    });
    const plan = planFor(store, { rows: [{ id: "L", ean_isbn13: isbn(7), title: "Sample Title", description: "Filled synopsis" }] });
    expect(plan.bookPatches).toHaveLength(1);
    await apply(plan, store);
    expect(store.listBooks()[0].synopsis).toBe("Filled synopsis");
    expect(flagsOf(store)).toEqual([[null, true, true]]);
  });

  it("a rise to 2 copies adds one on-shelf copy with default flags", async () => {
    const store = createFakeStore({
      books: [seededBook({ id: "b1", isbn13: [isbn(7)], onShelf: false, copies: [flagged({ libibId: "L" })] })],
      ledger: [["L", 1]],
    });
    await apply(planFor(store, { rows: [{ id: "L", ean_isbn13: isbn(7), title: "Sample Title", copies: "2" }] }), store);
    expect(store.listBooks()[0].copies).toHaveLength(2);
    expect(flagsOf(store)).toEqual([
      [UNHAULED_AT, true, true],
      [null, false, false],
    ]);
  });
});
