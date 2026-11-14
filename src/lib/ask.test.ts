import { describe, expect, it } from "vitest";
import { ASK_MAX_BOOKS, ASK_MAX_PROMPT, askBookIds } from "./ask";
import { bookFixture, copyFixture } from "./flag-fixtures.test-util";
import { DEFAULT_VIEW } from "./library-view";

const hauled = (title: string, owner: string | null = null) =>
  bookFixture(title, [copyFixture({ ownerUserId: owner })]);
const unhauledBook = bookFixture("Hollow Tide", [copyFixture({ unhauledAt: "2026-11-01T00:00:00" })]);
const cover = { available: false, marks: new Map(), latest: new Map() };
const none = new Map<string, string[]>();

describe("askBookIds", () => {
  const books = [hauled("Glass Orchard", "a"), hauled("The Salt Road", "b"), unhauledBook];

  it("ignores the box text and keeps unhauled books out", () => {
    const view = { ...DEFAULT_VIEW, query: "starts with B" };
    expect(askBookIds(books, view, none, none, null, cover)).toEqual(["Glass Orchard", "The Salt Road"]);
  });

  it("includes unhauled books when the Unhauled filter is on", () => {
    const view = { ...DEFAULT_VIEW, query: "anything", unhauled: true };
    expect(askBookIds(books, view, none, none, null, cover)).toEqual(["Hollow Tide"]);
  });

  it("narrows by owner and library tags", () => {
    expect(askBookIds(books, { ...DEFAULT_VIEW, owner: "a" }, none, none, null, cover)).toEqual(["Glass Orchard"]);
    const lib = new Map([["The Salt Road", ["vampires"]]]);
    expect(askBookIds(books, { ...DEFAULT_VIEW, libraryTags: ["vampires"] }, none, lib, null, cover)).toEqual([
      "The Salt Road",
    ]);
  });

  it("applies the cover filter when covers are available", () => {
    const withCover = [bookFixture("A", [copyFixture()], { coverUrl: "x" }), hauled("B")];
    const c = { ...cover, available: true };
    expect(askBookIds(withCover, { ...DEFAULT_VIEW, coverFilter: "no_cover" }, none, none, null, c)).toEqual(["B"]);
  });

  it("exports the limits", () => {
    expect(ASK_MAX_BOOKS).toBe(2000);
    expect(ASK_MAX_PROMPT).toBe(300);
  });
});
