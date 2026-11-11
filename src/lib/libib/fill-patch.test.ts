import { describe, expect, it } from "vitest";
import type { Book, BookInput } from "../types";
import { fillPatch } from "./fill-patch";

const book = (over: Partial<Book> = {}): Book => ({
  id: "b1",
  householdId: "h1",
  title: "Glass Orchard",
  authors: ["A B"],
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
  ...over,
});

const incoming = (over: Partial<BookInput> = {}): BookInput => ({
  title: "Glass Orchard",
  authors: ["A B"],
  synopsis: null,
  coverUrl: null,
  isbn13: [],
  isbn10: [],
  pageCount: null,
  publisher: null,
  publishDate: null,
  ...over,
});

describe("fillPatch", () => {
  it("fills an empty synopsis", () => {
    const r = fillPatch(book(), incoming({ synopsis: "New" }));
    expect(r.changed).toEqual(["synopsis"]);
    expect(r.patch).toEqual({ synopsis: "New" });
  });
  it("never replaces a non-empty value", () => {
    const r = fillPatch(book({ publisher: "Old" }), incoming({ publisher: "New" }));
    expect(r.changed).toEqual([]);
  });
  it("does not fill a cleared field the user edited", () => {
    const r = fillPatch(book({ userEditedFields: ["pageCount"] }), incoming({ pageCount: 300 }));
    expect(r.changed).toEqual([]);
  });
  it("unions isbn13 with existing first", () => {
    const r = fillPatch(book({ isbn13: ["9780000000002"] }), incoming({ isbn13: ["9780000000019"] }));
    expect(r.patch.isbn13).toEqual(["9780000000002", "9780000000019"]);
  });
  it("leaves edited isbn13 untouched", () => {
    const r = fillPatch(
      book({ isbn13: ["9780000000002"], userEditedFields: ["isbn13"] }),
      incoming({ isbn13: ["9780000000019"] }),
    );
    expect(r.changed).toEqual([]);
  });
  it("does nothing for a known ISBN", () => {
    const r = fillPatch(book({ isbn13: ["9780000000002"] }), incoming({ isbn13: ["9780000000002"] }));
    expect(r.changed).toEqual([]);
    expect(r.patch).toEqual({});
  });
  it("never patches the title", () => {
    const r = fillPatch(book(), incoming({ title: "Other", synopsis: "S" }));
    expect(r.patch).not.toHaveProperty("title");
  });
  it("gives an empty patch for untidy stored values with no real change", () => {
    const r = fillPatch(book({ publisher: "  Publisher " }), incoming({ publisher: "Other" }));
    expect(r.patch).toEqual({});
  });
  it("converges: applying the patch yields an empty patch", () => {
    const b = book();
    const inc = incoming({ synopsis: "S", pageCount: 10, isbn13: ["9780000000002"], authors: ["Z"] });
    const first = fillPatch(b, inc);
    expect(first.changed.length).toBeGreaterThan(0);
    expect(fillPatch({ ...b, ...first.patch }, inc).patch).toEqual({});
  });
});
