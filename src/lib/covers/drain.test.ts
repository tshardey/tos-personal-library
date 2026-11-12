import { describe, expect, it, vi } from "vitest";
import { LookupError } from "../photo/lookup";
import type { ScreenOutcome } from "./cover-repo";
import { drainCovers, GATHER_GAP_MS, isScreenDue, type DrainDeps } from "./drain";
import { mkSearch } from "./fixtures.test-util";
import type { CoverBudget, CoverSearch, CoverSearchBook, CoverSearchStatus } from "./types";

const NOW = new Date("2026-11-12T12:00:00Z");
const minutesAgo = (m: number) => new Date(NOW.getTime() - m * 60_000).toISOString();
const BOOK: CoverSearchBook = { title: "The Salt Road", authors: ["Member A"], isbn13: [], isbn10: [], coverUrl: null };

const USED_UP: CoverBudget = {
  month: "2026-11-01",
  spentMicro: 4_999_000,
  budgetMicro: 5_000_000,
  reserveMicro: 4300,
  globalSpentMicro: 4_999_000,
  globalBudgetMicro: 5_000_000,
};
const LEFT: CoverBudget = { ...USED_UP, spentMicro: 100_000, globalSpentMicro: 100_000 };

function row(n: number, status: CoverSearchStatus, over: Partial<CoverSearch> = {}): CoverSearch {
  return mkSearch(`s${n}`, `book${n}`, status, {
    createdAt: `2026-11-01T00:00:0${n}Z`,
    book: BOOK,
    requestedBy: "member-a",
    ...over,
  });
}

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

function baseDeps() {
  return {
    gather: vi.fn<DrainDeps["gather"]>(async () => "gathered"),
    recordEmpty: vi.fn<DrainDeps["recordEmpty"]>(async () => "nothing_found"),
    screen: vi.fn<DrainDeps["screen"]>(async () => "ready"),
    readBudget: vi.fn<DrainDeps["readBudget"]>(async () => LEFT),
    sleep: vi.fn<DrainDeps["sleep"]>(async () => {}),
    now: () => NOW,
    onOutcome: vi.fn<DrainDeps["onOutcome"]>(),
  };
}

type FakeDeps = ReturnType<typeof baseDeps>;

function fakeDeps(over: Partial<FakeDeps> = {}): FakeDeps {
  return { ...baseDeps(), ...over };
}

const screened = (deps: FakeDeps) => deps.screen.mock.calls.map((c) => c[0]);

describe("isScreenDue", () => {
  it("is due when gathered with no retry, or a retry in the past", () => {
    expect(isScreenDue(row(1, "gathered"), NOW)).toBe(true);
    expect(isScreenDue(row(1, "gathered", { retryAt: minutesAgo(1) }), NOW)).toBe(true);
    expect(isScreenDue(row(1, "gathered", { retryAt: minutesAgo(-1) }), NOW)).toBe(false);
  });
  it("is due when processing with an expired lease only", () => {
    expect(isScreenDue(row(1, "processing", { claimedAt: minutesAgo(8) }), NOW)).toBe(true);
    expect(isScreenDue(row(1, "processing", { claimedAt: minutesAgo(6) }), NOW)).toBe(false);
  });
  it("is never due for other statuses", () => {
    for (const s of ["queued", "ready", "nothing_found", "failed", "applied", "dismissed"] as const) {
      expect(isScreenDue(row(1, s), NOW)).toBe(false);
    }
  });
});

