import { describe, expect, it } from "vitest";
import type { BookWithCopies, Copy } from "../types";
import { libibCsv } from "./fixtures";
import { parseLibibCsv } from "./parse";
import {
  buildImportPlan,
  planState,
  sameSummary,
  type ImportPlan,
  type PlanInput,
  type ReviewDecision,
} from "./plan";

const ISBN_A = "9780000000002";
const ISBN_B = "9780000000019";
const ISBN_C = "9780000000026";
const ISBN10_OF_B = "0000000019";

const COLLECTION = "Test Books";
const OTHER = "Other Books";

function copy(over: Partial<Copy> = {}): Copy {
  return {
    id: "c1",
    bookId: "b1",
    ownerUserId: "u1",
    editionNote: null,
    location: null,
    origin: "libib",
    libibId: null,
    photoPath: null,
    userEditedFields: [],
    createdAt: "2026-01-01T00:00:00+00:00",
    updatedAt: "2026-01-01T00:00:00+00:00",
    ...over,
  };
}

function book(over: Partial<BookWithCopies> = {}): BookWithCopies {
  return {
    id: "b1",
    householdId: "h1",
    title: "Sample Title",
    authors: ["Wren Halloway"],
    synopsis: null,
    coverUrl: null,
    isbn13: [ISBN_A],
    isbn10: [],
    openlibraryId: null,
    googleBooksId: null,
    pageCount: null,
    publisher: null,
    publishDate: null,
    userEditedFields: [],
    createdAt: "2026-01-01T00:00:00+00:00",
    updatedAt: "2026-01-02T00:00:00+00:00",
    copies: [],
    ...over,
  };
}

type CsvRow = Partial<Record<string, string>>;

function plan(rows: CsvRow[], over: Partial<Omit<PlanInput, "file">> = {}): ImportPlan {
  return buildImportPlan({
    file: parseLibibCsv(libibCsv(rows)),
    catalog: [],
    ledger: new Map(),
    mapping: { [COLLECTION]: "u1", [OTHER]: "u2" },
    decisions: new Map(),
    restore: new Set(),
    ...over,
  });
}

function expectNoWrites(p: ImportPlan) {
  expect(p.newBooks).toEqual([]);
  expect(p.newCopies).toEqual([]);
  expect(p.links).toEqual([]);
  expect(p.bookPatches).toEqual([]);
}

const addTo = (bookId: string): ReviewDecision => ({
  action: "add_copy",
  book: { kind: "existing", bookId },
});
const existing = (bookId: string) => ({ kind: "existing", bookId }) as const;
const pending = (libibId: string) => ({ kind: "pending", libibId }) as const;

describe("buildImportPlan: fresh rows", () => {
  it("one row gives a new book, one planned copy and a ledger entry", () => {
    const p = plan([{ id: "X" }]);
    expect(p.summary).toMatchObject({ newBooks: 1, newCopies: 0 });
    expect(p.newBooks.map((b) => b.libibId)).toEqual(["X"]);
    expect(p.newCopies).toEqual([
      { book: pending("X"), ownerUserId: "u1", editionNote: null, libibId: "X" },
    ]);
    expect(p.ledger).toEqual([{ libibId: "X", copiesSeen: 1 }]);
  });

  it("copies 2 gives one new book and two planned copies with the same id", () => {
    const p = plan([{ id: "X", copies: "2" }]);
    expect(p.summary).toMatchObject({ newBooks: 1, newCopies: 1 });
    expect(p.newCopies.map((c) => c.libibId)).toEqual(["X", "X"]);
    expect(p.ledger).toEqual([{ libibId: "X", copiesSeen: 2 }]);
  });
});

describe("buildImportPlan: known rows", () => {
  it("unchanged: id on a live copy and in the ledger, all fields present", () => {
    const fullRow = {
      id: "X",
      description: "Synopsis",
      publisher: "Pub",
      publish_date: "2020-01-01",
      length: "100",
    };
    const catalog = [
      book({
        synopsis: "Synopsis",
        publisher: "Pub",
        publishDate: "2020-01-01",
        pageCount: 100,
        copies: [copy({ libibId: "X" })],
      }),
    ];
    const p = plan([fullRow], { catalog, ledger: new Map([["X", 1]]) });
    expectNoWrites(p);
    expect(p.ledger).toEqual([]);
    expect(p.summary.unchanged).toBe(1);
  });

  it("dedup, ledger healing: live copy with no ledger entry", () => {
    const catalog = [book({ copies: [copy({ libibId: "X" })] })];
    const p = plan([{ id: "X" }], { catalog });
    expectNoWrites(p);
    expect(p.ledger).toEqual([{ libibId: "X", copiesSeen: 1 }]);
    expect(p.summary.unchanged).toBe(1);
  });
});

