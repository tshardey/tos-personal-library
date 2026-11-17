import { describe, expect, it } from "vitest";
import { bookFixture, copyFixture } from "./flag-fixtures.test-util";
import { SORT_KEYS, SORT_LABELS, authorSortKey, sortBooks } from "./sort-books";

const titles = (bs: { title: string }[]) => bs.map((b) => b.title);

describe("sortBooks: title", () => {
  it("returns catalogue order in a new array", () => {
    const books = [bookFixture("Zed", []), bookFixture("Alpha", [])];
    const out = sortBooks(books, "title");
    expect(titles(out)).toEqual(["Zed", "Alpha"]);
    expect(out).not.toBe(books);
  });
});

describe("sortBooks: author", () => {
  it("builds surname keys", () => {
    expect(authorSortKey("Tobias Quillfeather Jr.")).toBe("quillfeather");
    expect(authorSortKey("Petra Wynnecombe III")).toBe("wynnecombe");
    expect(authorSortKey("Ines Dravenholt")).toBe("dravenholt");
  });

  it("orders by surname, accent-insensitive, no author last, then title", () => {
    const books = [
      bookFixture("No Author", [], { authors: [] }),
      bookFixture("B Book", [], { authors: ["Petra Wynnecombe"] }),
      bookFixture("Z Book", [], { authors: ["Ines Dravenholt"] }),
      bookFixture("A Book", [], { authors: ["Ines Dravenholt"] }),
      bookFixture("Accent", [], { authors: ["Émile Abernathy"] }),
    ];
    expect(titles(sortBooks(books, "author"))).toEqual(["Accent", "A Book", "Z Book", "B Book", "No Author"]);
  });
});

describe("sortBooks: added", () => {
  it("uses the newest copy, else the book's own createdAt", () => {
    const old = bookFixture("Old", [copyFixture({ createdAt: "2026-01-01T00:00:00" })]);
    const grew = bookFixture("Grew", [
      copyFixture({ createdAt: "2025-01-01T00:00:00" }),
      copyFixture({ createdAt: "2026-06-01T00:00:00" }),
    ]);
    const bare = bookFixture("Bare", [], { createdAt: "2026-03-01T00:00:00" });
    expect(titles(sortBooks([old, bare, grew], "added"))).toEqual(["Grew", "Bare", "Old"]);
  });
});

describe("sortBooks: published", () => {
  it("is newest first with month/day precision, nulls last, stable ties", () => {
    const mk = (t: string, d: string | null) => bookFixture(t, [], { publishDate: d });
    const books = [
      mk("Null", null),
      mk("Y2019", "2019"),
      mk("Y2021", "2021"),
      mk("D", "2021-02-10"),
      mk("M", "2021-05"),
      mk("TieA", "2018"),
      mk("TieB", "2018"),
    ];
    expect(titles(sortBooks(books, "published"))).toEqual(["M", "D", "Y2021", "Y2019", "TieA", "TieB", "Null"]);
  });
});

describe("sortBooks: series", () => {
  it("is volume order, 2.5 between 2 and 3, nulls last, for every key", () => {
    const mk = (t: string, v: number | null) => bookFixture(t, [], { seriesName: "Lantern Cycle", seriesVolume: v });
    const books = [mk("Three", 3), mk("None", null), mk("Two", 2), mk("Half", 2.5), mk("One", 1)];
    for (const key of SORT_KEYS) {
      expect(titles(sortBooks(books, key, { series: "Lantern Cycle" }))).toEqual(["One", "Two", "Half", "Three", "None"]);
    }
  });
});

describe("labels", () => {
  it("names every key", () => {
    expect(SORT_LABELS.published).toBe("Published (newest first)");
    expect(SORT_LABELS.added).toBe("Recently added");
  });
});
