import { describe, expect, it } from "vitest";
import { trigramSimilarity } from "./similarity";

describe("trigramSimilarity", () => {
  it("is 1 for equal keys and 0 when either is empty", () => {
    expect(trigramSimilarity("glass orchard", "glass orchard")).toBe(1);
    expect(trigramSimilarity("", "x")).toBe(0);
    expect(trigramSimilarity("x", "")).toBe(0);
  });
  it("scores near-misses high and unrelated titles low", () => {
    expect(trigramSimilarity("glass orchard", "glass orchards")).toBeGreaterThanOrEqual(0.8);
    expect(trigramSimilarity("glass orchard", "glass orhcard")).toBeGreaterThanOrEqual(0.5);
    expect(trigramSimilarity("glass orchard", "salt road")).toBeLessThan(0.2);
  });
  it("is symmetric", () => {
    expect(trigramSimilarity("glass orchard", "glass orhcard")).toBe(
      trigramSimilarity("glass orhcard", "glass orchard"),
    );
  });
});
