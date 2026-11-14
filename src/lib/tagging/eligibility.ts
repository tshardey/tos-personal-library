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

/** Finished (done or failed) over total for a run's jobs; null when there is no run or no jobs. */
export function runProgress(jobs: TagJob[], runId: string | null): { done: number; total: number } | null {
  if (!runId) return null;
  const mine = jobs.filter((j) => j.runId === runId);
  if (mine.length === 0) return null;
  return { done: mine.filter((j) => j.status === "done" || j.status === "failed").length, total: mine.length };
}
