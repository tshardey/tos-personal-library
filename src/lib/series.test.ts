import { describe, expect, it } from "vitest";
import { mkBook } from "./covers/fixtures.test-util";
import { canonicalSeries, isSeriesHandSet, joinsExisting, parseVolume, seriesFillTargets, seriesNames, sortSeriesTargets } from "./series";
import type { SeriesSuggestion } from "./tagging/types";
import type { Book } from "./types";

const b = (seriesName: string | null) => ({ seriesName }) as Book;

describe("seriesNames", () => {
  it("trims, groups case-insensitively, keeps the most-used spelling and sorts", () => {
    expect(seriesNames([" Saga", "saga", "Saga", "Other", null, "  "].map(b))).toEqual(["Other", "Saga"]);
  });
});

describe("canonicalSeries", () => {
  it("reuses an existing spelling on a case-insensitive hit", () => {
    expect(canonicalSeries("SAGA", ["Saga"])).toBe("Saga");
    expect(canonicalSeries("  New One ", ["Saga"])).toBe("New One");
  });
  it("rejects blank and over-long names", () => {
    expect(canonicalSeries("   ", [])).toBeNull();
    expect(canonicalSeries("x".repeat(201), [])).toBeNull();
    expect(canonicalSeries("x".repeat(200), [])).toBe("x".repeat(200));
  });
});

describe("parseVolume", () => {
  it("blank is null, numbers parse, junk and out-of-range are undefined", () => {
    expect(parseVolume("")).toBeNull();
    expect(parseVolume("  ")).toBeNull();
    expect(parseVolume("2.5")).toBe(2.5);
    expect(parseVolume("x")).toBeUndefined();
    expect(parseVolume("-1")).toBeUndefined();
    expect(parseVolume("10000")).toBeUndefined();
  });
});

describe("joinsExisting", () => {
  it("returns the existing spelling only on a case-only difference", () => {
    expect(joinsExisting("thornmere  cycle", ["Thornmere Cycle"])).toBeNull();
    expect(joinsExisting("THORNMERE CYCLE", ["Thornmere Cycle"])).toBe("Thornmere Cycle");
    expect(joinsExisting("  THORNMERE CYCLE ", ["Thornmere Cycle"])).toBe("Thornmere Cycle");
    expect(joinsExisting("Thornmere Cycle", ["Thornmere Cycle"])).toBeNull();
    expect(joinsExisting("Ember Loom", ["Thornmere Cycle"])).toBeNull();
  });
});

describe("isSeriesHandSet", () => {
  it("is true when seriesName or seriesVolume is marked", () => {
    expect(isSeriesHandSet({ userEditedFields: ["seriesName"] })).toBe(true);
    expect(isSeriesHandSet({ userEditedFields: ["seriesVolume"] })).toBe(true);
    expect(isSeriesHandSet({ userEditedFields: ["title"] })).toBe(false);
  });
});

describe("seriesFillTargets", () => {
  it("drops deleted, already-in-series and hand-set books, keeping suggestion order", () => {
    const s: SeriesSuggestion = {
      id: "s1",
      name: "Saltglass Archive",
      kind: "new",
      books: [
        { bookId: "b3", volume: 3, why: "third" },
        { bookId: "gone", volume: 2, why: null },
        { bookId: "b1", volume: null, why: "first" },
        { bookId: "inseries", volume: 4, why: null },
        { bookId: "hand", volume: 5, why: null },
      ],
    };
    const books = [
      mkBook("b1"),
      mkBook("b3"),
      mkBook("inseries", { seriesName: "Lantern Vale" }),
      mkBook("hand", { userEditedFields: ["seriesName"] }),
    ];
    const out = seriesFillTargets(s, books);
    expect(out.map((t) => [t.book.id, t.volume, t.why])).toEqual([
      ["b3", 3, "third"],
      ["b1", null, "first"],
    ]);
  });
});

describe("sortSeriesTargets", () => {
  const t = (id: string, title: string, volume: number | null) => ({ book: { id, title }, volume });
  it("puts volumes ascending, then unnumbered books by title, numbers in order", () => {
    const out = sortSeriesTargets([
      t("3", "Three", 3), t("b", "Beta", null), t("1", "One", 1), t("a", "alpha", null), t("2", "Two", 2),
    ]);
    expect(out.map((x) => x.book.id)).toEqual(["1", "2", "3", "a", "b"]);
    const nums = sortSeriesTargets([t("x", "Book 10", null), t("y", "Book 9", null)]);
    expect(nums.map((x) => x.book.id)).toEqual(["y", "x"]);
  });
  it("breaks ties by id and does not mutate its input", () => {
    const input = [t("b", "Same", 1), t("a", "Same", 1)];
    expect(sortSeriesTargets(input).map((x) => x.book.id)).toEqual(["a", "b"]);
    expect(input[0].book.id).toBe("b");
  });
  it("seriesFillTargets returns sorted targets for new and existing suggestions", () => {
    const books = [mkBook("b1", { title: "Beta" }), mkBook("b2", { title: "Alpha" }), mkBook("b3", { title: "Gamma" })];
    for (const kind of ["new", "existing"] as const) {
      const s: SeriesSuggestion = {
        id: "s", name: "Ember Loom", kind,
        books: [
          { bookId: "b1", volume: null, why: null },
          { bookId: "b3", volume: 2, why: null },
          { bookId: "b2", volume: 1, why: null },
        ],
      };
      expect(seriesFillTargets(s, books).map((x) => x.book.id)).toEqual(["b2", "b3", "b1"]);
    }
  });
});
