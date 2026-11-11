import { describe, expect, it } from "vitest";
import { filterBooks } from "./filter-books";
import type { BookWithCopies, Copy } from "./types";

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
