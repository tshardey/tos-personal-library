import { describe, expect, it, vi } from "vitest";
import { bookFixture, copyFixture } from "./flag-fixtures.test-util";
import {
  applyChangeSet,
  buildChangeSet,
  canonicalLocation,
  describeCounts,
  locationNames,
  retryTargets,
  WRITE_BATCH,
  type MassEditTargets,
} from "./mass-edit";
import type { ReadStatusMap } from "./reading/types";
import type { BookWithCopies } from "./types";

const NOW = "2026-11-13T10:00:00.000Z";
const LABELS = ["Lantern Box", "Harbor Press"];

/** Two books: "Atlas" with an original and a deluxe copy, "Codex" with one unhauled copy. */
function catalog(): BookWithCopies[] {
  return [
    bookFixture(
      "Atlas",
      [
        copyFixture({ id: "a1", bookId: "Atlas", editionNote: null, userEditedFields: ["copyNote"] }),
        copyFixture({ id: "a2", bookId: "Atlas", editionNote: "Lantern Box", deluxe: true, location: "Hall shelf" }),
      ],
      { seriesName: "Tide Saga", userEditedFields: ["title"] },
    ),
    bookFixture(
      "Codex",
      [copyFixture({ id: "c1", bookId: "Codex", ownerUserId: "u-a", unhauledAt: "2026-01-01T00:00:00Z" })],
    ),
  ];
}

const all = (books: BookWithCopies[]): MassEditTargets => ({
  copyIds: new Set(books.flatMap((b) => b.copies.map((c) => c.id))),
  bookIds: new Set(books.map((b) => b.id)),
});

