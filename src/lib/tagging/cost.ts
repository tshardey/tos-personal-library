import { remainingMicro } from "../covers/cost";
import type { AiBudget } from "./types";

// Measured on Sonnet 5.5, mean × 1.5 (Plan 7 Task 2).
export const TAG_PER_BOOK_ESTIMATE_MICRO = 4300;
// Measured on Sonnet 5.5, mean × 1.5 (Plan 7 Task 2).
export const NEW_TAGS_PER_BOOK_ESTIMATE_MICRO = 3600;

/** How many books the remaining budget covers. Each claim needs the per-call reserve free, so the last book still needs `reserveMicro` left: 0 below the reserve, else floor((remaining - reserve) / perBook) + 1. */
export function booksCoveredBy(b: AiBudget, perBook: number): number {
  const remaining = remainingMicro(b);
  if (remaining < b.reserveMicro) return 0;
  return Math.floor((remaining - b.reserveMicro) / perBook) + 1;
}
