import { budgetUsedUp } from "../covers/cost";
import { LEASE_MS } from "../covers/types";
import type { AiBudget, TagJob, TagJobOutcome } from "./types";

/** Why a drain stopped for the session; null when it ran out of work. */
export type TagStop =
  "budget" | "misconfigured" | "billing" | "rejected" | null;

const DEFAULT_CONCURRENCY = 2;

export interface TagDrainDeps {
  run(jobId: string): Promise<TagJobOutcome>;
  readBudget(): Promise<AiBudget>;
  now(): Date;
  onOutcome(jobId: string, outcome: TagJobOutcome): void;
  /** True once the caller is gone (unmount, sign-out): nothing new starts. */
  cancelled?(): boolean;
}

/** Queued with no retry time (or one that has passed), or processing past the lease. */
export function isJobDue(j: TagJob, now: Date): boolean {
  if (j.status === "queued")
    return j.retryAt === null || Date.parse(j.retryAt) <= now.getTime();
  if (j.status === "processing")
    return (
      j.claimedAt !== null && now.getTime() - Date.parse(j.claimedAt) > LEASE_MS
    );
  return false;
}

const oldestFirst = (a: TagJob, b: TagJob) =>
  a.createdAt !== b.createdAt
    ? a.createdAt < b.createdAt
      ? -1
      : 1
    : a.id < b.id
      ? -1
      : a.id > b.id
        ? 1
        : 0;

const errorCode = (err: unknown): string =>
  (err as { code?: unknown } | null)?.code?.toString() ??
  (err instanceof Error ? err.name : "unknown");

/**
 * Runs the due jobs, at most `concurrency` at a time and each job at most once per call, so no loop can
 * keep billing. Stops on billing, misconfigured, two rejected in a row, and on budget only after the
 * in-flight jobs settle and the re-read budget is used up (or a second refusal arrives).
 */
export async function drainTagging(
  jobs: TagJob[],
  deps: TagDrainDeps,
  opts: { concurrency?: number } = {},
): Promise<{ stop: TagStop }> {
  const concurrency = Math.max(1, opts.concurrency ?? DEFAULT_CONCURRENCY);
  const now = deps.now();
  const due = jobs.filter((j) => isJobDue(j, now)).sort(oldestFirst);

  let stop: TagStop = null;
  let rejectedRun = 0;
  let budgetRefusals = 0;
  let budgetPending = false;
  let next = 0;
  const cancelled = () => deps.cancelled?.() === true;
  const inFlight = new Set<Promise<void>>();

  const settle = (id: string, outcome: TagJobOutcome) => {
    deps.onOutcome(id, outcome);
    // Unreachable, lost the claim race, or threw: neutral for the other runs.
    if (outcome === "retry_later" || outcome === "busy" || outcome === "error")
      return;
    if (outcome === "rejected") {
      rejectedRun += 1;
      if (rejectedRun >= 2 && stop === null) stop = "rejected";
      return;
    }
    rejectedRun = 0;
    if ((outcome === "misconfigured" || outcome === "billing") && stop === null)
      stop = outcome;
    if (outcome === "budget" && !budgetPending) {
      budgetPending = true;
      budgetRefusals += 1;
    }
  };

  const start = (j: TagJob) => {
    const p = deps
      .run(j.id)
      .then(
        (outcome) => settle(j.id, outcome),
        (err) => {
          console.warn("tag job failed", errorCode(err));
          settle(j.id, "error");
        },
      )
      .finally(() => inFlight.delete(p));
    inFlight.add(p);
  };

  while (stop === null && !cancelled()) {
    while (
      stop === null &&
      !cancelled() &&
      !budgetPending &&
      inFlight.size < concurrency &&
      next < due.length
    ) {
      start(due[next++]);
    }
    if (inFlight.size > 0) {
      await Promise.race(inFlight);
      continue;
    }
    if (!budgetPending || cancelled()) break;
    // Every in-flight job has settled: was the refusal real, or another reservation?
    if (budgetRefusals >= 2) {
      stop = "budget";
      break;
    }
    let usedUp = false;
    try {
      usedUp = budgetUsedUp(await deps.readBudget());
    } catch (err) {
      console.warn("tag budget read failed", errorCode(err));
    }
    if (usedUp) {
      stop = "budget";
      break;
    }
    budgetPending = false;
  }

  await Promise.all(inFlight);
  return { stop };
}
