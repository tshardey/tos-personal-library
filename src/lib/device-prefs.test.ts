import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readPref, useDevicePref, writePref } from "./device-prefs";

beforeEach(() => localStorage.clear());
afterEach(() => vi.restoreAllMocks());

const blockRead = () =>
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
    throw new Error("blocked");
  });
const blockWrite = () =>
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new Error("blocked");
  });

describe("readPref", () => {
  it("returns an allowed stored value", () => {
    localStorage.setItem("k", "b");
    expect(readPref("k", ["a", "b"], "a")).toBe("b");
  });
  it("falls back for unknown, missing and throwing storage", () => {
    localStorage.setItem("k", "z");
    expect(readPref("k", ["a", "b"], "a")).toBe("a");
    localStorage.removeItem("k");
    expect(readPref("k", ["a", "b"], "a")).toBe("a");
    blockRead();
    expect(readPref("k", ["a", "b"], "a")).toBe("a");
  });
});

describe("writePref", () => {
  it("ignores a throwing setItem", () => {
    blockWrite();
    expect(() => writePref("k", "b")).not.toThrow();
  });
});

describe("useDevicePref", () => {
  it("setter updates state even when the write throws", () => {
    blockWrite();
    const { result } = renderHook(() => useDevicePref("k", ["a", "b"], "a"));
    expect(result.current[0]).toBe("a");
    act(() => result.current[1]("b"));
    expect(result.current[0]).toBe("b");
  });
});
