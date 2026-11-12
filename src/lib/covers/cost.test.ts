import { describe, expect, it } from "vitest";
import { booksCovered, budgetUsedUp, estimateMicro, formatUsd, remainingMicro } from "./cost";
import type { CoverBudget } from "./types";

const base: CoverBudget = {
  month: "2026-11-01",
  spentMicro: 4_990_000,
  budgetMicro: 5_000_000,
  reserveMicro: 4300,
  globalSpentMicro: 4_990_000,
  globalBudgetMicro: 5_000_000,
};

describe("cost", () => {
  it("estimateMicro", () => expect(estimateMicro(30)).toBe(30000));
  it("formatUsd", () => {
    expect(formatUsd(30000)).toBe("$0.03");
    expect(formatUsd(5)).toBe("under $0.01");
    expect(formatUsd(0)).toBe("$0.00");
  });
  it("booksCovered near limit", () => {
    expect(remainingMicro(base)).toBe(10_000);
    expect(booksCovered(base)).toBe(10);
    expect(budgetUsedUp(base)).toBe(false);
  });
  it("used up below the reserve", () => {
    const b = { ...base, spentMicro: 4_996_000, globalSpentMicro: 4_996_000 };
    expect(booksCovered(b)).toBe(0);
    expect(budgetUsedUp(b)).toBe(true);
  });
  it("project-wide ceiling applies", () => {
    const b = { ...base, spentMicro: 0, globalSpentMicro: 4_996_000 };
    expect(booksCovered(b)).toBe(0);
    expect(budgetUsedUp(b)).toBe(true);
  });
  it("never negative", () => {
    expect(remainingMicro({ ...base, spentMicro: 6_000_000 })).toBe(0);
  });
});
