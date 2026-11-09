import { describe, expect, it } from "vitest";
import { filterBooks } from "./filter-books";
import type { BookWithCopies, Copy } from "./types";

function copy(ownerUserId: string | null): Copy {
  return {
    id: Math.random().toString(),
    bookId: "b",
    ownerUserId,
    editionNote: null,
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
    userEditedFields: [],
    createdAt: "",
    updatedAt: "",
    copies: owners.map(copy),
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
});