describe("buildImportPlan: one book, many copies", () => {
  it("same ISBN in both collections, fresh: one book, two owners, two ids", () => {
    const p = plan([
      { id: "X", collection: COLLECTION },
      { id: "Y", collection: OTHER },
    ]);
    expect(p.summary).toMatchObject({ newBooks: 1, newCopies: 1, review: 0 });
    expect(p.newCopies).toEqual([
      { book: pending("X"), ownerUserId: "u1", editionNote: null, libibId: "X" },
      { book: pending("X"), ownerUserId: "u2", editionNote: null, libibId: "Y" },
    ]);
  });

  it("same ISBN, same collection, different ids in file: one book, two copies, no review", () => {
    const p = plan([{ id: "X" }, { id: "Y" }]);
    expect(p.summary).toMatchObject({ newBooks: 1, newCopies: 1, review: 0 });
    expect(p.review).toEqual([]);
  });

  it("across uploads: a file with only id Y for owner B adds a copy with no review", () => {
    const catalog = [book({ copies: [copy({ libibId: "X", ownerUserId: "u1" })] })];
    const p = plan([{ id: "Y", collection: OTHER }], { catalog });
    expect(p.review).toEqual([]);
    expect(p.newCopies).toEqual([
      { book: existing("b1"), ownerUserId: "u2", editionNote: null, libibId: "Y" },
    ]);
  });

  it("across uploads: row X in the file, new id Y same owner, adds a copy with no review", () => {
    const catalog = [book({ copies: [copy({ libibId: "X" })] })];
    const p = plan([{ id: "X" }, { id: "Y" }], { catalog });
    expect(p.review).toEqual([]);
    expect(p.newCopies.map((c) => c.libibId)).toEqual(["Y"]);
    expect(p.summary).toMatchObject({ newBooks: 0, newCopies: 1, unchanged: 1 });
  });
});

describe("buildImportPlan: copies count", () => {
  it("known row 1 to 2 adds exactly 1", () => {
    const catalog = [book({ copies: [copy({ libibId: "X" })] })];
    const p = plan([{ id: "X", copies: "2" }], { catalog, ledger: new Map([["X", 1]]) });
    expect(p.newCopies).toEqual([
      { book: existing("b1"), ownerUserId: "u1", editionNote: null, libibId: "X" },
    ]);
    expect(p.ledger).toEqual([{ libibId: "X", copiesSeen: 2 }]);
    expect(p.summary).toMatchObject({ newCopies: 1, unchanged: 0 });
  });

  it("known row 2 to 1 adds and removes nothing, ledger stays 2", () => {
    const catalog = [
      book({ copies: [copy({ id: "c1", libibId: "X" }), copy({ id: "c2", libibId: "X" })] }),
    ];
    const p = plan([{ id: "X", copies: "1" }], { catalog, ledger: new Map([["X", 2]]) });
    expectNoWrites(p);
    expect(p.ledger).toEqual([]);
    expect(p.removed).toEqual([]);
    expect(p.summary.unchanged).toBe(1);
  });

  it("a rise in copies also fills the book", () => {
    const catalog = [book({ copies: [copy({ libibId: "X" })] })];
    const p = plan([{ id: "X", copies: "2", publisher: "Pub" }], {
      catalog,
      ledger: new Map([["X", 1]]),
    });
    expect(p.bookPatches.map((x) => x.patch)).toEqual([{ publisher: "Pub" }]);
    expect(p.summary).toMatchObject({ newCopies: 1, filled: 1, unchanged: 0 });
  });
});

describe("buildImportPlan: ambiguity, rescan (RF2)", () => {
  const catalog = [
    book({ id: "b1", isbn13: [ISBN_A], copies: [copy({ id: "c1", bookId: "b1", libibId: "OLD1" })] }),
    book({ id: "b2", isbn13: [ISBN_B], copies: [copy({ id: "c2", bookId: "b2", libibId: "OLD2" })] }),
  ];
  const rows = [
    { id: "NEW1", ean_isbn13: ISBN_A },
    { id: "NEW2", ean_isbn13: ISBN_B },
  ];

  it("every id rotated: all rows reviewed, chosen link, nothing added", () => {
    const p = plan(rows, { catalog });
    expect(p.review.map((r) => r.reason)).toEqual(["rescan", "rescan"]);
    expect(p.review.map((r) => r.chosen)).toEqual([
      { action: "link", copyId: "c1" },
      { action: "link", copyId: "c2" },
    ]);
    expect(p.summary).toMatchObject({ newBooks: 0, newCopies: 0, review: 2 });
    expect(p.links).toEqual([
      { copyId: "c1", libibId: "NEW1" },
      { copyId: "c2", libibId: "NEW2" },
    ]);
    expect(p.review[0].options).toEqual([{ action: "link", copyId: "c1" }, addTo("b1")]);
  });

  it("choosing add_copy adds a copy instead", () => {
    const p = plan(rows, { catalog, decisions: new Map([["NEW1", addTo("b1")]]) });
    expect(p.review[0].chosen).toEqual(addTo("b1"));
    expect(p.newCopies.map((c) => c.libibId)).toEqual(["NEW1"]);
    expect(p.links).toEqual([{ copyId: "c2", libibId: "NEW2" }]);
  });

  it("link with copies 2 uses one copy and adds one more", () => {
    const p = plan([{ id: "NEW1", ean_isbn13: ISBN_A, copies: "2" }], { catalog });
    expect(p.links).toEqual([{ copyId: "c1", libibId: "NEW1" }]);
    expect(p.newCopies.map((c) => c.libibId)).toEqual(["NEW1"]);
    expect(p.ledger).toEqual([{ libibId: "NEW1", copiesSeen: 2 }]);
  });

  it("link also fills, so the next run has nothing left to write", () => {
    const p = plan([{ id: "NEW1", ean_isbn13: ISBN_A, publisher: "Pub" }], { catalog });
    expect(p.links).toHaveLength(1);
    expect(p.bookPatches.map((x) => x.patch)).toEqual([{ publisher: "Pub" }]);
  });

  it("link consumed: the second row has no target and adds a copy", () => {
    const one = [book({ copies: [copy({ id: "c1", libibId: "OLD" })] })];
    const p = plan([{ id: "N1" }, { id: "N2" }], { catalog: one });
    expect(p.links).toEqual([{ copyId: "c1", libibId: "N1" }]);
    expect(p.review.map((r) => r.libibId)).toEqual(["N1"]);
    expect(p.newCopies.map((c) => c.libibId)).toEqual(["N2"]);
  });
});

