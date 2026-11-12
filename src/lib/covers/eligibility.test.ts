import { describe, expect, it } from "vitest";
import { applyCoverFilter, batchSelection, hasStockCover, latestByBook } from "./eligibility";
import { mkBook, mkSearch } from "./fixtures.test-util";
import type { CoverMark } from "./types";

const copy = { id: "c1", bookId: "x", photoPath: "p/1.jpg" } as never;

describe("eligibility", () => {
  it("hasStockCover ignores blank urls", () => {
    expect(hasStockCover(mkBook("a", { coverUrl: "  " }))).toBe(false);
    expect(hasStockCover(mkBook("a", { coverUrl: null }))).toBe(false);
    expect(hasStockCover(mkBook("a"))).toBe(true);
  });

  it("latestByBook keeps the newest per book, then id", () => {
    const m = latestByBook([
      mkSearch("s1", "a", "ready", { createdAt: "2026-11-01T00:00:00Z" }),
      mkSearch("s2", "a", "ready", { createdAt: "2026-11-02T00:00:00Z" }),
      mkSearch("s3", "b", "ready", { createdAt: "2026-11-01T00:00:00Z" }),
      mkSearch("s4", "b", "ready", { createdAt: "2026-11-01T00:00:00Z" }),
    ]);
    expect(m.get("a")?.id).toBe("s2");
    expect(m.get("b")?.id).toBe("s4");
  });

  const books = [
    mkBook("photo", { coverUrl: null, copies: [copy] }),
    mkBook("blank", { coverUrl: "  " }),
    mkBook("covered"),
    mkBook("nf"),
    mkBook("fail"),
    mkBook("open"),
  ];
  const latest = latestByBook([
    mkSearch("s1", "nf", "nothing_found"),
    mkSearch("s2", "fail", "failed"),
    mkSearch("s3", "open", "ready"),
  ]);
  const ids = (b: { id: string }[]) => b.map((x) => x.id);

  it("no_cover includes photo-only and blank, excludes covered", () => {
    expect(ids(applyCoverFilter(books, "no_cover", new Map(), latest))).toEqual(["photo", "blank"]);
  });
  it("marked returns exactly marked books", () => {
    const marks = new Map<string, CoverMark>([
      ["covered", { bookId: "covered", reasons: [], note: null, markedBy: null, markedAt: "x" }],
    ]);
    expect(ids(applyCoverFilter(books, "marked", marks, latest))).toEqual(["covered"]);
  });
  it("nothing_found returns nothing_found/failed only", () => {
    expect(ids(applyCoverFilter(books, "nothing_found", new Map(), latest))).toEqual(["nf", "fail"]);
  });
  it("all returns everything", () => {
    expect(applyCoverFilter(books, "all", new Map(), latest)).toHaveLength(6);
  });

  it("batchSelection splits eligible, open, nothing found", () => {
    const sel = batchSelection(books, latest);
    expect(sel.eligible).toEqual(["photo", "blank", "covered"]);
    expect(sel.alreadyOpen).toBe(1);
    expect(sel.nothingFound).toBe(2);
  });
});
