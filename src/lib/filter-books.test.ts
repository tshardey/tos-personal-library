import { describe, expect, it } from "vitest";
import { filterBooks, type FilterOptions } from "./filter-books";
import { toStatusMap } from "./reading/status";
import type { ReadStatusRow } from "./reading/types";
import type { BookWithCopies, Copy } from "./types";
import { bookBadges } from "./copy-flags";
import { bookFixture, copyFixture } from "./flag-fixtures.test-util";

function copy(ownerUserId: string | null, editionNote: string | null = null): Copy {
  return {
    id: Math.random().toString(),
    bookId: "b",
    ownerUserId,
    editionNote,
    copyNote: null,
    location: null,
    origin: "manual",
    libibId: null,
    photoPath: null,
    intakeItemId: null,
    unhauledAt: null,
    deluxe: false,
    signed: false,
    userEditedFields: [],
    createdAt: "",
    updatedAt: "",
  };
}

function book(title: string, authors: string[], owners: (string | null)[] = []): BookWithCopies {
  return {
    id: title,
    householdId: "h",
    title,
    authors,
    synopsis: null,
    coverUrl: null,
    isbn13: [],
    isbn10: [],
    openlibraryId: null,
    googleBooksId: null,
    pageCount: null,
    publisher: null,
    publishDate: null,
    seriesName: null,
    seriesVolume: null,
    onShelf: true,
    userEditedFields: [],
    createdAt: "",
    updatedAt: "",
    copies: owners.map((o) => copy(o)),
  };
}

const hollowmere = book("Hollowmere", ["Ansel Brack"], ["u1"]);
const copper = book("Copper Harbour", ["Ilsa Venn"], [null]);
const poete = book("Poète Empress", ["Someone"], ["u2"]);
const multi = book("Co-written", ["First Author", "Second Writer"], ["u1", null]);
const none = book("Orphan", ["Nobody"]);
const all = [hollowmere, copper, poete, multi, none];

describe("filterBooks", () => {
  it("matches author case-insensitively", () => {
    expect(filterBooks(all, { query: "brack", owner: "all" })).toEqual([hollowmere]);
    expect(filterBooks(all, { query: "venn", owner: "all" })).toEqual([copper]);
  });
  it("is accent-insensitive", () => {
    expect(filterBooks(all, { query: "poete", owner: "all" })).toEqual([poete]);
  });
  it("matches the second author", () => {
    expect(filterBooks(all, { query: "second", owner: "all" })).toEqual([multi]);
  });
  it("matches every word in any order and ignores a leading article", () => {
    expect(filterBooks(all, { query: "the orphan", owner: "all" })).toEqual([none]);
    expect(filterBooks(all, { query: "writer co", owner: "all" })).toEqual([multi]);
    expect(filterBooks(all, { query: "orphan writer", owner: "all" })).toEqual([]);
  });
  it("empty query keeps input order", () => {
    expect(filterBooks(all, { query: "", owner: "all" })).toEqual(all);
  });
  it("filters shared", () => {
    expect(filterBooks(all, { query: "", owner: "shared" })).toEqual([copper, multi]);
  });
  it("filters by member", () => {
    expect(filterBooks(all, { query: "", owner: "u1" })).toEqual([hollowmere, multi]);
  });
  it("all keeps books with zero copies", () => {
    expect(filterBooks(all, { query: "orphan", owner: "all" })).toEqual([none]);
  });
  it("filters by edition, exact and case-insensitive", () => {
    const a = book("Edition A", ["X"]);
    a.copies = [copy(null, "Invented Box")];
    const b = book("Edition B", ["X"]);
    b.copies = [copy(null, "Invented Box Deluxe")];
    expect(filterBooks([a, b, none], { query: "", owner: "all", edition: "invented box" })).toEqual([a]);
  });
  it("search matches a copy's edition note", () => {
    const a = book("Edition A", ["X"]);
    a.copies = [copy(null, "Invented Box")];
    expect(filterBooks([a, none], { query: "invented", owner: "all" })).toEqual([a]);
  });
  it("edition null filters nothing", () => {
    expect(filterBooks(all, { query: "", owner: "all", edition: null })).toEqual(all);
  });
});