describe("buildChangeSet", () => {
  it("writes nothing when every field is left as no change", () => {
    const books = catalog();
    expect(buildChangeSet(books, all(books), {}, LABELS, NOW)).toEqual({
      copies: [],
      books: [],
      libraryTags: [],
      reads: [],
      keepDates: false,
      readDate: null,
    });
  });

  it("patches only touched fields that change, and adds each changed key to user_edited_fields once", () => {
    const books = catalog();
    const set = buildChangeSet(books, all(books), { editionNote: "Lantern Box", deluxe: true }, LABELS, NOW);
    // a2 already has both values, so it isn't written or counted.
    expect(set.copies.map((c) => c.copy.id)).toEqual(["a1", "c1"]);
    expect(set.copies[0].patch).toEqual({ editionNote: "Lantern Box", deluxe: true });
    expect(set.copies[0].editedFields).toEqual(["copyNote", "deluxe", "editionNote"]);
    expect(set.books).toEqual([]);
  });

  it("doesn't duplicate a key already in user_edited_fields", () => {
    const books = [bookFixture("B", [copyFixture({ id: "x", userEditedFields: ["deluxe", "signed"] })])];
    const set = buildChangeSet(books, all(books), { deluxe: true }, LABELS, NOW);
    expect(set.copies[0].editedFields).toEqual(["deluxe", "signed"]);
  });

  it("uses the existing label spelling for a case or space variant, and null clears", () => {
    const books = catalog();
    const set = buildChangeSet(books, all(books), { editionNote: "  lantern BOX " }, LABELS, NOW);
    expect(set.copies.map((c) => [c.copy.id, c.patch.editionNote])).toEqual([
      ["a1", "Lantern Box"],
      ["c1", "Lantern Box"],
    ]);
    const cleared = buildChangeSet(books, all(books), { editionNote: null }, LABELS, NOW);
    expect(cleared.copies.map((c) => [c.copy.id, c.patch])).toEqual([["a2", { editionNote: null }]]);
  });

  it("uses the existing location spelling, and blank text clears it", () => {
    const books = catalog();
    const set = buildChangeSet(books, all(books), { location: "hall SHELF " }, LABELS, NOW);
    expect(set.copies.map((c) => [c.copy.id, c.patch])).toEqual([
      ["a1", { location: "Hall shelf" }],
      ["c1", { location: "Hall shelf" }],
    ]);
    const cleared = buildChangeSet(books, all(books), { location: "  " }, LABELS, NOW);
    expect(cleared.copies.map((c) => [c.copy.id, c.patch])).toEqual([["a2", { location: null }]]);
  });

  it("writes Shared as a null owner", () => {
    const books = catalog();
    const set = buildChangeSet(books, all(books), { ownerUserId: null }, LABELS, NOW);
    expect(set.copies.map((c) => [c.copy.id, c.patch, c.editedFields])).toEqual([["c1", { ownerUserId: null }, ["ownerUserId"]]]);
    const toA = buildChangeSet(books, all(books), { ownerUserId: "u-a" }, LABELS, NOW);
    expect(toA.copies.map((c) => c.copy.id)).toEqual(["a1", "a2"]);
  });

  it("sets unhauled_at to now on copies on the shelf, and keeps an existing date", () => {
    const books = catalog();
    const set = buildChangeSet(books, all(books), { unhauled: true }, LABELS, NOW);
    expect(set.copies.map((c) => [c.copy.id, c.patch, c.editedFields])).toEqual([
      ["a1", { unhauledAt: NOW }, ["copyNote", "unhauledAt"]],
      ["a2", { unhauledAt: NOW }, ["unhauledAt"]],
    ]);
  });

  it("clears unhauled_at on unhauled copies only", () => {
    const books = catalog();
    const set = buildChangeSet(books, all(books), { unhauled: false }, LABELS, NOW);
    expect(set.copies.map((c) => [c.copy.id, c.patch])).toEqual([["c1", { unhauledAt: null }]]);
  });

  it("applies copy changes to ticked copies only", () => {
    const books = catalog();
    const targets = { copyIds: new Set(["a2"]), bookIds: new Set(["Atlas", "Codex"]) };
    const set = buildChangeSet(books, targets, { signed: true, seriesName: "Glass Orchard" }, LABELS, NOW);
    expect(set.copies.map((c) => c.copy.id)).toEqual(["a2"]);
    // The series reaches every selected book, whatever its ticks.
    expect(set.books.map((b) => b.book.id)).toEqual(["Atlas", "Codex"]);
  });

  it("sets a series (existing spelling for a variant) without touching the volume", () => {
    const books = catalog();
    const set = buildChangeSet(books, all(books), { seriesName: " tide saga" }, LABELS, NOW);
    // Atlas already has it; Codex gets the existing spelling.
    expect(set.books.map((b) => [b.book.id, b.patch, b.editedFields])).toEqual([
      ["Codex", { seriesName: "Tide Saga" }, ["seriesName"]],
    ]);
    expect(set.copies).toEqual([]);
  });

  it("clears a series with null or blank text, marking seriesName edited", () => {
    const books = catalog();
    for (const seriesName of [null, "  "]) {
      const set = buildChangeSet(books, all(books), { seriesName }, LABELS, NOW);
      expect(set.books.map((b) => [b.book.id, b.patch, b.editedFields])).toEqual([
        ["Atlas", { seriesName: null }, ["seriesName", "title"]],
      ]);
    }
  });

  it("only reaches the target books' series", () => {
    const books = catalog();
    const set = buildChangeSet(books, { copyIds: new Set(), bookIds: new Set(["Codex"]) }, { seriesName: "Saga" }, LABELS, NOW);
    expect(set.books.map((b) => b.book.id)).toEqual(["Codex"]);
  });
});

describe("locations", () => {
  it("lists trimmed spellings case-insensitively, the most-used first", () => {
    const books = [
      bookFixture("B", [
        copyFixture({ location: "Hall shelf" }),
        copyFixture({ location: " hall shelf" }),
        copyFixture({ location: "hall shelf" }),
        copyFixture({ location: "Attic" }),
        copyFixture({ location: null }),
      ]),
    ];
    expect(locationNames(books)).toEqual(["Attic", "hall shelf"]);
    expect(canonicalLocation(" ATTIC ", ["Attic"])).toBe("Attic");
    expect(canonicalLocation("Study", ["Attic"])).toBe("Study");
    expect(canonicalLocation(" ", ["Attic"])).toBeNull();
  });
});