describe("buildImportPlan: ambiguity, photo or manual", () => {
  const photo = (ownerUserId: string) => [
    book({ copies: [copy({ id: "p1", origin: "photo", libibId: null, ownerUserId })] }),
  ];

  it("same-owner photo copy, ISBN match: review existing_copy, chosen add_copy", () => {
    const p = plan([{ id: "X" }], { catalog: photo("u1") });
    expect(p.review[0].reason).toBe("existing_copy");
    expect(p.review[0].chosen).toEqual(addTo("b1"));
    expect(p.review[0].options).toEqual(
      expect.arrayContaining([{ action: "link", copyId: "p1" }, addTo("b1")]),
    );
    expect(p.summary.newCopies).toBe(1);
  });

  it("choosing link sets the copy's libibId and adds nothing", () => {
    const p = plan([{ id: "X" }], {
      catalog: photo("u1"),
      decisions: new Map([["X", { action: "link", copyId: "p1" }]]),
    });
    expect(p.links).toEqual([{ copyId: "p1", libibId: "X" }]);
    expect(p.newCopies).toEqual([]);
    expect(p.ledger).toEqual([{ libibId: "X", copiesSeen: 1 }]);
  });

  it("different-owner photo copy: adds with no review", () => {
    const p = plan([{ id: "X" }], { catalog: photo("u2") });
    expect(p.review).toEqual([]);
    expect(p.newCopies).toHaveLength(1);
  });
});

describe("buildImportPlan: mixed book (D3 precedence)", () => {
  const inFile = copy({ id: "lib-in", libibId: "IN" });
  const photo = copy({ id: "pho", origin: "photo", libibId: null });
  const absent = copy({ id: "lib-out", libibId: "OUT" });

  it("absent-id copy wins: review rescan, chosen links it", () => {
    const catalog = [book({ copies: [photo, inFile, absent] })];
    const p = plan([{ id: "IN" }, { id: "NEW" }], { catalog });
    expect(p.review.map((r) => r.reason)).toEqual(["rescan"]);
    expect(p.review[0].chosen).toEqual({ action: "link", copyId: "lib-out" });
  });

  it("without the absent-id copy: review existing_copy, chosen add_copy", () => {
    const catalog = [book({ copies: [photo, inFile] })];
    const p = plan([{ id: "IN" }, { id: "NEW" }], { catalog });
    expect(p.review.map((r) => r.reason)).toEqual(["existing_copy"]);
    expect(p.review[0].chosen).toEqual(addTo("b1"));
  });

  it("several ISBN matches: review with one add_copy per book, default the oldest", () => {
    const catalog = [
      book({ id: "newer", isbn13: [ISBN_A], createdAt: "2026-03-01T00:00:00+00:00" }),
      book({ id: "older", isbn13: [ISBN_B], createdAt: "2026-02-01T00:00:00+00:00" }),
    ];
    const p = plan([{ id: "X", ean_isbn13: ISBN_A, upc_isbn10: ISBN10_OF_B }], { catalog });
    expect(p.review[0].reason).toBe("several_isbn_matches");
    expect(p.review[0].options).toEqual(expect.arrayContaining([addTo("older"), addTo("newer")]));
    expect(p.review[0].options).toHaveLength(2);
    expect(p.review[0].chosen).toEqual(addTo("older"));
    expect(p.newCopies[0].book).toEqual(existing("older"));
  });
});

