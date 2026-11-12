import type { CoverBudget } from "./types";

/** Replaced by Task 10's measurement. */
export const PER_BOOK_ESTIMATE_MICRO = 1000;

export function estimateMicro(n: number): number {
  return n * PER_BOOK_ESTIMATE_MICRO;
}

export function remainingMicro(b: CoverBudget): number {
  return Math.max(0, Math.min(b.budgetMicro - b.spentMicro, b.globalBudgetMicro - b.globalSpentMicro));
}

export function budgetUsedUp(b: CoverBudget): boolean {
  return remainingMicro(b) < b.reserveMicro;
}

export function booksCovered(b: CoverBudget): number {
  if (budgetUsedUp(b)) return 0;
  return Math.floor(remainingMicro(b) / PER_BOOK_ESTIMATE_MICRO);
}

export function formatUsd(micro: number): string {
  if (micro <= 0) return "$0.00";
  if (micro < 10_000) return "under $0.01";
  return "$" + (micro / 1e6).toFixed(2);
}