describe("describeCounts", () => {
  it("names copies and books' series, singular and plural", () => {
    expect(describeCounts(14, 3)).toBe("14 copies and 3 books' series");
    expect(describeCounts(1, 0)).toBe("1 copy");
    expect(describeCounts(0, 1)).toBe("1 book's series");
  });
});

describe("applyChangeSet", () => {
  it("keeps the successful writes and returns the failed ones for a retry", async () => {
    const books = catalog();
    const set = buildChangeSet(books, all(books), { signed: true, seriesName: "Saga" }, LABELS, NOW);
    const writeCopy = vi.fn(async (id: string) => {
      if (id === "a2") throw new Error("network");
    });
    const writeBook = vi.fn(async (id: string) => {
      if (id === "Codex") throw new Error("network");
    });
    const result = await applyChangeSet(set, { writeCopy, writeBook });
    expect(writeCopy).toHaveBeenCalledTimes(3);
    expect(writeBook).toHaveBeenCalledTimes(2);
    expect(result.changedCopies).toBe(2);
    expect(result.changedBooks).toBe(1);
    expect(result.failedCopies.map((c) => c.copy.id)).toEqual(["a2"]);
    expect(result.failedBooks.map((b) => b.book.id)).toEqual(["Codex"]);
    expect(writeCopy).toHaveBeenCalledWith("a1", { signed: true }, ["copyNote", "signed"]);
    expect(writeBook).toHaveBeenCalledWith("Atlas", { seriesName: "Saga" }, ["seriesName", "title"]);

    // A retry rebuilds only the failures against the reloaded catalogue.
    const targets = retryTargets(result);
    const again = buildChangeSet(books, targets, { signed: true, seriesName: "Saga" }, LABELS, NOW);
    expect(again.copies.map((c) => c.copy.id)).toEqual(["a2"]);
    expect(again.books.map((b) => b.book.id)).toEqual(["Codex"]);
  });

  it("keeps at most WRITE_BATCH writes in flight", async () => {
    const copies = Array.from({ length: 20 }, (_, i) => copyFixture({ id: `x${i}`, bookId: "Big" }));
    const books = [bookFixture("Big", copies)];
    const set = buildChangeSet(books, all(books), { deluxe: true }, LABELS, NOW);
    let inFlight = 0;
    let peak = 0;
    const writeCopy = async () => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 1));
      inFlight--;
    };
    const result = await applyChangeSet(set, { writeCopy, writeBook: vi.fn() });
    expect(result.changedCopies).toBe(20);
    expect(peak).toBe(WRITE_BATCH);
  });
});

