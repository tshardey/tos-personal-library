import { remainingMicro } from "../covers/cost";
import type { AiBudget } from "./types";

// Measured in Plan 11 Task 6 on Sonnet 5.5, mean × 1.5 (full-job mean 4,516 × 1.5).
export const TAG_PER_BOOK_ESTIMATE_MICRO = 6800;
// Measured on Sonnet 5.5, mean × 1.5 (Plan 7 Task 2).
export const NEW_TAGS_PER_BOOK_ESTIMATE_MICRO = 3600;
// Production Find series run (2026-11-21): 3,720 per book on average, plus margin.
export const SERIES_PER_BOOK_ESTIMATE_MICRO = 5000;
// Measured in Plan 11 Task 6 on Sonnet 5.5, mean × 1.5: one searched series follow-up job.
export const SERIES_SEARCH_JOB_ESTIMATE_MICRO = 36700;
/** About 7% of production series checks searched the web (2026-11-21); assume 10% for margin. */
export const UNSURE_FOLLOWUP_RATE = 0.1;
/** A full tag plus its expected unsure follow-up; used by Tag all books and every Retag confirm. */
export const FULL_TAG_PER_BOOK_ESTIMATE_MICRO =
  TAG_PER_BOOK_ESTIMATE_MICRO + Math.ceil(UNSURE_FOLLOWUP_RATE * SERIES_SEARCH_JOB_ESTIMATE_MICRO);

/** How many books the remaining budget covers. Each claim needs the per-call reserve free, so the last book still needs `reserveMicro` left: 0 below the reserve, else floor((remaining - reserve) / perBook) + 1. */
export function booksCoveredBy(b: AiBudget, perBook: number): number {
  const remaining = remainingMicro(b);
  if (remaining < b.reserveMicro) return 0;
  return Math.floor((remaining - b.reserveMicro) / perBook) + 1;
}
