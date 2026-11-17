import { describe, expect, it } from "vitest";
import { COVER_SIZES, COVER_STEPS, DEFAULT_COVER_SIZE } from "./cover-size";

describe("cover size steps", () => {
  it("step 4 is the default and matches today's grid", () => {
    expect(DEFAULT_COVER_SIZE).toBe("4");
    expect(COVER_STEPS["4"]).toEqual({ phoneCols: 2, minPx: 170, gapPx: 12, showText: true });
  });

  it("step 1 hides the text", () => {
    expect(COVER_STEPS["1"].showText).toBe(false);
  });

  it("has five steps, larger steps have fewer phone columns", () => {
    expect(COVER_SIZES).toEqual(["1", "2", "3", "4", "5"]);
    expect(COVER_SIZES.map((s) => COVER_STEPS[s].phoneCols)).toEqual([5, 4, 3, 2, 1]);
    expect(COVER_SIZES.map((s) => COVER_STEPS[s].minPx)).toEqual([64, 88, 120, 170, 240]);
    expect(COVER_SIZES.map((s) => COVER_STEPS[s].gapPx)).toEqual([8, 8, 12, 12, 16]);
  });
});
