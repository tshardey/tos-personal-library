import { LEASE_MS, type IntakeItem } from "./types";
import type { ProcessOutcome } from "./intake-repo";

/** Pending and past any backoff, or processing with an expired lease. */
export function isDue(item: IntakeItem, now: Date): boolean {
  if (item.status === "pending") return item.retryAt === null || new Date(item.retryAt).getTime() <= now.getTime();
  if (item.status === "processing") {
    return item.claimedAt !== null && now.getTime() - new Date(item.claimedAt).getTime() > LEASE_MS;
  }
  return false;
}

export type DrainStop = "daily_cap" | "misconfigured" | null;

/** Runs due items, oldest first. Stops starting new ones on daily_cap or misconfigured. */
export async function drainIntake(
  items: IntakeItem[],
  deps: {
    process: (itemId: string) => Promise<ProcessOutcome>;
    now(): Date;
    onOutcome(itemId: string, outcome: ProcessOutcome | "error"): void;
  },
  opts: { concurrency?: number } = {},
): Promise<DrainStop> {
  const queue = items
    .filter((i) => isDue(i, deps.now()))
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  let stop: DrainStop = null;
  let next = 0;
  async function worker(): Promise<void> {
    while (stop === null && next < queue.length) {
      const { id } = queue[next++];
      let outcome: ProcessOutcome | "error";
      try {
        outcome = await deps.process(id);
      } catch {
        outcome = "error";
      }
      deps.onOutcome(id, outcome);
      if ((outcome === "daily_cap" || outcome === "misconfigured") && stop === null) stop = outcome;
    }
  }
  const n = Math.max(1, Math.min(opts.concurrency ?? 2, queue.length));
  await Promise.all(Array.from({ length: n }, worker));
  return stop;
}
