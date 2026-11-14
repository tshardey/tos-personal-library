import { describe, expect, it, vi } from "vitest";
import { drainTagging, isJobDue, type TagDrainDeps } from "./drain";
import type { AiBudget, TagJob, TagJobOutcome } from "./types";

const NOW = new Date("2026-11-12T12:00:00Z");
const minutesAgo = (m: number) =>
  new Date(NOW.getTime() - m * 60_000).toISOString();

const USED_UP: AiBudget = {
  month: "2026-11-01",
  spentMicro: 4_999_000,
  budgetMicro: 5_000_000,
  reserveMicro: 4300,
  globalSpentMicro: 4_999_000,
  globalBudgetMicro: 5_000_000,
};
const LEFT: AiBudget = {
  ...USED_UP,
  spentMicro: 100_000,
  globalSpentMicro: 100_000,
};

function job(
  n: number,
  status: TagJob["status"] = "queued",
  over: Partial<TagJob> = {},
): TagJob {
  return {
    id: `j${n}`,
    bookId: `book${n}`,
    runId: null,
    kind: "full",
    reason: "manual",
    status,
    attempts: 0,
    claimedAt: null,
    retryAt: null,
    errorCode: null,
    createdAt: `2026-11-01T00:00:0${n}Z`,
    ...over,
  };
}

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

function fakeDeps(over: Partial<TagDrainDeps> = {}) {
  return {
    run: vi.fn<TagDrainDeps["run"]>(async () => "done"),
    readBudget: vi.fn<TagDrainDeps["readBudget"]>(async () => LEFT),
    now: () => NOW,
    onOutcome: vi.fn<TagDrainDeps["onOutcome"]>(),
    ...over,
  };
}

const ran = (d: { run: unknown }) =>
  (d.run as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0]);
const jobs = (n: number) => Array.from({ length: n }, (_, i) => job(i + 1));

describe("isJobDue", () => {
  it("is due when queued with no retry, or a retry in the past", () => {
    expect(isJobDue(job(1), NOW)).toBe(true);
    expect(isJobDue(job(1, "queued", { retryAt: minutesAgo(1) }), NOW)).toBe(
      true,
    );
    expect(isJobDue(job(1, "queued", { retryAt: minutesAgo(-1) }), NOW)).toBe(
      false,
    );
  });
  it("is due when processing for more than 7 minutes only", () => {
    expect(
      isJobDue(job(1, "processing", { claimedAt: minutesAgo(8) }), NOW),
    ).toBe(true);
    expect(
      isJobDue(job(1, "processing", { claimedAt: minutesAgo(6) }), NOW),
    ).toBe(false);
  });
  it("is never due when done or failed", () => {
    expect(isJobDue(job(1, "done"), NOW)).toBe(false);
    expect(isJobDue(job(1, "failed"), NOW)).toBe(false);
  });
});

