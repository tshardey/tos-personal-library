import { describe, expect, it } from "vitest";
import { normalizeBookInput, normalizeCopyInput, splitList } from "./normalize";
import { diffPatch, markEdited } from "./edited-fields";
import { fromBookPatch, fromCopyPatch } from "./types";
import type { BookInput } from "./types";

const EDITABLE: (keyof BookInput)[] = ["title", "authors", "synopsis", "pageCount"];

describe("normalize", () => {
  it("splitList trims and drops blanks", () => {
    expect(splitList(" a, ,b ,")).toEqual(["a", "b"]);
  });

  it("normalizeBookInput trims and turns blanks into null", () => {
    const n = normalizeBookInput({
      title: "  Jade City ",
      authors: [" Fonda Lee ", ""],
      synopsis: "",
      coverUrl: "  ",
      isbn13: [],
      isbn10: [],
      pageCount: 5,
      publisher: " Orbit ",
      publishDate: null,
    });
    expect(n.title).toBe("Jade City");
    expect(n.authors).toEqual(["Fonda Lee"]);
    expect(n.synopsis).toBeNull();
    expect(n.coverUrl).toBeNull();
    expect(n.publisher).toBe("Orbit");
  });

  it("normalizeCopyInput trims and nulls blanks", () => {
    expect(normalizeCopyInput({ ownerUserId: "", editionNote: " x ", location: " " })).toEqual({
      ownerUserId: null,
      editionNote: "x",
      location: null,
    });
  });

  it("only a real change is marked edited when imported values are untidy", () => {
    const raw: BookInput = {
      title: "  Jade City ",
      authors: ["Fonda Lee"],
      synopsis: "",
      coverUrl: null,
      isbn13: [],
      isbn10: [],
      pageCount: 400,
      publisher: null,
      publishDate: null,
    };
    const before = normalizeBookInput(raw);
    const next = normalizeBookInput({ ...before, pageCount: 410 });
    const { changed, patch } = diffPatch(before, next, EDITABLE);
    expect(markEdited([], changed)).toEqual(["pageCount"]);
    expect(patch).toEqual({ pageCount: 410 });
  });

  it("fromBookPatch drops non-editable keys", () => {
    const out = fromBookPatch({
      id: "x",
      householdId: "h",
      createdAt: "c",
      updatedAt: "u",
      userEditedFields: ["a"],
      title: "T",
    });
    expect(out).toEqual({ title: "T" });
  });

  it("fromCopyPatch drops non-editable keys", () => {
    const out = fromCopyPatch({ id: "x", bookId: "b", createdAt: "c", location: "L" } as never);
    expect(out).toEqual({ location: "L" });
  });
});