describe("buildImportPlan: adoption (D5)", () => {
  const noIsbn = { id: "X", ean_isbn13: "" };
  const copyless = (over: Partial<BookWithCopies> = {}) => book({ isbn13: [], copies: [], ...over });

  it("unseen no-ISBN row, copyless book, same title and author: adopted with no review", () => {
    const p = plan([noIsbn], { catalog: [copyless()] });
    expect(p.review).toEqual([]);
    expect(p.summary.newBooks).toBe(0);
    expect(p.newCopies).toEqual([
      { book: existing("b1"), ownerUserId: "u1", editionNote: null, libibId: "X" },
    ]);
  });

  it("a retained new_book decision is ignored: still adopted, no second book", () => {
    const p = plan([noIsbn], {
      catalog: [copyless()],
      decisions: new Map([["X", { action: "new_book" }]]),
    });
    expect(p.newBooks).toEqual([]);
    expect(p.newCopies.map((c) => c.book)).toEqual([existing("b1")]);
  });

  it("copyless book with a different ISBN: adopted, ISBN unioned", () => {
    const p = plan([{ id: "X", ean_isbn13: ISBN_B }], { catalog: [copyless({ isbn13: [ISBN_A] })] });
    expect(p.review).toEqual([]);
    expect(p.newCopies.map((c) => c.book)).toEqual([existing("b1")]);
    expect(p.bookPatches[0].patch.isbn13).toEqual([ISBN_A, ISBN_B]);
  });

  it("a book whose copies were all deleted by hand: adopted, same path", () => {
    const p = plan([noIsbn], { catalog: [copyless()], ledger: new Map([["GONE", 1]]) });
    expect(p.review).toEqual([]);
    expect(p.newCopies.map((c) => c.book)).toEqual([existing("b1")]);
  });

  it("two such rows and two such books: one copy on each, oldest first, then lowest id", () => {
    const catalog = [
      copyless({ id: "b9", createdAt: "2026-01-01T00:00:00+00:00" }),
      copyless({ id: "b1", createdAt: "2026-01-01T00:00:00+00:00" }),
      copyless({ id: "b0", createdAt: "2026-05-01T00:00:00+00:00" }),
    ];
    const p = plan(
      [
        { id: "X", ean_isbn13: "" },
        { id: "Y", ean_isbn13: "" },
      ],
      { catalog },
    );
    expect(p.review).toEqual([]);
    expect(p.newBooks).toEqual([]);
    expect(p.newCopies.map((c) => c.book)).toEqual([existing("b1"), existing("b9")]);
  });

  it("not adopted: a book with a copy, and retained new_book is honored", () => {
    const catalog = [book({ isbn13: [], copies: [copy({ libibId: "OTHER" })] })];
    const p = plan([noIsbn], { catalog, decisions: new Map([["X", { action: "new_book" }]]) });
    expect(p.review[0].chosen).toEqual({ action: "new_book" });
    expect(p.summary.newBooks).toBe(1);
  });

  it("not adopted: a copyless book with a different author", () => {
    const p = plan([noIsbn], { catalog: [copyless({ authors: ["Someone Else"] })] });
    expect(p.review).toEqual([]);
    expect(p.summary.newBooks).toBe(1);
  });

  it("not adopted: a copyless book with only a baseTitleKey match", () => {
    const catalog = [copyless({ title: "Ember Road: Book 3" })];
    const p = plan([{ id: "X", ean_isbn13: "", title: "Ember Road: Book 2" }], { catalog });
    expect(p.review[0].reason).toBe("similar_title");
    expect(p.review[0].chosen).toEqual({ action: "new_book" });
  });

  it("retained pending decision: first row adopts, second adds to that same book", () => {
    const decisions = new Map<string, ReviewDecision>([
      ["Y", { action: "add_copy", book: pending("X") }],
    ]);
    const p = plan(
      [
        { id: "X", ean_isbn13: "" },
        { id: "Y", ean_isbn13: "" },
      ],
      { catalog: [copyless({ id: "made" })], decisions },
    );
    expect(p.newBooks).toEqual([]);
    expect(p.newCopies.map((c) => [c.libibId, c.book])).toEqual([
      ["X", existing("made")],
      ["Y", existing("made")],
    ]);
    expect(p.review[0].chosen).toEqual(addTo("made"));
  });

  it("retained pending decision resolves to whichever pending book holds that row's copy", () => {
    const decisions = new Map<string, ReviewDecision>([
      ["Y", { action: "add_copy", book: pending("W") }],
      ["Z", { action: "add_copy", book: pending("Y") }],
    ]);
    const p = plan(
      [
        { id: "W", ean_isbn13: "" },
        { id: "Y", ean_isbn13: "" },
        { id: "Z", ean_isbn13: "" },
      ],
      { decisions },
    );
    expect(p.newBooks.map((b) => b.libibId)).toEqual(["W"]);
    expect(p.review.map((r) => r.chosen)).toEqual([
      { action: "add_copy", book: pending("W") },
      { action: "add_copy", book: pending("W") },
    ]);
  });
});