describe("library tags", () => {
  const three = (): BookWithCopies[] => [
    bookFixture("Atlas", [copyFixture({ id: "a1", bookId: "Atlas" })]),
    bookFixture("Codex", [copyFixture({ id: "c1", bookId: "Codex" })]),
    bookFixture("Ember", [copyFixture({ id: "e1", bookId: "Ember" })]),
  ];
  const tagsByBook = () =>
    new Map<string, string[]>([
      ["Codex", ["vampires", "found-family"]],
      ["Ember", ["found-family"]],
    ]);

  it("adds a tag only to target books that lack it", () => {
    const books = three();
    const set = buildChangeSet(books, all(books), { addLibraryTags: ["vampires"] }, LABELS, NOW, tagsByBook());
    expect(set.libraryTags.map((c) => [c.book.id, c.add, c.remove])).toEqual([
      ["Atlas", ["vampires"], []],
      ["Ember", ["vampires"], []],
    ]);
    expect(set.copies).toEqual([]);
  });

  it("removes a tag only where it is present, and only from target books", () => {
    const books = three();
    const targets = { copyIds: new Set<string>(), bookIds: new Set(["Atlas", "Codex"]) };
    const set = buildChangeSet(books, targets, { removeLibraryTags: ["found-family"] }, LABELS, NOW, tagsByBook());
    expect(set.libraryTags.map((c) => [c.book.id, c.add, c.remove])).toEqual([["Codex", [], ["found-family"]]]);
  });

  it("ignores a tag that is both added and removed", () => {
    const books = three();
    const set = buildChangeSet(
      books,
      all(books),
      { addLibraryTags: ["vampires"], removeLibraryTags: ["vampires"] },
      LABELS,
      NOW,
      tagsByBook(),
    );
    expect(set.libraryTags).toEqual([]);
  });

  it("defaults to no tags known, so every add counts", () => {
    const books = three();
    const set = buildChangeSet(books, all(books), { addLibraryTags: ["vampires"] }, LABELS, NOW);
    expect(set.libraryTags).toHaveLength(3);
  });

  it("writes adds and deletes; a book with any failed write fails, the rest succeed, and retry includes it", async () => {
    const books = three();
    const set = buildChangeSet(
      books,
      all(books),
      { addLibraryTags: ["vampires"], removeLibraryTags: ["found-family"] },
      LABELS,
      NOW,
      tagsByBook(),
    );
    const addLibraryTag = vi.fn(async (bookId: string) => {
      if (bookId === "Ember") throw new Error("network");
    });
    const removeLibraryTag = vi.fn(async () => {});
    const result = await applyChangeSet(set, { writeCopy: vi.fn(), writeBook: vi.fn(), addLibraryTag, removeLibraryTag });
    expect(addLibraryTag.mock.calls).toEqual([
      ["Atlas", "vampires"],
      ["Ember", "vampires"],
    ]);
    expect(removeLibraryTag.mock.calls).toEqual([
      ["Codex", "found-family"],
      ["Ember", "found-family"],
    ]);
    expect(result.changedTagBooks).toBe(2);
    expect(result.failedTags.map((c) => c.book.id)).toEqual(["Ember"]);
    expect([...retryTargets(result).bookIds]).toEqual(["Ember"]);
  });
});

describe("describeCounts with tags", () => {
  it("names books' tags, joining three parts with a comma", () => {
    expect(describeCounts(0, 0, 2)).toBe("2 books' tags");
    expect(describeCounts(0, 0, 1)).toBe("1 book's tags");
    expect(describeCounts(1, 0, 2)).toBe("1 copy and 2 books' tags");
    expect(describeCounts(14, 3, 2)).toBe("14 copies, 3 books' series and 2 books' tags");
  });
});

