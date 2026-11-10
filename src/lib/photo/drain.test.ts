import { describe, expect, it, vi } from "vitest";
import { drainIntake, isDue } from "./drain";
import { LEASE_MS, type IntakeItem } from "./types";
import type { ProcessOutcome } from "./intake-repo";

const NOW = new Date("2026-01-10T12:00:00Z");
const item = (id: string, over: Partial<IntakeItem> = {}): IntakeItem => ({
  id,
  householdId: "h",
  uploadedBy: null,
  batchId: "b",
  ownerUserId: null,
  coverPath: "p",
  titlePagePath: null,
  sourceHash: id,
  source: "photo",
  scannedIsbn: null,
  editionLabel: null,
  extraCopy: false,
  discardReason: null,
  status: "pending",
  attempts: 0,
  claimedAt: null,
  retryAt: null,
  extraction: null,
  lookup: null,
  errorCode: null,
  resultBookId: null,
  createdAt: `2026-01-01T00:00:0${id.slice(-1)}Z`,
  ...over,
});
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString();
const later = (ms: number) => new Date(NOW.getTime() + ms).toISOString();

describe("isDue", () => {
  it("handles pending, processing and other statuses", () => {
    expect(isDue(item("a1"), NOW)).toBe(true);
    expect(isDue(item("a1", { retryAt: later(1000) }), NOW)).toBe(false);
    expect(isDue(item("a1", { retryAt: ago(1000) }), NOW)).toBe(true);
    expect(isDue(item("a1", { status: "processing", claimedAt: ago(6 * 60_000) }), NOW)).toBe(false);
    expect(isDue(item("a1", { status: "processing", claimedAt: ago(8 * 60_000) }), NOW)).toBe(true);
    expect(LEASE_MS).toBe(7 * 60_000);
    expect(isDue(item("a1", { status: "ready" }), NOW)).toBe(false);
  });
});

function deferred() {
  let resolve!: (o: ProcessOutcome) => void;
  const promise = new Promise<ProcessOutcome>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}
const flush = () => new Promise((r) => setTimeout(r, 0));

describe("drainIntake", () => {
  it("never has more than the concurrency in flight", async () => {
    const items = [1, 2, 3, 4, 5].map((n) => item(`i${n}`));
    let inFlight = 0;
    let max = 0;
    const process = vi.fn(async () => {
      inFlight++;
      max = Math.max(max, inFlight);
      await flush();
      inFlight--;
      return "ready" as ProcessOutcome;
    });
    const onOutcome = vi.fn();
    const stop = await drainIntake(items, { process, now: () => NOW, onOutcome });
    expect(stop).toBeNull();
    expect(process).toHaveBeenCalledTimes(5);
    expect(max).toBe(2);
    expect(onOutcome).toHaveBeenCalledTimes(5);
  });

  it("runs oldest first", async () => {
    const order: string[] = [];
    const process = vi.fn(async (id: string) => {
      order.push(id);
      return "ready" as ProcessOutcome;
    });
    await drainIntake(
      [item("i3"), item("i1"), item("i2")],
      { process, now: () => NOW, onOutcome: () => {} },
      { concurrency: 1 },
    );
    expect(order).toEqual(["i1", "i2", "i3"]);
  });

  it("stops starting on daily_cap and lets in-flight items report", async () => {
    const d = [deferred(), deferred()];
    const process = vi.fn((id: string) => d[id === "i1" ? 0 : 1].promise);
    const onOutcome = vi.fn();
    const run = drainIntake([1, 2, 3, 4].map((n) => item(`i${n}`)), { process, now: () => NOW, onOutcome });
    await flush();
    expect(process).toHaveBeenCalledTimes(2);
    d[0].resolve("daily_cap");
    await flush();
    d[1].resolve("ready");
    expect(await run).toBe("daily_cap");
    expect(process).toHaveBeenCalledTimes(2);
    expect(onOutcome).toHaveBeenCalledWith("i2", "ready");
    expect(onOutcome).toHaveBeenCalledWith("i1", "daily_cap");
  });

  it("returns misconfigured the same way", async () => {
    const process = vi.fn(async () => "misconfigured" as ProcessOutcome);
    const stop = await drainIntake(
      [item("i1"), item("i2"), item("i3")],
      { process, now: () => NOW, onOutcome: () => {} },
      { concurrency: 1 },
    );
    expect(stop).toBe("misconfigured");
    expect(process).toHaveBeenCalledTimes(1);
  });

  it("reports error for a rejection and keeps going", async () => {
    const process = vi.fn(async (id: string) => {
      if (id === "i1") throw new Error("x");
      return "ready" as ProcessOutcome;
    });
    const onOutcome = vi.fn();
    const stop = await drainIntake([item("i1"), item("i2"), item("i3")], { process, now: () => NOW, onOutcome });
    expect(stop).toBeNull();
    expect(onOutcome).toHaveBeenCalledWith("i1", "error");
    expect(onOutcome).toHaveBeenCalledWith("i3", "ready");
  });

  it("makes no calls with nothing due", async () => {
    const process = vi.fn();
    const stop = await drainIntake([item("i1", { status: "ready" })], {
      process,
      now: () => NOW,
      onOutcome: () => {},
    });
    expect(stop).toBeNull();
    expect(process).not.toHaveBeenCalled();
  });
});