describe("buildImportPlan: reservations on retry", () => {
  const INSERTED = "2026-06-01T00:00:00+00:00";
  // A book as the books stage left it: inserted, then the run failed before its copies.
  const inserted = (id: string, over: Partial<BookWithCopies> = {}) =>
    book({ id, isbn13: [], createdAt: INSERTED, copies: [], ...over });
  const placed = (p: ImportPlan) => p.newCopies.map((c) => [c.libibId, c.book]);
  const separate = (libibId: string) =>
    new Map<string, ReviewDecision>([[libibId, { action: "new_book" }]]);

  const withCopy = book({ id: "b1", isbn13: [], copies: [copy({ libibId: "Y0" })] });

  it("B: an earlier row doesn't take the book inserted for a later new_book row", () => {
    const p = plan(
      [
        { id: "Y", ean_isbn13: "" },
        { id: "X", ean_isbn13: "" },
      ],
      { catalog: [withCopy, inserted("m")], decisions: separate("X") },
    );
    expect(p.newBooks).toEqual([]);
    expect(placed(p)).toEqual([
      ["Y", existing("b1")],
      ["X", existing("m")],
    ]);
    expect(p.review.find((r) => r.libibId === "Y")?.options).toEqual([
      addTo("b1"),
      { action: "new_book" },
    ]);
  });

  it("C: the same with X on a differing ISBN", () => {
    const p = plan(
      [
        { id: "Y", ean_isbn13: "" },
        { id: "X", ean_isbn13: ISBN_B },
      ],
      { catalog: [withCopy, inserted("m", { isbn13: [ISBN_B] })], decisions: separate("X") },
    );
    expect(p.newBooks).toEqual([]);
    expect(placed(p)).toEqual([
      ["Y", existing("b1")],
      ["X", existing("m")],
    ]);
    expect(p.bookPatches).toEqual([]);
  });

  it.each([
    ["A's book has the lower id", "a-low", "b-high"],
    ["B's book has the lower id", "b-high", "a-low"],
  ])("J: a plain new book and an ISBN row keep their own books when %s", (_name, aId, bId) => {
    const p = plan(
      [
        { id: "A", ean_isbn13: "" },
        { id: "B", ean_isbn13: ISBN_B },
      ],
      {
        catalog: [inserted(aId), inserted(bId, { isbn13: [ISBN_B] })],
        decisions: separate("B"),
      },
    );
    expect(p.newBooks).toEqual([]);
    expect(placed(p)).toEqual([
      ["A", existing(aId)],
      ["B", existing(bId)],
    ]);
    expect(p.bookPatches).toEqual([]);
  });

  it("a row's default candidate is never a copyless book reserved for another row", () => {
    // Uninterrupted: Z is a new book, Y adds to it, X retains new_book.
    const p = plan(
      [
        { id: "Z", ean_isbn13: "" },
        { id: "Y", ean_isbn13: "" },
        { id: "X", ean_isbn13: "" },
      ],
      { catalog: [inserted("k-low"), inserted("w-high")], decisions: separate("X") },
    );
    expect(p.newBooks).toEqual([]);
    expect(placed(p)).toEqual([
      ["Z", existing("w-high")],
      ["Y", existing("w-high")],
      ["X", existing("k-low")],
    ]);
  });

  it("ISBN rows reserve before new_book rows, even when later in the file", () => {
    const p = plan(
      [
        { id: "X", ean_isbn13: "" },
        { id: "Q", ean_isbn13: ISBN_B },
      ],
      {
        catalog: [inserted("a-low", { isbn13: [ISBN_B] }), inserted("z-high")],
        decisions: separate("X"),
      },
    );
    expect(p.newBooks).toEqual([]);
    expect(placed(p)).toEqual([
      ["X", existing("z-high")],
      ["Q", existing("a-low")],
    ]);
  });

  it("a row that isn't on the ladder reserves nothing", () => {
    // R is known, skipped or removed in turn, and its retained new_book must not hold the book.
    const rows = [
      { id: "P", ean_isbn13: "" },
      { id: "R", ean_isbn13: "", collection: OTHER },
    ];
    const catalog = [inserted("m")];
    const decisions = separate("R");
    const skipped = plan(rows, { catalog, decisions, mapping: { [COLLECTION]: "u1", [OTHER]: "skip" } });
    expect(placed(skipped)).toEqual([["P", existing("m")]]);
    const gone = plan(rows, { catalog, decisions, ledger: new Map([["R", 1]]) });
    expect(placed(gone)).toEqual([["P", existing("m")]]);
    const known = plan(rows, {
      catalog: [...catalog, book({ id: "k", isbn13: [], copies: [copy({ libibId: "R" })] })],
      decisions,
    });
    expect(known.newCopies.map((c) => c.libibId)).toEqual(["P"]);
    expect(known.newCopies[0].book).toEqual(existing("m"));
  });
});

describe("buildImportPlan: empty keys", () => {
  const row = { id: "X", ean_isbn13: "", title: "!!!" };

  it("punctuation-only titles, with copies: new book, no review", () => {
    const catalog = [book({ title: "!!!", isbn13: [], copies: [copy({ libibId: "O" })] })];
    const p = plan([row], { catalog });
    expect(p.review).toEqual([]);
    expect(p.summary.newBooks).toBe(1);
  });

  it("punctuation-only titles, copyless: new book, no adoption", () => {
    const catalog = [book({ title: "!!!", isbn13: [], copies: [] })];
    const p = plan([row], { catalog });
    expect(p.review).toEqual([]);
    expect(p.summary.newBooks).toBe(1);
  });

  it("a non-Latin title with the same author is a strong match", () => {
    const catalog = [book({ title: "硝子の果樹園", isbn13: [], copies: [copy({ libibId: "O" })] })];
    const p = plan([{ id: "X", ean_isbn13: "", title: "硝子の果樹園" }], { catalog });
    expect(p.review[0].reason).toBe("same_title");
  });
});