describe("filterBooks tags and series", () => {
  const saga = { ...book("Saga One", ["A"], ["u1"]), seriesName: "Saga" };
  const plain = book("Plain", ["B"], ["u1"]);
  const tagsByBook = new Map([
    [saga.id, ["epistolary", "fantasy"]],
    [plain.id, ["fantasy"]],
  ]);
  const set = [saga, plain];
  it("requires every selected tag", () => {
    expect(filterBooks(set, { query: "", owner: "all", tags: ["epistolary", "fantasy"], tagsByBook })).toEqual([saga]);
    expect(filterBooks(set, { query: "", owner: "all", tags: ["fantasy"], tagsByBook })).toEqual(set);
  });
  it("matches series case-insensitively", () => {
    expect(filterBooks(set, { query: "", owner: "all", series: "saga" })).toEqual([saga]);
  });
  it("combines with owner and edition", () => {
    expect(filterBooks(set, { query: "", owner: "u2", series: "saga" })).toEqual([]);
    expect(filterBooks(set, { query: "", owner: "u1", edition: "nope", tags: ["fantasy"], tagsByBook })).toEqual([]);
    expect(filterBooks(set, { query: "", owner: "u1", series: "Saga", tags: ["fantasy"], tagsByBook })).toEqual([saga]);
  });
});

describe("filterBooks: copy flags, date added, published", () => {
  const base = { query: "", owner: "all" as const };
  const P = bookFixture("Pine Hollow", [
    copyFixture({ ownerUserId: "A", createdAt: new Date(2026, 9, 1, 10).toISOString() }),
    copyFixture({ ownerUserId: "B", unhauledAt: "2026-11-01T00:00:00Z", deluxe: true, createdAt: new Date(2026, 10, 12, 10).toISOString() }),
  ]);
  const U = bookFixture("Ugly Tide", [copyFixture({ unhauledAt: "2026-11-01T00:00:00Z" })]);
  const Z = bookFixture("Zero Copies", []);
  const all3 = [P, U, Z];

  it("main view hides not-on-shelf books unless searched", () => {
    expect(filterBooks(all3, base)).toEqual([P, Z]);
    expect(filterBooks(all3, { ...base, query: "   " })).toEqual([P, Z]);
    expect(filterBooks(all3, { ...base, query: "ugly" })).toEqual([U]);
    expect(filterBooks(all3, { ...base, query: "author" })).toEqual(all3);
  });
  it("unhauled filter gives books with an unhauled copy", () => {
    expect(filterBooks(all3, { ...base, unhauled: true })).toEqual([P, U]);
  });
  it("counted copies (D7)", () => {
    expect(filterBooks(all3, { ...base, owner: "B" })).toEqual([]);
    expect(filterBooks(all3, { ...base, owner: "B", unhauled: true })).toEqual([P]);
    expect(filterBooks(all3, { ...base, deluxe: true })).toEqual([]);
    expect(bookBadges(P).deluxe).toBe(false);
  });
  it("filters combine independently across copies", () => {
    const X = bookFixture("Xylem", [
      copyFixture({ ownerUserId: "A", deluxe: true }),
      copyFixture({ ownerUserId: "B", signed: true }),
    ], { seriesName: "Saga" });
    expect(filterBooks([X], { ...base, deluxe: true, signed: true })).toEqual([X]);
    expect(filterBooks([X], { ...base, deluxe: true, owner: "A", series: "saga" })).toEqual([X]);
    expect(filterBooks([X], { ...base, deluxe: true, owner: "A", series: "other" })).toEqual([]);
  });
  it("date added honors the unhauled rule", () => {
    expect(filterBooks(all3, { ...base, addedDay: "2026-11-12" })).toEqual([]);
    expect(filterBooks(all3, { ...base, addedDay: "2026-11-12", unhauled: true })).toEqual([P, U]);
  });
  it("published range is inclusive, swaps, drops null years", () => {
    const mk = (y: string | null) => bookFixture(`T${y}`, [copyFixture()], { publishDate: y });
    const bs = [mk("2009"), mk("2010"), mk("2020"), mk("2021"), mk(null)];
    const titles = (o: object) => filterBooks(bs, { ...base, ...o }).map((b) => b.title);
    expect(titles({ publishedFrom: 2010, publishedTo: 2020 })).toEqual(["T2010", "T2020"]);
    expect(titles({ publishedFrom: 2020, publishedTo: 2010 })).toEqual(["T2010", "T2020"]);
    expect(titles({ publishedFrom: 2020 })).toEqual(["T2020", "T2021"]);
  });
});

