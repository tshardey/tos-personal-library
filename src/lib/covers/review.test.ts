import { describe, expect, it } from "vitest";
import { buildReviewRows, pickedCount, planApply, type RowChoice } from "./review";
import { mkBook, mkSearch } from "./fixtures.test-util";
import type { CoverResult } from "./types";

const res = (n: number): CoverResult => ({
  url: `https://covers.openlibrary.org/b/id/${n}-L.jpg`,
  source: "openlibrary",
  width: 300,
  height: 450,
});
const U1 = res(1000001).url;
const U2 = res(1000002).url;

describe("buildReviewRows", () => {
  it("defaults to the first result", () => {
    const rows = buildReviewRows(
      [mkSearch("s1", "a", "ready", { results: [res(1000001), res(1000002)], coverAtRequest: mkBook("a").coverUrl })],
      [mkBook("a")],
    );
    expect(rows[0]).toMatchObject({ kind: "results", coverChanged: false, defaultChoice: U1 });
  });
  it("hand-edited cover defaults to keep", () => {
    const rows = buildReviewRows(
      [mkSearch("s1", "a", "ready", { results: [res(1000001)], coverAtRequest: "https://covers.openlibrary.org/b/id/9-L.jpg" })],
      [mkBook("a")],
    );
    expect(rows[0].coverChanged).toBe(true);
    expect(rows[0].defaultChoice).toBe("keep");
  });
  it("null/null is not changed", () => {
    const rows = buildReviewRows(
      [mkSearch("s1", "a", "ready", { results: [res(1000001)] })],
      [mkBook("a", { coverUrl: null })],
    );
    expect(rows[0].coverChanged).toBe(false);
  });
  it("seen nothing_found excluded, unseen included, deleted dropped, results first", () => {
    const rows = buildReviewRows(
      [
        mkSearch("nf-seen", "a", "nothing_found", { seenAt: "2026-11-02T00:00:00Z" }),
        mkSearch("nf", "b", "failed", { createdAt: "2026-11-01T00:00:00Z" }),
        mkSearch("gone", "zzz", "ready", { results: [res(1000001)] }),
        mkSearch("r", "c", "ready", { results: [res(1000001)], createdAt: "2026-11-05T00:00:00Z" }),
      ],
      [mkBook("a"), mkBook("b"), mkBook("c")],
    );
    expect(rows.map((r) => r.search.id)).toEqual(["r", "nf"]);
    expect(rows[1]).toMatchObject({ kind: "failed", defaultChoice: null });
  });
});

describe("planApply", () => {
  const cover = mkBook("a").coverUrl;
  const searches = [
    mkSearch("s1", "a", "ready", { results: [res(1000001), res(1000002)], coverAtRequest: cover }),
    mkSearch("s2", "b", "ready", { results: [res(1000001)], coverAtRequest: cover, createdAt: "2026-11-02T00:00:00Z" }),
    mkSearch("s3", "c", "nothing_found", { createdAt: "2026-11-03T00:00:00Z" }),
  ];
  const books = [mkBook("a"), mkBook("b"), mkBook("c")];
  const choices = new Map<string, RowChoice>([
    ["s1", U2],
    ["s2", "keep"],
  ]);

  it("plans apply, keep, seen", () => {
    const rows = buildReviewRows(searches, books);
    expect(planApply(rows, choices)).toEqual([
      { kind: "apply", searchId: "s1", url: U2, expectedCover: cover },
      { kind: "keep", searchId: "s2" },
      { kind: "seen", searchId: "s3" },
    ]);
    expect(pickedCount(rows, choices)).toBe(1);
  });
  it("emits no action for a results row with a null choice; pickedCount is unaffected", () => {
    const rows = buildReviewRows(searches, books);
    const withNull = new Map<string, RowChoice | null>([
      ["s1", null],
      ["s2", U2],
    ]);
    expect(planApply(rows, withNull)).toEqual([
      { kind: "apply", searchId: "s2", url: U2, expectedCover: cover },
      { kind: "seen", searchId: "s3" },
    ]);
    expect(pickedCount(rows, withNull)).toBe(1);
  });
  it("is pure", () => {
    const rows = buildReviewRows(searches, books);
    const snap = structuredClone(rows);
    const a = planApply(rows, choices);
    expect(planApply(rows, choices)).toEqual(a);
    expect(rows).toEqual(snap);
    expect([...choices]).toEqual([
      ["s1", U2],
      ["s2", "keep"],
    ]);
  });
});