describe("drainCovers", () => {
  it("finishes another member's batch: gathers the queued row, screens all three", async () => {
    const rows = [
      row(1, "queued"),
      row(2, "gathered"),
      row(3, "processing", { claimedAt: minutesAgo(8) }),
      row(4, "processing", { claimedAt: minutesAgo(6) }),
    ];
    const deps = fakeDeps();
    const out = await drainCovers(rows, deps);
    expect(deps.gather.mock.calls.map((c) => c[0].id)).toEqual(["s1"]);
    expect(screened(deps).sort()).toEqual(["s1", "s2", "s3"]);
    expect(out).toEqual({ stop: null, gatherPaused: false });
  });

  it("does not screen a search whose gather found nothing", async () => {
    const deps = fakeDeps({ gather: vi.fn<DrainDeps["gather"]>(async () => "nothing_found") });
    await drainCovers([row(1, "queued")], deps);
    expect(deps.screen).not.toHaveBeenCalled();
  });

  it("budget used up mid-batch: waits for the in-flight screen, reads once, stops", async () => {
    const rows = [1, 2, 3, 4, 5].map((n) => row(n, "gathered"));
    const first = deferred<ScreenOutcome>();
    const deps = fakeDeps({
      screen: vi.fn<DrainDeps["screen"]>((id: string) => (id === "s1" ? first.promise : Promise.resolve<ScreenOutcome>(id === "s2" ? "budget" : "ready"))),
      readBudget: vi.fn<DrainDeps["readBudget"]>(async () => USED_UP),
    });
    const p = drainCovers(rows, deps);
    await new Promise((r) => setTimeout(r, 0));
    expect(screened(deps)).toEqual(["s1", "s2"]);
    expect(deps.readBudget).not.toHaveBeenCalled();
    first.resolve("ready");
    const out = await p;
    expect(deps.readBudget).toHaveBeenCalledTimes(1);
    expect(out.stop).toBe("budget");
    expect(screened(deps)).toEqual(["s1", "s2"]);
  });

  it("budget refused while budget is left: carries on, then a second refusal stops", async () => {
    const rows = [1, 2, 3, 4, 5].map((n) => row(n, "gathered"));
    const deps = fakeDeps({ screen: vi.fn<DrainDeps["screen"]>(async (id: string) => (id === "s2" ? "budget" : "ready") as ScreenOutcome) });
    const out = await drainCovers(rows, deps);
    expect(deps.readBudget).toHaveBeenCalledTimes(1);
    expect(screened(deps).sort()).toEqual(["s1", "s2", "s3", "s4", "s5"]);
    expect(out.stop).toBeNull();

    const again = fakeDeps({
      screen: vi.fn<DrainDeps["screen"]>(async (id: string) => (id === "s2" || id === "s3" ? "budget" : "ready") as ScreenOutcome),
    });
    const out2 = await drainCovers(rows, again);
    expect(out2.stop).toBe("budget");
    expect(again.readBudget.mock.calls.length).toBeLessThanOrEqual(2);
    expect(screened(again)).not.toContain("s5");
    expect(new Set(screened(again)).size).toBe(screened(again).length);
  });

  it("a non-retryable gather error records nothing found and carries on", async () => {
    const rows = [1, 2, 3].map((n) => row(n, "queued"));
    const deps = fakeDeps({
      gather: vi.fn<DrainDeps["gather"]>(async (s: CoverSearch) => {
        if (s.id === "s1") throw new LookupError("OpenLibrary answered 400", false);
        return "gathered" as const;
      }),
    });
    const out = await drainCovers(rows, deps);
    expect(deps.recordEmpty.mock.calls).toEqual([["s1"]]);
    expect(deps.gather).toHaveBeenCalledTimes(3);
    expect(out.gatherPaused).toBe(false);
    expect(screened(deps)).toEqual(["s2", "s3"]);
  });

  it.each<[ScreenOutcome[], string | null]>([
    [["billing", "ready", "ready"], "billing"],
    [["misconfigured", "ready", "ready"], "misconfigured"],
    [["rejected", "ready", "rejected"], null],
    [["rejected", "rejected", "ready"], "rejected"],
  ])("stops on the workspace outcomes %j → %s", async (outcomes, stop) => {
    const rows = [1, 2, 3].map((n) => row(n, "gathered"));
    const queue = [...outcomes];
    const deps = fakeDeps({ screen: vi.fn<DrainDeps["screen"]>(async () => queue.shift()!) });
    const out = await drainCovers(rows, deps, { concurrency: 1 });
    expect(out.stop).toBe(stop);
    if (stop === "billing" || stop === "misconfigured") expect(deps.screen).toHaveBeenCalledTimes(1);
    if (stop === "rejected") expect(deps.screen).toHaveBeenCalledTimes(2);
    if (stop === null) expect(deps.screen).toHaveBeenCalledTimes(3);
  });

  it("billing stops new starts at concurrency 2", async () => {
    const rows = [1, 2, 3, 4].map((n) => row(n, "gathered"));
    const deps = fakeDeps({ screen: vi.fn<DrainDeps["screen"]>(async (id: string) => (id === "s1" ? "billing" : "ready") as ScreenOutcome) });
    const out = await drainCovers(rows, deps);
    expect(out.stop).toBe("billing");
    expect(screened(deps)).toEqual(["s1", "s2"]);
  });

  it("a screen that throws reports error and continues", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const rows = [1, 2].map((n) => row(n, "gathered"));
    const deps = fakeDeps({
      screen: vi.fn<DrainDeps["screen"]>(async (id: string) => {
        if (id === "s1") throw new Error("network");
        return "ready" as ScreenOutcome;
      }),
    });
    const out = await drainCovers(rows, deps);
    expect(out.stop).toBeNull();
    expect(deps.onOutcome).toHaveBeenCalledWith("s1", "error");
    expect(deps.onOutcome).toHaveBeenCalledWith("s2", "ready");
    expect(warn).toHaveBeenCalledWith("cover screen failed", "Error");
    warn.mockRestore();
  });

  it("never has more than 2 screens in flight", async () => {
    const rows = [1, 2, 3, 4, 5, 6].map((n) => row(n, "gathered"));
    let inFlight = 0;
    let max = 0;
    const deps = fakeDeps({
      screen: vi.fn<DrainDeps["screen"]>(async () => {
        inFlight += 1;
        max = Math.max(max, inFlight);
        await new Promise((r) => setTimeout(r, 1));
        inFlight -= 1;
        return "ready" as ScreenOutcome;
      }),
    });
    await drainCovers(rows, deps);
    expect(max).toBe(2);
    expect(deps.screen).toHaveBeenCalledTimes(6);
  });

  it("a rate limit pauses gathering; already gathered searches are still screened", async () => {
    const rows = [1, 2, 3, 4].map((n) => row(n, "queued"));
    const deps = fakeDeps({
      gather: vi.fn<DrainDeps["gather"]>(async (s: CoverSearch) => {
        if (s.id === "s2") throw new LookupError("OpenLibrary answered 429", true);
        return "gathered" as const;
      }),
    });
    const out = await drainCovers(rows, deps);
    expect(deps.gather).toHaveBeenCalledTimes(2);
    expect(deps.recordEmpty).not.toHaveBeenCalled();
    expect(out).toEqual({ stop: null, gatherPaused: true });
    expect(screened(deps)).toEqual(["s1"]);
  });

  it("paces gathers a second apart, and gathers nothing while paused", async () => {
    const rows = [1, 2, 3].map((n) => row(n, "queued"));
    const order: string[] = [];
    const deps = fakeDeps({
      gather: vi.fn<DrainDeps["gather"]>(async (s: CoverSearch) => {
        order.push(`gather ${s.id}`);
        return "gathered" as const;
      }),
      sleep: vi.fn<DrainDeps["sleep"]>(async (ms: number) => {
        order.push(`sleep ${ms}`);
      }),
    });
    await drainCovers(rows, deps);
    expect(order).toEqual(["gather s1", `sleep ${GATHER_GAP_MS}`, "gather s2", `sleep ${GATHER_GAP_MS}`, "gather s3"]);
    expect(GATHER_GAP_MS).toBe(1000);

    const paused = fakeDeps();
    const out = await drainCovers([...rows, row(4, "gathered")], paused, { gatherPaused: true });
    expect(paused.gather).not.toHaveBeenCalled();
    expect(screened(paused)).toEqual(["s4"]);
    expect(out.gatherPaused).toBe(true);
  });

  it("two drains at once screen each row at most once per caller and never throw", async () => {
    const rows = [1, 2, 3].map((n) => row(n, "gathered"));
    const a = fakeDeps();
    const b = fakeDeps({ screen: vi.fn<DrainDeps["screen"]>(async () => "busy" as ScreenOutcome) });
    const [ra, rb] = await Promise.all([drainCovers(rows, a), drainCovers(rows, b)]);
    expect(ra.stop).toBeNull();
    expect(rb.stop).toBeNull();
    for (const d of [a, b]) {
      expect(screened(d).sort()).toEqual(["s1", "s2", "s3"]);
    }
  });

  it("stops starting gathers and screens once cancelled", async () => {
    const rows = [row(1, "queued"), row(2, "queued"), row(3, "gathered")];
    let gone = false;
    const deps = fakeDeps({
      gather: vi.fn<DrainDeps["gather"]>(async () => {
        gone = true;
        return "gathered";
      }),
    });
    const out = await drainCovers(rows, { ...deps, cancelled: () => gone });
    expect(deps.gather).toHaveBeenCalledTimes(1);
    expect(deps.screen).not.toHaveBeenCalled();
    expect(out.stop).toBeNull();
  });

  it("checks the cancel after the gap sleep and before each screen", async () => {
    let gone = false;
    const deps = fakeDeps({
      sleep: vi.fn<DrainDeps["sleep"]>(async () => {
        gone = true;
      }),
    });
    await drainCovers([row(1, "queued"), row(2, "queued")], { ...deps, cancelled: () => gone });
    expect(deps.gather).toHaveBeenCalledTimes(1);
    expect(deps.screen).not.toHaveBeenCalled();

    let screens = 0;
    const two = fakeDeps({
      screen: vi.fn<DrainDeps["screen"]>(async () => {
        screens += 1;
        return "ready";
      }),
    });
    await drainCovers([1, 2, 3, 4].map((n) => row(n, "gathered")), { ...two, cancelled: () => screens >= 2 }, {
      concurrency: 1,
    });
    expect(two.screen).toHaveBeenCalledTimes(2);
  });

  it("skips a search whose book is gone", async () => {
    const deps = fakeDeps();
    await drainCovers([row(1, "queued", { book: null }), row(2, "queued")], deps);
    expect(deps.gather.mock.calls.map((c) => c[0].id)).toEqual(["s2"]);
    expect(deps.sleep).not.toHaveBeenCalled();
  });
});