describe("buildImportPlan: no ISBN", () => {
  const withCopy = (over: Partial<BookWithCopies> = {}) =>
    book({ isbn13: [], copies: [copy({ libibId: "O" })], ...over });
  const row = { id: "X", ean_isbn13: "" };

  it("same title and author: review same_title, chosen add copy", () => {
    const p = plan([row], { catalog: [withCopy()] });
    expect(p.review[0].reason).toBe("same_title");
    expect(p.review[0].options).toEqual([addTo("b1"), { action: "new_book" }]);
    expect(p.review[0].chosen).toEqual(addTo("b1"));
    expect(p.summary).toMatchObject({ newBooks: 0, newCopies: 1, review: 1 });
  });

  it("new_book is honored", () => {
    const p = plan([row], {
      catalog: [withCopy()],
      decisions: new Map([["X", { action: "new_book" }]]),
    });
    expect(p.summary).toMatchObject({ newBooks: 1, newCopies: 0, review: 1 });
  });

  it("different author, same title: new book, no review", () => {
    const p = plan([row], { catalog: [withCopy({ authors: ["Someone Else"] })] });
    expect(p.review).toEqual([]);
    expect(p.summary.newBooks).toBe(1);
  });

  it("no authors versus a book with authors: new book, no review", () => {
    const p = plan([{ ...row, creators: "" }], { catalog: [withCopy()] });
    expect(p.review).toEqual([]);
    expect(p.summary.newBooks).toBe(1);
  });

  it("no authors versus a book with no authors and the same title: review same_title", () => {
    const p = plan([{ ...row, creators: "" }], { catalog: [withCopy({ authors: [] })] });
    expect(p.review[0].reason).toBe("same_title");
  });

  it("differing ISBN, strong match: review same_title; add copy unions the ISBN", () => {
    const p = plan([{ id: "X", ean_isbn13: ISBN_B }], {
      catalog: [withCopy({ isbn13: [ISBN_A] })],
    });
    expect(p.review[0].reason).toBe("same_title");
    expect(p.bookPatches[0].patch.isbn13).toEqual([ISBN_A, ISBN_B]);
    expect(p.summary.filled).toBe(1);
  });

  it("edition qualifier: strong match, and the planned copy carries the edition note", () => {
    const p = plan([{ ...row, title: "The Glass Orchard (Deluxe Limited Edition)" }], {
      catalog: [withCopy({ title: "The Glass Orchard" })],
    });
    expect(p.review[0].reason).toBe("same_title");
    expect(p.newCopies[0].editionNote).toBe("Deluxe Limited Edition");
  });

  it("false-merge guard: series entries review similar_title, chosen new_book", () => {
    const p = plan([{ ...row, title: "Ember Road: Book 2" }], {
      catalog: [withCopy({ title: "Ember Road: Book 3" })],
    });
    expect(p.review[0].reason).toBe("similar_title");
    expect(p.review[0].chosen).toEqual({ action: "new_book" });
    expect(p.summary.newBooks).toBe(1);
  });

  it("in-file pair: first is a new book, second reviews against the pending book", () => {
    const p = plan([
      { id: "X", ean_isbn13: "" },
      { id: "Y", ean_isbn13: "" },
    ]);
    expect(p.summary).toMatchObject({ newBooks: 1, newCopies: 1, review: 1 });
    expect(p.review[0].libibId).toBe("Y");
    expect(p.review[0].reason).toBe("same_title");
    expect(p.review[0].chosen).toEqual({ action: "add_copy", book: pending("X") });
    expect(p.newCopies[1].book).toEqual(pending("X"));
  });

  it("add_copy to a pending book merges into its input instead of patching", () => {
    const p = plan([
      { id: "X", ean_isbn13: "" },
      { id: "Y", ean_isbn13: "", publisher: "Pub" },
    ]);
    expect(p.bookPatches).toEqual([]);
    expect(p.newBooks[0].input.publisher).toBe("Pub");
    expect(p.summary.filled).toBe(0);
  });
});

describe("buildImportPlan: hand edits", () => {
  const known = (over: Partial<BookWithCopies>) => [
    book({ copies: [copy({ libibId: "X" })], ...over }),
  ];
  const ledger = new Map([["X", 1]]);

  it("edited pageCount 300, CSV 416: no patch", () => {
    const p = plan([{ id: "X", length: "416" }], {
      catalog: known({ pageCount: 300, userEditedFields: ["pageCount"] }),
      ledger,
    });
    expect(p.bookPatches).toEqual([]);
  });

  it("edited pageCount null: no patch", () => {
    const p = plan([{ id: "X", length: "416" }], {
      catalog: known({ pageCount: null, userEditedFields: ["pageCount"] }),
      ledger,
    });
    expect(p.bookPatches).toEqual([]);
  });

  it("empty publisher, not edited: patch publisher only, filled 1, book's updatedAt", () => {
    const p = plan([{ id: "X", publisher: "Pub" }], { catalog: known({ updatedAt: "stamp" }), ledger });
    expect(p.bookPatches).toEqual([
      { bookId: "b1", expectedUpdatedAt: "stamp", title: "Sample Title", patch: { publisher: "Pub" } },
    ]);
    expect(p.summary).toMatchObject({ filled: 1, unchanged: 0 });
  });

  it("hand-edited title: still known by id, no new book, title not in patch", () => {
    const p = plan([{ id: "X", title: "CSV Title", publisher: "Pub" }], {
      catalog: known({ title: "My Title", userEditedFields: ["title"] }),
      ledger,
    });
    expect(p.newBooks).toEqual([]);
    expect(p.review).toEqual([]);
    expect(p.bookPatches[0].patch).not.toHaveProperty("title");
  });

  it("owner and location of a known copy appear in no output", () => {
    const catalog = known({});
    catalog[0].copies[0].ownerUserId = "someone-else";
    catalog[0].copies[0].location = "Hall shelf";
    const p = plan([{ id: "X", title: "Sample Title", publisher: "Pub" }], { catalog, ledger });
    const out = JSON.stringify(p);
    expect(out).not.toContain("someone-else");
    expect(out).not.toContain("Hall shelf");
    expect(out).not.toContain("u1");
  });
});

