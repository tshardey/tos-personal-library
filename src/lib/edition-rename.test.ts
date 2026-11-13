import { describe, expect, it, vi } from "vitest";
import { applyRename, labelCounts, planRename } from "./edition-rename";
import { bookFixture, copyFixture } from "./flag-fixtures.test-util";
import type { BookWithCopies } from "./types";

function catalog(notes: (string | null)[][]): BookWithCopies[] {
  return notes.map((copies, b) =>
    bookFixture(
      `Book ${b}`,
      copies.map((editionNote, c) => copyFixture({ id: `b${b}c${c}`, bookId: `Book ${b}`, editionNote })),
    ),
  );
}

describe("labelCounts", () => {
  it("counts trimmed exact labels, keeps case variants apart, skips blanks, sorts alphabetically", () => {
    const books = catalog([
      ["Lantern Box", " Lantern Box ", null],
      ["lantern box", "Harbor Press", "  "],
      ["Amber Folio"],
    ]);
    expect(labelCounts(books)).toEqual([
      { label: "Amber Folio", count: 1 },
      { label: "Harbor Press", count: 1 },
      { label: "lantern box", count: 1 },
      { label: "Lantern Box", count: 2 },
    ]);
  });
});

describe("planRename", () => {
  const books = catalog([
    ["Lantern Box Edition", "Lantern Box Edition "],
    ["Lantern Box", "Harbor Press", null],
    ["Lantern Box"],
  ]);

  it("renames every copy with the exact trimmed label to a new name", () => {
    const plan = planRename(books, "Harbor Press", "  Harbor Press Classics ");
    expect(plan).toMatchObject({ kind: "rename", from: "Harbor Press", to: "Harbor Press Classics", resultCount: 1 });
    if (plan.kind === "invalid") throw new Error();
    expect(plan.copies.map((c) => c.id)).toEqual(["b1c1"]);
  });

  it("merges case-insensitively into an existing label using its spelling and combined count", () => {
    const plan = planRename(books, "Lantern Box Edition", " lantern BOX ");
    expect(plan).toMatchObject({ kind: "merge", to: "Lantern Box", resultCount: 4 });
    if (plan.kind === "invalid") throw new Error();
    expect(plan.copies.map((c) => c.id)).toEqual(["b0c0", "b0c1"]);
  });

  it("treats a recasing of the label itself as a rename, not a merge", () => {
    expect(planRename(books, "Harbor Press", "HARBOR PRESS")).toMatchObject({ kind: "rename", to: "HARBOR PRESS" });
  });

  it("merges a case variant into the other spelling", () => {
    const variants = catalog([["harbor press", "Harbor Press", "Harbor Press"]]);
    expect(planRename(variants, "harbor press", "Harbor Press")).toMatchObject({ kind: "merge", to: "Harbor Press", resultCount: 3 });
  });

  it("clears the label for a blank name", () => {
    const plan = planRename(books, "Lantern Box", "   ");
    expect(plan).toMatchObject({ kind: "clear", to: null, resultCount: 0 });
    if (plan.kind === "invalid") throw new Error();
    expect(plan.copies).toHaveLength(2);
  });

  it("rejects an unchanged name, an unknown label and an over-long name", () => {
    expect(planRename(books, "Harbor Press", " Harbor Press ").kind).toBe("invalid");
    expect(planRename(books, "Nowhere Books", "X").kind).toBe("invalid");
    expect(planRename(books, "Harbor Press", "x".repeat(121)).kind).toBe("invalid");
  });
});

describe("applyRename", () => {
  it("writes only editionNote and adds it to user_edited_fields without duplicates", async () => {
    const books = [
      bookFixture("A", [
        copyFixture({ id: "c1", editionNote: "Lantern Box Edition", userEditedFields: ["location"] }),
        copyFixture({ id: "c2", editionNote: "Lantern Box Edition", userEditedFields: ["editionNote", "copyNote"] }),
      ]),
    ];
    const plan = planRename(books, "Lantern Box Edition", "Lantern Box");
    if (plan.kind === "invalid") throw new Error();
    const write = vi.fn().mockResolvedValue(undefined);
    await expect(applyRename(plan, write)).resolves.toEqual({ changed: 2, failed: 0 });
    expect(write).toHaveBeenCalledWith("c1", { editionNote: "Lantern Box" }, ["editionNote", "location"]);
    expect(write).toHaveBeenCalledWith("c2", { editionNote: "Lantern Box" }, ["copyNote", "editionNote"]);
  });

  it("writes null for a clear and counts failures without stopping", async () => {
    const books = catalog([["Harbor Press", "Harbor Press", "Harbor Press"]]);
    const plan = planRename(books, "Harbor Press", "");
    if (plan.kind === "invalid") throw new Error();
    const write = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("rls")).mockResolvedValue(undefined);
    await expect(applyRename(plan, write)).resolves.toEqual({ changed: 2, failed: 1 });
    expect(write).toHaveBeenCalledTimes(3);
    expect(write.mock.calls[0][1]).toEqual({ editionNote: null });
  });
});
