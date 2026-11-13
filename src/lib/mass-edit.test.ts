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
    expect(buildChangeSet(books, all(books), {}, LABELS, NOW)).toEqual({ copies: [], books: [] });
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