describe("buildImportPlan: deletes (D9)", () => {
  it("ledger 1, no live copy (copy deleted, book kept), copies 1: removed, no writes", () => {
    const catalog = [book({ copies: [] })];
    const p = plan([{ id: "X" }], { catalog, ledger: new Map([["X", 1]]) });
    expectNoWrites(p);
    expect(p.ledger).toEqual([]);
    expect(p.removed).toEqual([{ libibId: "X", title: "Sample Title" }]);
    expect(p.summary.removed).toBe(1);
  });

  it("ledger 1, whole book deleted, copies 1: removed, no writes", () => {
    const p = plan([{ id: "X" }], { ledger: new Map([["X", 1]]) });
    expectNoWrites(p);
    expect(p.summary.removed).toBe(1);
  });

  it("in restore: ISBN-matches a kept book; ledger stays valid", () => {
    const p = plan([{ id: "X" }], {
      catalog: [book({ copies: [] })],
      ledger: new Map([["X", 1]]),
      restore: new Set(["X"]),
    });
    expect(p.removed).toEqual([]);
    expect(p.newCopies.map((c) => c.book)).toEqual([existing("b1")]);
    expect(p.ledger).toEqual([{ libibId: "X", copiesSeen: 1 }]);
  });

  it("in restore, book gone: creates a new one", () => {
    const p = plan([{ id: "X" }], { ledger: new Map([["X", 1]]), restore: new Set(["X"]) });
    expect(p.summary).toMatchObject({ newBooks: 1, removed: 0 });
    expect(p.ledger).toEqual([{ libibId: "X", copiesSeen: 1 }]);
  });

  it("in restore with copies below the ledger: restores copies copies, ledger keeps its max", () => {
    const p = plan([{ id: "X", copies: "1" }], { ledger: new Map([["X", 2]]), restore: new Set(["X"]) });
    expect(p.newCopies).toHaveLength(1);
    expect(p.ledger).toEqual([{ libibId: "X", copiesSeen: 2 }]);
  });

  it("ledger 2, live 1, copies 2: unchanged, no resurrect", () => {
    const catalog = [book({ copies: [copy({ libibId: "X" })] })];
    const p = plan([{ id: "X", copies: "2" }], { catalog, ledger: new Map([["X", 2]]) });
    expectNoWrites(p);
    expect(p.summary.unchanged).toBe(1);
  });

  it("ledger 1, no live copy, copies 2: adds 1 to the kept book", () => {
    const p = plan([{ id: "X", copies: "2" }], {
      catalog: [book({ copies: [] })],
      ledger: new Map([["X", 1]]),
    });
    expect(p.newCopies.map((c) => c.book)).toEqual([existing("b1")]);
    expect(p.ledger).toEqual([{ libibId: "X", copiesSeen: 2 }]);
    expect(p.removed).toEqual([]);
  });

  it("ledger 1, no live copy, copies 2, book gone: creates it with 1 copy", () => {
    const p = plan([{ id: "X", copies: "2" }], { ledger: new Map([["X", 1]]) });
    expect(p.summary).toMatchObject({ newBooks: 1, newCopies: 0 });
    expect(p.newCopies).toHaveLength(1);
  });

  it("book deleted, row Y from the other collection never imported: new book", () => {
    const p = plan(
      [
        { id: "X", collection: COLLECTION },
        { id: "Y", collection: OTHER },
      ],
      { ledger: new Map([["X", 1]]) },
    );
    expect(p.summary).toMatchObject({ removed: 1, newBooks: 1, newCopies: 0 });
    expect(p.newBooks[0].libibId).toBe("Y");
  });
});

describe("buildImportPlan: missing rows", () => {
  it("catalog book with an id absent from the file, no related row: untouched", () => {
    const catalog = [book({ isbn13: [ISBN_A], copies: [copy({ libibId: "GONE" })] })];
    const p = plan([{ id: "X", ean_isbn13: ISBN_B, title: "Unrelated" }], { catalog });
    expect(p.review).toEqual([]);
    expect(p.bookPatches).toEqual([]);
    expect(p.links).toEqual([]);
    expect(p.newBooks.map((b) => b.libibId)).toEqual(["X"]);
  });
});

describe("buildImportPlan: mapping (RF4)", () => {
  it("skip: the row writes nothing and has no ledger entry", () => {
    const p = plan([{ id: "X" }], { mapping: { [COLLECTION]: "skip" } });
    expectNoWrites(p);
    expect(p.ledger).toEqual([]);
    expect(p.summary.skippedCollection).toBe(1);
  });

  it("a rerun mapped to a member imports the skipped row", () => {
    const p = plan([{ id: "X" }], { mapping: { [COLLECTION]: "u2" } });
    expect(p.newCopies[0].ownerUserId).toBe("u2");
    expect(p.summary.skippedCollection).toBe(0);
  });

  it("shared gives a null owner", () => {
    const p = plan([{ id: "X" }], { mapping: { [COLLECTION]: "shared" } });
    expect(p.newCopies[0].ownerUserId).toBeNull();
  });

  it("a blank collection is keyed by the empty string", () => {
    const p = plan([{ id: "X", collection: "" }], { mapping: { "": "u2" } });
    expect(p.newCopies[0].ownerUserId).toBe("u2");
  });

  it("known row with the mapping changed: no change to anything", () => {
    const catalog = [book({ copies: [copy({ libibId: "X", ownerUserId: "u1" })] })];
    const p = plan([{ id: "X" }], {
      catalog,
      ledger: new Map([["X", 1]]),
      mapping: { [COLLECTION]: "u2" },
    });
    expectNoWrites(p);
    expect(p.ledger).toEqual([]);
    expect(p.summary.unchanged).toBe(1);
  });
});

