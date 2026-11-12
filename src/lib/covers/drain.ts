import { LookupError } from "../photo/lookup";
import type { ScreenOutcome } from "./cover-repo";
import { budgetUsedUp } from "./cost";
import { LEASE_MS, type CoverBudget, type CoverSearch } from "./types";

/** Why a drain stopped for the session; null when it ran out of work. */
export type CoverStop = "budget" | "misconfigured" | "billing" | "rejected" | null;

/** Gathering is polite: one book at a time, a second apart, and a minute's pause on a retryable error. */
export const GATHER_GAP_MS = 1000;
export const GATHER_PAUSE_MS = 60_000;

/** Consecutive failures (a record RPC, or the screening function unreachable) before that phase pauses. */
export const FAILURE_PAUSE_AFTER = 2;

const DEFAULT_CONCURRENCY = 2;

export interface DrainDeps {
  /** gatherCandidates + record_cover_candidates. */
  gather(s: CoverSearch): Promise<"gathered" | "nothing_found" | "skipped">;
  /** record_cover_candidates(id, []): nothing_found, free. */
  recordEmpty(searchId: string): Promise<unknown>;
  screen(searchId: string): Promise<ScreenOutcome>;
  readBudget(): Promise<CoverBudget>;
  sleep(ms: number): Promise<void>;
  now(): Date;
  onOutcome(searchId: string, outcome: string): void;
  /** True once the caller is gone (unmount, sign-out): nothing new starts. */
  cancelled?(): boolean;
}

export interface DrainOptions {
  concurrency?: number;
  gatherPaused?: boolean;
  /** Skip the screen phase: the function was unreachable on the last drains. */
  screenPaused?: boolean;
}

export interface DrainResult {
  stop: CoverStop;
  gatherPaused: boolean;
  screenPaused: boolean;
}

export function isScreenDue(s: CoverSearch, now: Date): boolean {
  if (s.status === "gathered") return s.retryAt === null || Date.parse(s.retryAt) <= now.getTime();
  if (s.status === "processing") {
    return s.claimedAt !== null && now.getTime() - Date.parse(s.claimedAt) > LEASE_MS;
  }
  return false;
}

const oldestFirst = (a: CoverSearch, b: CoverSearch) =>
  a.createdAt !== b.createdAt ? (a.createdAt < b.createdAt ? -1 : 1) : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;

const errorCode = (err: unknown): string =>
  (err as { code?: unknown } | null)?.code?.toString() ?? (err instanceof Error ? err.name : "unknown");

/** Phase 1 gathers queued searches one at a time; returns the ids now gathered and whether to pause. */
async function gatherPhase(
  queued: CoverSearch[],
  deps: DrainDeps,
): Promise<{ gathered: Set<string>; paused: boolean }> {
  const gathered = new Set<string>();
  const cancelled = () => deps.cancelled?.() === true;
  let first = true;
  let failures = 0;
  /** A record or network failure; after FAILURE_PAUSE_AFTER in a row, gathering pauses. */
  const failed = (id: string, what: string, err: unknown): boolean => {
    console.warn(what, errorCode(err));
    deps.onOutcome(id, "error");
    failures += 1;
    return failures >= FAILURE_PAUSE_AFTER;
  };
  for (const s of queued) {
    if (cancelled()) break;
    if (s.book === null) {
      deps.onOutcome(s.id, "skipped");
      continue;
    }
    if (!first) {
      await deps.sleep(GATHER_GAP_MS);
      if (cancelled()) break;
    }
    first = false;
    try {
      const outcome = await deps.gather(s);
      failures = 0;
      deps.onOutcome(s.id, outcome);
      if (outcome === "gathered") gathered.add(s.id);
    } catch (err) {
      if (err instanceof LookupError && err.retryable) return { gathered, paused: true };
      if (err instanceof LookupError) {
        // A 4xx from the source: record nothing found (free) and move on.
        try {
          await deps.recordEmpty(s.id);
          failures = 0;
          deps.onOutcome(s.id, "nothing_found");
        } catch (recordErr) {
          if (failed(s.id, "cover record failed", recordErr)) return { gathered, paused: true };
        }
        continue;
      }
      // Recording failed (network, RPC): leave it queued for the next drain.
      if (failed(s.id, "cover gather failed", err)) return { gathered, paused: true };
    }
  }
  return { gathered, paused: false };
}

export async function drainCovers(
  searches: CoverSearch[],
  deps: DrainDeps,
  opts: DrainOptions = {},
): Promise<DrainResult> {
  const concurrency = Math.max(1, opts.concurrency ?? DEFAULT_CONCURRENCY);
  const sorted = [...searches].sort(oldestFirst);

  let gatherPaused = opts.gatherPaused ?? false;
  let gathered = new Set<string>();
  if (!gatherPaused) {
    const r = await gatherPhase(
      sorted.filter((s) => s.status === "queued"),
      deps,
    );
    gathered = r.gathered;
    gatherPaused = r.paused;
  }

  const now = deps.now();
  let screenPaused = opts.screenPaused ?? false;
  const due = screenPaused ? [] : sorted.filter((s) => gathered.has(s.id) || isScreenDue(s, now));

  let stop: CoverStop = null;
  let rejectedRun = 0;
  let failureRun = 0;
  let budgetRefusals = 0;
  let budgetPending = false;
  let next = 0;
  const cancelled = () => deps.cancelled?.() === true;
  const inFlight = new Set<Promise<void>>();

  const settle = (id: string, outcome: string) => {
    deps.onOutcome(id, outcome);
    // The function unreachable (5xx, network) or the call threw: neutral for the other runs.
    if (outcome === "unavailable" || outcome === "error") {
      failureRun += 1;
      if (failureRun >= FAILURE_PAUSE_AFTER) screenPaused = true;
      return;
    }
    failureRun = 0;
    if (outcome === "rejected") {
      rejectedRun += 1;
      if (rejectedRun >= 2 && stop === null) stop = "rejected";
      return;
    }
    rejectedRun = 0;
    if ((outcome === "misconfigured" || outcome === "billing") && stop === null) stop = outcome;
    if (outcome === "budget" && !budgetPending) {
      budgetPending = true;
      budgetRefusals += 1;
    }
  };

  const start = (s: CoverSearch) => {
    const p = deps
      .screen(s.id)
      .then(
        (outcome) => settle(s.id, outcome),
        (err) => {
          console.warn("cover screen failed", errorCode(err));
          settle(s.id, "error");
        },
      )
      .finally(() => inFlight.delete(p));
    inFlight.add(p);
  };

  while (stop === null && !cancelled()) {
    while (stop === null && !cancelled() && !budgetPending && !screenPaused && inFlight.size < concurrency && next < due.length) {
      start(due[next++]);
    }
    if (inFlight.size > 0) {
      await Promise.race(inFlight);
      continue;
    }
    if (!budgetPending || cancelled()) break;
    // Every in-flight screen has settled: was the refusal real, or another reservation?
    if (budgetRefusals >= 2) {
      stop = "budget";
      break;
    }
    let usedUp = false;
    try {
      usedUp = budgetUsedUp(await deps.readBudget());
    } catch (err) {
      // Unknown counts as not used up; a second refusal stops anyway.
      console.warn("cover budget read failed", errorCode(err));
    }
    if (usedUp) {
      stop = "budget";
      break;
    }
    budgetPending = false;
  }

  await Promise.all(inFlight);
  return { stop, gatherPaused, screenPaused };
}
