import { isSeriesHandSet } from "../series";
import type { BookWithCopies } from "../types";
import type { BookCardMeta, TagJob } from "./types";

/** The household's vocabulary version: the highest addedVersion (1 when empty). */
export function vocabVersion(vocab: { addedVersion: number }[]): number {
  return vocab.reduce((m, t) => Math.max(m, t.addedVersion), 1);
}

function isNewer(a: TagJob, b: TagJob): boolean {
  if (a.createdAt !== b.createdAt) return a.createdAt > b.createdAt;
  return a.id > b.id;
}

/** Each book's newest job by createdAt (ties broken by id). */
export function newestJobByBook(jobs: TagJob[]): Map<string, TagJob> {
  const out = new Map<string, TagJob>();
  for (const j of jobs) {
    const cur = out.get(j.bookId);
    if (!cur || isNewer(j, cur)) out.set(j.bookId, j);
  }
  return out;
}

function isActive(j: TagJob | undefined): boolean {
  return j !== undefined && (j.status === "queued" || j.status === "processing");
}

/** Books a "Tag all books" run would queue (D5): on the shelf, no card, no active job, newest job not failed. Catalogue order. */
export function runEligible(
  books: BookWithCopies[],
  cards: Map<string, BookCardMeta>,
  jobs: TagJob[],
): string[] {
  const active = new Set(jobs.filter(isActive).map((j) => j.bookId));
  const newest = newestJobByBook(jobs);
  return books
    .filter((b) => b.onShelf && !cards.has(b.id) && !active.has(b.id) && newest.get(b.id)?.status !== "failed")
    .map((b) => b.id);
}

/** Books "Retag all books" would queue: runEligible's rules without "no card" (a full retag also tags untagged books). Catalogue order. */
export function retagAllEligible(books: BookWithCopies[], jobs: TagJob[]): string[] {
  const active = new Set(jobs.filter(isActive).map((j) => j.bookId));
  const newest = newestJobByBook(jobs);
  return books
    .filter((b) => b.onShelf && !active.has(b.id) && newest.get(b.id)?.status !== "failed")
    .map((b) => b.id);
}

/** Books whose card predates the current vocabulary, with no active job and whose newest job isn't failed. */
export function newTagsEligible(
  cards: Map<string, BookCardMeta>,
  version: number,
  jobs: TagJob[],
): string[] {
  const active = new Set(jobs.filter(isActive).map((j) => j.bookId));
  const newest = newestJobByBook(jobs);
  const out: string[] = [];
  for (const [bookId, card] of cards) {
    if (card.vocabVersion < version && !active.has(bookId) && newest.get(bookId)?.status !== "failed") out.push(bookId);
  }
  return out;
}

/** A newest job that failed as a series check: Find series retries it (a failed full or new_tags job waits for the book page's retag). */
function isFailedSeriesCheck(j: TagJob | undefined): boolean {
  return j !== undefined && j.status === "failed" && j.kind === "series";
}

/**
 * Books a series check would queue: carded, no series, neither series field hand-set, not yet checked,
 * no active job, and newest job not failed unless it failed as a series check. Shelf or not. Catalogue order.
 */
export function seriesEligible(
  books: BookWithCopies[],
  cards: Map<string, BookCardMeta>,
  checked: Set<string>,
  jobs: TagJob[],
): string[] {
  const active = new Set(jobs.filter(isActive).map((j) => j.bookId));
  const newest = newestJobByBook(jobs);
  return books
    .filter(
      (b) =>
        cards.has(b.id) &&
        b.seriesName === null &&
        !isSeriesHandSet(b) &&
        !checked.has(b.id) &&
        !active.has(b.id) &&
        // Retrying a failed series check is safe on cost: one series check (SERIES_PER_BOOK_ESTIMATE_MICRO) per book, and only when Confirm is pressed.
        (newest.get(b.id)?.status !== "failed" || isFailedSeriesCheck(newest.get(b.id))),
    )
    .map((b) => b.id);
}

/** How many of these books Find series would retry: their newest job is a failed series check. */
export function seriesRetryCount(bookIds: string[], jobs: TagJob[]): number {
  const newest = newestJobByBook(jobs);
  return bookIds.filter((id) => isFailedSeriesCheck(newest.get(id))).length;
}

/** Finished over total for the newest series run that still has a queued or processing job; null when none is open. */
export function seriesProgress(jobs: TagJob[]): { done: number; total: number } | null {
  const series = jobs.filter((j) => j.kind === "series" && j.runId !== null);
  const open = series.filter(isActive);
  if (open.length === 0) return null;
  const newest = open.reduce((a, b) => (isNewer(b, a) ? b : a));
  return runProgress(series, newest.runId);
}

/** Finished (done or failed) over total for a run's jobs; null when there is no run or no jobs. */
export function runProgress(jobs: TagJob[], runId: string | null): { done: number; total: number } | null {
  if (!runId) return null;
  const mine = jobs.filter((j) => j.runId === runId);
  if (mine.length === 0) return null;
  return { done: mine.filter((j) => j.status === "done" || j.status === "failed").length, total: mine.length };
}
