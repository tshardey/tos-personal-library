import { describe, expect, it } from "vitest";
import { canonicalLabel, editionLabels } from "./editions";
import type { BookWithCopies, Copy } from "./types";

function copy(editionNote: string | null): Copy {
  return {
    id: Math.random().toString(),
    bookId: "b",
    ownerUserId: null,
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
function catalog(notes: (string | null)[]): BookWithCopies[] {
  return [{ id: "b", copies: notes.map(copy) } as unknown as BookWithCopies];
}

describe("editionLabels", () => {
  it("groups case-insensitively, keeping the most used spelling, sorted", () => {
    const books = catalog(["Invented Box", "invented box", "Invented Box", " Other Box "]);
    expect(editionLabels(books, ["Third Box"])).toEqual(["Invented Box", "Other Box", "Third Box"]);
  });
  it("drops blanks and over-long notes", () => {
    expect(editionLabels(catalog(["  ", null, "x".repeat(121), "x".repeat(120)]), ["", " "])).toEqual([
      "x".repeat(120),
    ]);
  });
  it("gives [] for empty input", () => {
    expect(editionLabels([], [])).toEqual([]);
  });
  it("breaks a spelling tie by localeCompare", () => {
    expect(editionLabels(catalog(["b box", "B Box"]), [])).toEqual(["b box"]);
  });
});

describe("canonicalLabel", () => {
  const labels = ["Invented Box", "Other Box"];
  it("uses the existing spelling on a case-insensitive hit", () => {
    expect(canonicalLabel("invented BOX", labels)).toBe("Invented Box");
  });
  it("returns null for blank", () => {
    expect(canonicalLabel("  ", labels)).toBeNull();
  });
  it("trims new labels", () => {
    expect(canonicalLabel(" New ", labels)).toBe("New");
  });
  it("accepts 120 characters, rejects 121", () => {
    expect(canonicalLabel(`  ${"y".repeat(120)}  `, labels)).toBe("y".repeat(120));
    expect(canonicalLabel("y".repeat(121), labels)).toBeNull();
  });
});
