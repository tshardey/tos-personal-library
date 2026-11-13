import { describe, expect, it } from "vitest";
import { filterBooks } from "./filter-books";
import type { BookWithCopies, Copy } from "./types";
import { bookBadges } from "./copy-flags";
import { bookFixture, copyFixture } from "./flag-fixtures";

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

const slewfoot = book("Slewfoot", ["Brom"], ["u1"]);
const jade = book("Jade City", ["Fonda Lee"], [null]);
const poete = book("Poète Empress", ["Someone"], ["u2"]);
const multi = book("Co-written", ["First Author", "Second Writer"], ["u1", null]);
const none = book("Orphan", ["Nobody"]);
const all = [slewfoot, jade, poete, multi, none];

describe("filterBooks", () => {
  it("matches author case-insensitively", () => {
    expect(filterBooks(all, { query: "brom", owner: "all" })).toEqual([slewfoot]);
    expect(filterBooks(all, { query: "lee", owner: "all" })).toEqual([jade]);
  });
  it("is accent-insensitive", () => {
    expect(filterBooks(all, { query: "poete", owner: "all" })).toEqual([poete]);
  });
  it("matches the second author", () => {
    expect(filterBooks(all, { query: "second", owner: "all" })).toEqual([multi]);
  });
  it("empty query keeps input order", () => {
    expect(filterBooks(all, { query: "", owner: "all" })).toEqual(all);
  });
  it("filters shared", () => {
    expect(filterBooks(all, { query: "", owner: "shared" })).toEqual([jade, multi]);
  });
  it("filters by member", () => {
    expect(filterBooks(all, { query: "", owner: "u1" })).toEqual([slewfoot, multi]);
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