describe("filterBooks library tags", () => {
  it("needs every chosen library tag", () => {
    const a = bookFixture("Glass Orchard", [copyFixture()]);
    const b = bookFixture("The Salt Road", [copyFixture()]);
    const libraryTagsByBook = new Map([
      [a.id, ["vampires", "cover-red"]],
      [b.id, ["vampires"]],
    ]);
    const out = filterBooks([a, b], { query: "", owner: "all", libraryTags: ["vampires", "cover-red"], libraryTagsByBook });
    expect(out.map((x) => x.title)).toEqual(["Glass Orchard"]);
  });
});

describe("filterBooks read status", () => {
  const a = bookFixture("Glass Orchard", [copyFixture()]);
  const b = bookFixture("The Salt Road", [copyFixture()]);
  const c = bookFixture("Hollow Tide", [copyFixture()]);
  const d = bookFixture("Paper Tide", [copyFixture()]);
  const gone = bookFixture("Lost Ferry", [copyFixture({ unhauledAt: "2026-11-01T00:00:00" })]);
  const all = [a, b, c, d, gone];
  const rows = (id: string, userId: string, status: "read" | "dnf" | "cleared"): ReadStatusRow => ({
    bookId: id,
    userId,
    status,
    finishedOn: null,
    source: "app",
    markedAt: "2026-01-01T00:00:00Z",
  });
  const readStatusByBook = toStatusMap([
    rows(a.id, "a", "read"),
    rows(b.id, "a", "dnf"),
    rows(c.id, "a", "cleared"),
    rows(d.id, "b", "read"),
  ]);
  const titles = (opts: Partial<FilterOptions>) =>
    filterBooks(all, { query: "", owner: "all", readStatusByBook, ...opts }).map((x) => x.title);

  it("Unread by me keeps no-status and cleared books, drops my read and dnf", () => {
    expect(titles({ readStatus: { userId: "a", state: "unread" } })).toEqual(["Hollow Tide", "Paper Tide"]);
  });
  it("Read by me and Did not finish (me) keep only those", () => {
    expect(titles({ readStatus: { userId: "a", state: "read" } })).toEqual(["Glass Orchard"]);
    expect(titles({ readStatus: { userId: "a", state: "dnf" } })).toEqual(["The Salt Road"]);
  });
  it("Unread by B uses B's map", () => {
    expect(titles({ readStatus: { userId: "b", state: "unread" } })).toEqual([
      "Glass Orchard",
      "The Salt Road",
      "Hollow Tide",
    ]);
  });
  it("counts every book as unread with no map", () => {
    const out = filterBooks(all, { query: "", owner: "all", readStatus: { userId: "a", state: "unread" } });
    expect(out.map((x) => x.title)).toEqual(["Glass Orchard", "The Salt Road", "Hollow Tide", "Paper Tide"]);
    expect(filterBooks(all, { query: "", owner: "all", readStatus: { userId: "a", state: "read" } })).toEqual([]);
  });
  it("keeps unhauled books hidden", () => {
    expect(titles({ readStatus: { userId: "z", state: "unread" } })).not.toContain("Lost Ferry");
  });
});
