import { describe, expect, it } from "vitest";
import { formatDay } from "./format-day";

describe("formatDay", () => {
  it("writes the day in words", () => {
    expect(formatDay("2026-03-02")).toBe("2 Mar 2026");
    expect(formatDay("2026-12-31")).toBe("31 Dec 2026");
  });
});
