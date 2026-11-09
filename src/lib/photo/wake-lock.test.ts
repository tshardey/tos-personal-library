import { afterEach, describe, expect, it, vi } from "vitest";
import { holdWakeLock } from "./wake-lock";

const nav = navigator as unknown as { wakeLock?: unknown };
const setVisibility = (v: "visible" | "hidden") =>
  Object.defineProperty(document, "visibilityState", { value: v, configurable: true });

afterEach(() => {
  delete nav.wakeLock;
  setVisibility("visible");
});

describe("holdWakeLock", () => {
  it("works when navigator.wakeLock is undefined", () => {
    expect(() => holdWakeLock().release()).not.toThrow();
  });

  it("re-requests after becoming visible again", async () => {
    const sentinel = { release: vi.fn(async () => {}) };
    const request = vi.fn(async () => sentinel);
    nav.wakeLock = { request };
    const lock = holdWakeLock();
    await Promise.resolve();
    expect(request).toHaveBeenCalledTimes(1);
    setVisibility("visible");
    document.dispatchEvent(new Event("visibilitychange"));
    await Promise.resolve();
    expect(request).toHaveBeenCalledTimes(2);
    lock.release();
    document.dispatchEvent(new Event("visibilitychange"));
    expect(request).toHaveBeenCalledTimes(2);
    await Promise.resolve();
    expect(sentinel.release).toHaveBeenCalled();
  });

  it("swallows a rejected request", async () => {
    nav.wakeLock = { request: vi.fn(async () => Promise.reject(new Error("denied"))) };
    const lock = holdWakeLock();
    await new Promise((r) => setTimeout(r, 0));
    expect(() => lock.release()).not.toThrow();
  });
});