describe("marking read status", () => {
  const ME = "u-me";
  const TODAY = "2026-11-15";
  const entry = (state: "read" | "dnf", finishedOn: string | null) => ({ state, finishedOn });
  const books = (): BookWithCopies[] =>
    ["Atlas", "Codex", "Ember", "Fable"].map((t) => bookFixture(t, [copyFixture({ id: t + "1", bookId: t })]));
  const readMap = (): ReadStatusMap =>
    new Map([
      ["Codex", new Map([[ME, entry("read", "2026-03-01")]])],
      ["Ember", new Map([[ME, entry("dnf", null)]])],
    ]);
  const targetsOf = (ids: string[]): MassEditTargets => ({ copyIds: new Set(), bookIds: new Set(ids) });
  const build = (markAs: { state: "read" | "dnf" | "unread"; finishedOn: string | null }, ids = ["Atlas", "Codex", "Ember"]) =>
    buildChangeSet(books(), targetsOf(ids), { markAs }, LABELS, NOW, new Map(), readMap(), ME, TODAY);

  it("a blank-date Read skips books already read and keeps dates", () => {
    const set = build({ state: "read", finishedOn: null });
    expect(set.reads.map((r) => [r.book.id, r.from, r.to])).toEqual([
      ["Atlas", "unread", "read"],
      ["Ember", "dnf", "read"],
    ]);
    expect(set.keepDates).toBe(true);
    expect(set.readDate).toBe(TODAY);
    expect(set.copies).toEqual([]);
  });

  it("an explicit date includes a read book whose date differs and drops keepDates", () => {
    const set = build({ state: "read", finishedOn: "2026-03-01" });
    expect(set.reads.map((r) => r.book.id)).toEqual(["Atlas", "Ember"]);
    expect(set.keepDates).toBe(false);
    expect(set.readDate).toBe("2026-03-01");
    const other = build({ state: "read", finishedOn: "2026-04-02" });
    expect(other.reads.map((r) => r.book.id)).toEqual(["Atlas", "Codex", "Ember"]);
  });

  it("Unread includes only books that are read or not finished, never cleared ones", () => {
    const cleared = buildChangeSet(books(), targetsOf(["Atlas", "Codex", "Fable"]), { markAs: { state: "unread", finishedOn: null } }, LABELS, NOW, new Map(), readMap(), ME, TODAY);
    expect(cleared.reads.map((r) => r.book.id)).toEqual(["Codex"]);
    expect(cleared.readDate).toBeNull();
  });

  it("Did not finish keeps existing dates and sends no date", () => {
    const set = build({ state: "dnf", finishedOn: null });
    expect(set.reads.map((r) => r.book.id)).toEqual(["Atlas", "Codex"]);
    expect(set.keepDates).toBe(true);
    expect(set.readDate).toBeNull();
  });

  it("ignores books outside the targets, and does nothing without a signed-in member", () => {
    expect(build({ state: "read", finishedOn: null }, ["Fable"]).reads.map((r) => r.book.id)).toEqual(["Fable"]);
    expect(build({ state: "read", finishedOn: null }, []).reads).toEqual([]);
    const none = buildChangeSet(books(), targetsOf(["Atlas"]), { markAs: { state: "read", finishedOn: null } }, LABELS, NOW, new Map(), readMap(), null, TODAY);
    expect(none.reads).toEqual([]);
  });

  it("sends one setReadStatus call per 1,000 books and fails a whole chunk together", async () => {
    const many = Array.from({ length: 1500 }, (_, i) => bookFixture(`B${i}`, []));
    const set = buildChangeSet(many, { copyIds: new Set(), bookIds: new Set(many.map((b) => b.id)) }, { markAs: { state: "read", finishedOn: null } }, LABELS, NOW, new Map(), new Map(), ME, TODAY);
    const calls: string[][] = [];
    const setReadStatus = vi.fn(async (ids: string[]) => {
      calls.push(ids);
      if (calls.length === 2) throw new Error("network");
    });
    const result = await applyChangeSet(set, { writeCopy: vi.fn(), writeBook: vi.fn(), setReadStatus });
    expect(calls.map((c) => c.length)).toEqual([1000, 500]);
    expect(setReadStatus).toHaveBeenCalledWith(expect.any(Array), "read", TODAY, true);
    expect(result.changedReadBooks).toBe(1000);
    expect(result.failedReads).toHaveLength(500);
    expect(retryTargets(result).bookIds.size).toBe(500);
  });

  it("fails the books when there is no read writer", async () => {
    const set = build({ state: "read", finishedOn: null });
    const result = await applyChangeSet(set, { writeCopy: vi.fn(), writeBook: vi.fn() });
    expect(result.failedReads).toHaveLength(2);
    expect(result.changedReadBooks).toBe(0);
  });

  it("describes marked books after copies", () => {
    expect(describeCounts(1, 0, 0, 2)).toBe("1 copy and 2 books marked");
    expect(describeCounts(0, 0, 0, 1)).toBe("1 book marked");
  });
});