describe("buildImportPlan: fill convergence", () => {
  it("two rows for one book, differing synopsis: first in file order wins, one patch", () => {
    const catalog = [
      book({ copies: [copy({ id: "c1", libibId: "X" }), copy({ id: "c2", libibId: "Y" })] }),
    ];
    const p = plan(
      [
        { id: "X", description: "First" },
        { id: "Y", description: "Second" },
      ],
      { catalog, ledger: new Map([["X", 1], ["Y", 1]]) },
    );
    expect(p.bookPatches).toHaveLength(1);
    expect(p.bookPatches[0].patch).toEqual({ synopsis: "First" });
    expect(p.summary).toMatchObject({ filled: 1, unchanged: 1 });
  });

  it("two rows patching different fields collapse to one patch for the book", () => {
    const catalog = [
      book({ copies: [copy({ id: "c1", libibId: "X" }), copy({ id: "c2", libibId: "Y" })] }),
    ];
    const p = plan(
      [
        { id: "X", description: "First" },
        { id: "Y", publisher: "Pub" },
      ],
      { catalog, ledger: new Map([["X", 1], ["Y", 1]]) },
    );
    expect(p.bookPatches).toHaveLength(1);
    expect(p.bookPatches[0].patch).toEqual({ synopsis: "First", publisher: "Pub" });
  });

  it("a stale decision (option no longer valid) falls back to the default", () => {
    const catalog = [book({ copies: [copy({ id: "c1", libibId: "OLD" })] })];
    const p = plan([{ id: "N" }], {
      catalog,
      decisions: new Map([["N", { action: "link", copyId: "deleted" }]]),
    });
    expect(p.review[0].chosen).toEqual({ action: "link", copyId: "c1" });
  });

  it("is pure and deterministic: inputs are untouched and a second call matches", () => {
    const catalog = [book({ copies: [copy({ id: "c1", libibId: "OLD" })] })];
    const before = JSON.stringify(catalog);
    const input: PlanInput = {
      file: parseLibibCsv(libibCsv([{ id: "N", publisher: "Pub" }, { id: "M" }])),
      catalog,
      ledger: new Map(),
      mapping: { [COLLECTION]: "u1" },
      decisions: new Map(),
      restore: new Set(),
    };
    expect(buildImportPlan(input)).toEqual(buildImportPlan(input));
    expect(JSON.stringify(catalog)).toBe(before);
  });
});

describe("sameSummary", () => {
  const base = plan([{ id: "X" }]).summary;
  it("is true for equal summaries", () => {
    expect(sameSummary(base, { ...base })).toBe(true);
  });
  it.each(Object.keys(base) as (keyof typeof base)[])("is false when %s differs", (key) => {
    expect(sameSummary(base, { ...base, [key]: base[key] + 1 })).toBe(false);
  });
});

describe("planState", () => {
  const empty: ImportPlan = {
    newBooks: [],
    newCopies: [],
    links: [],
    bookPatches: [],
    ledger: [],
    review: [],
    removed: [],
    summary: {
      newBooks: 0,
      newCopies: 0,
      filled: 0,
      unchanged: 0,
      review: 0,
      removed: 0,
      skippedCollection: 0,
    },
  };
  const ledger = [{ libibId: "X", copiesSeen: 1 }];
  const removed = [{ libibId: "X", title: "T" }];
  const planned = { book: pending("X"), ownerUserId: null, editionNote: null, libibId: "X" };

  it("all lists empty gives nothing", () => {
    expect(planState(empty)).toBe("nothing");
  });
  it("only ledger gives ledger_only, also when removed is non-empty", () => {
    expect(planState({ ...empty, ledger })).toBe("ledger_only");
    expect(planState({ ...empty, ledger, removed })).toBe("ledger_only");
  });
  it("only removed gives removed_only", () => {
    expect(planState({ ...empty, removed })).toBe("removed_only");
  });
  it("any of the four other write lists gives writes", () => {
    const input = plan([{ id: "X" }]).newBooks[0].input;
    expect(planState({ ...empty, newBooks: [{ libibId: "X", input }] })).toBe("writes");
    expect(planState({ ...empty, newCopies: [planned] })).toBe("writes");
    expect(planState({ ...empty, links: [{ copyId: "c", libibId: "X" }] })).toBe("writes");
    expect(
      planState({
        ...empty,
        bookPatches: [{ bookId: "b", expectedUpdatedAt: "t", title: "T", patch: {} }],
      }),
    ).toBe("writes");
  });
  it("ticking restore on a removed_only row gives writes", () => {
    const rows = [{ id: "X" }];
    const ledgerMap = new Map([["X", 1]]);
    expect(planState(plan(rows, { ledger: ledgerMap }))).toBe("removed_only");
    expect(planState(plan(rows, { ledger: ledgerMap, restore: new Set(["X"]) }))).toBe("writes");
  });
  it("a known row with nothing to do gives nothing", () => {
    const catalog = [book({ isbn13: [ISBN_C], copies: [copy({ libibId: "X" })] })];
    const p = plan([{ id: "X", ean_isbn13: ISBN_C }], { catalog, ledger: new Map([["X", 1]]) });
    expect(planState(p)).toBe("nothing");
  });
});
