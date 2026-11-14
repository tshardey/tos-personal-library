import { remainingMicro } from "../covers/cost";
import type { AiBudget } from "./types";

// Measured on Sonnet 5.5, mean × 1.5 (Plan 7 Task 2).
export const TAG_PER_BOOK_ESTIMATE_MICRO = 4300;
// Measured on Sonnet 5.5, mean × 1.5 (Plan 7 Task 2).
export const NEW_TAGS_PER_BOOK_ESTIMATE_MICRO = 3600;

/** How many books the remaining budget covers; 0 once it is below the per-call reserve. */
export function booksCoveredBy(b: AiBudget, perBook: number): number {
  const remaining = remainingMicro(b);
  if (remaining < b.reserveMicro) return 0;
  return Math.floor(remaining / perBook);
}
