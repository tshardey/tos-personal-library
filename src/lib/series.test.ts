import { describe, expect, it } from "vitest";
import { canonicalSeries, seriesNames } from "./series";
import type { Book } from "./types";

const b = (seriesName: string | null) => ({ seriesName }) as Book;

describe("seriesNames", () => {
  it("trims, groups case-insensitively, keeps the most-used spelling and sorts", () => {
    expect(seriesNames([" Saga", "saga", "Saga", "Other", null, "  "].map(b))).toEqual(["Other", "Saga"]);
  });
});

describe("canonicalSeries", () => {
  it("reuses an existing spelling on a case-insensitive hit", () => {
    expect(canonicalSeries("SAGA", ["Saga"])).toBe("Saga");
    expect(canonicalSeries("  New One ", ["Saga"])).toBe("New One");
  });
  it("rejects blank and over-long names", () => {
    expect(canonicalSeries("   ", [])).toBeNull();
    expect(canonicalSeries("x".repeat(201), [])).toBeNull();
    expect(canonicalSeries("x".repeat(200), [])).toBe("x".repeat(200));
  });
});