describe("drainTagging", () => {
  it("runs only due jobs, oldest first", async () => {
    const deps = fakeDeps();
    const rows = [
      job(3),
      job(1),
      job(2, "done"),
      job(4, "queued", { retryAt: minutesAgo(-5) }),
    ];
    expect(await drainTagging(rows, deps, { concurrency: 1 })).toEqual({
      stop: null,
      paused: false,
    });
    expect(ran(deps)).toEqual(["j1", "j3"]);
  });

  it("never has more than 2 in flight", async () => {
    let live = 0;
    let peak = 0;
    const deps = fakeDeps({
      run: vi.fn(async () => {
        live += 1;
        peak = Math.max(peak, live);
        await Promise.resolve();
        live -= 1;
        return "done" as const;
      }),
    });
    await drainTagging(jobs(6), deps);
    expect(deps.run).toHaveBeenCalledTimes(6);
    expect(peak).toBe(2);
  });

  it.each(["billing", "misconfigured"] as const)(
    "stops on %s and starts nothing more",
    async (outcome) => {
      const deps = fakeDeps({ run: vi.fn(async () => outcome) });
      const out = await drainTagging(jobs(5), deps, { concurrency: 1 });
      expect(out.stop).toBe(outcome);
      expect(deps.run).toHaveBeenCalledTimes(1);
    },
  );

  it("stops on two rejected in a row, not on rejected broken by another outcome", async () => {
    const queue: TagJobOutcome[] = [
      "rejected",
      "done",
      "rejected",
      "failed",
      "rejected",
      "rejected",
    ];
    const deps = fakeDeps({ run: vi.fn(async () => queue.shift()!) });
    const out = await drainTagging(jobs(8), deps, { concurrency: 1 });
    expect(out.stop).toBe("rejected");
    expect(deps.run).toHaveBeenCalledTimes(6);
  });

  it("busy, a done between, and a retry_later are neutral; a thrown call counts as unreachable", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const queue = ["retry_later", "busy", "done", "throw", "done"];
    const deps = fakeDeps({
      run: vi.fn(async () => {
        const n = queue.shift()!;
        if (n === "throw") throw new Error("network");
        return n as TagJobOutcome;
      }),
    });
    const out = await drainTagging(jobs(5), deps, { concurrency: 1 });
    expect(out).toEqual({ stop: null, paused: false });
    expect(deps.run).toHaveBeenCalledTimes(5);
    expect(deps.onOutcome).toHaveBeenCalledWith("j4", "error");
    warn.mockRestore();
  });

  it("rejected, retry_later, rejected still stops: an unreachable call does not reset the rejected run", async () => {
    const queue: TagJobOutcome[] = [
      "rejected",
      "retry_later",
      "rejected",
      "done",
    ];
    const deps = fakeDeps({ run: vi.fn(async () => queue.shift()!) });
    const out = await drainTagging(jobs(5), deps, { concurrency: 1 });
    expect(out.stop).toBe("rejected");
    expect(deps.run).toHaveBeenCalledTimes(3);
  });

  it("a retry_later job is not run again within the same drain", async () => {
    const deps = fakeDeps({ run: vi.fn(async () => "retry_later" as const) });
    await drainTagging([job(1)], deps);
    expect(ran(deps)).toEqual(["j1"]);
  });

  it("two unreachable outcomes in a row pause: no further starts, and the pause is reported", async () => {
    const deps = fakeDeps({ run: vi.fn(async () => "retry_later" as const) });
    const out = await drainTagging(jobs(6), deps, { concurrency: 1 });
    expect(out).toEqual({ stop: null, paused: true });
    expect(deps.run).toHaveBeenCalledTimes(2);
  });

  it("two thrown calls pause too, and a success in between resets the count", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const boom = fakeDeps({
      run: vi.fn(async () => {
        throw new Error("network");
      }),
    });
    expect((await drainTagging(jobs(6), boom, { concurrency: 1 })).paused).toBe(
      true,
    );
    expect(boom.run).toHaveBeenCalledTimes(2);
    const queue: TagJobOutcome[] = [
      "retry_later",
      "done",
      "retry_later",
      "done",
    ];
    const mixed = fakeDeps({ run: vi.fn(async () => queue.shift()!) });
    expect(
      (await drainTagging(jobs(4), mixed, { concurrency: 1 })).paused,
    ).toBe(false);
    expect(mixed.run).toHaveBeenCalledTimes(4);
    warn.mockRestore();
  });

  it("a paused drain starts nothing and echoes the pause", async () => {
    const deps = fakeDeps();
    expect(await drainTagging(jobs(3), deps, { paused: true })).toEqual({
      stop: null,
      paused: true,
    });
    expect(deps.run).not.toHaveBeenCalled();
  });

  it("budget waits for in-flight work, re-reads, and stops only when used up", async () => {
    const slow = deferred<TagJobOutcome>();
    const deps = fakeDeps({
      run: vi.fn(async (id: string) =>
        id === "j1" ? "budget" : id === "j2" ? slow.promise : "done",
      ),
      readBudget: vi.fn(async () => USED_UP),
    });
    const p = drainTagging(jobs(4), deps);
    await Promise.resolve();
    await Promise.resolve();
    expect(deps.readBudget).not.toHaveBeenCalled();
    slow.resolve("done");
    expect(await p).toEqual({ stop: "budget", paused: false });
    expect(deps.readBudget).toHaveBeenCalledTimes(1);
    expect(ran(deps)).toEqual(["j1", "j2"]);
  });

  it("budget with money left (another reservation) carries on", async () => {
    let first = true;
    const deps = fakeDeps({
      run: vi.fn(async () => {
        if (first) {
          first = false;
          return "budget" as const;
        }
        return "done" as const;
      }),
      readBudget: vi.fn(async () => LEFT),
    });
    const out = await drainTagging(jobs(3), deps, { concurrency: 1 });
    expect(out.stop).toBeNull();
    expect(deps.run).toHaveBeenCalledTimes(3);
  });

  it("a second budget refusal stops without trusting the re-read", async () => {
    const deps = fakeDeps({
      run: vi.fn(async () => "budget" as const),
      readBudget: vi.fn(async () => LEFT),
    });
    const out = await drainTagging(jobs(6), deps, { concurrency: 1 });
    expect(out.stop).toBe("budget");
    expect(deps.run).toHaveBeenCalledTimes(2);
  });

  it("two drains over the same jobs: each runs each job at most once, the busy one charges nothing", async () => {
    const rows = jobs(4);
    const first = fakeDeps();
    const second = fakeDeps({ run: vi.fn(async () => "busy" as const) });
    const [a, b] = await Promise.all([
      drainTagging(rows, first),
      drainTagging(rows, second),
    ]);
    expect(a.stop).toBeNull();
    expect(b.stop).toBeNull();
    expect(ran(first).sort()).toEqual(["j1", "j2", "j3", "j4"]);
    expect(ran(second).sort()).toEqual(["j1", "j2", "j3", "j4"]);
  });

  it("nothing starts once cancelled", async () => {
    const deps = fakeDeps({ cancelled: () => true });
    expect(await drainTagging(jobs(3), deps)).toEqual({
      stop: null,
      paused: false,
    });
    expect(deps.run).not.toHaveBeenCalled();
  });
});
