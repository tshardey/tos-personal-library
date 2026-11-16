import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { useMediaQuery } from "./useMediaQuery";

const original = window.matchMedia;
afterEach(() => {
  window.matchMedia = original;
});

function stub(matches: boolean) {
  const listeners = new Set<() => void>();
  const mql = {
    matches,
    addEventListener: (_: string, l: () => void) => listeners.add(l),
    removeEventListener: (_: string, l: () => void) => listeners.delete(l),
  };
  window.matchMedia = (() => mql) as unknown as typeof window.matchMedia;
  return {
    set(v: boolean) {
      mql.matches = v;
      listeners.forEach((l) => l());
    },
  };
}

describe("useMediaQuery", () => {
  it("is false with no matchMedia", () => {
    // @ts-expect-error simulate absence
    window.matchMedia = undefined;
    const { result } = renderHook(() => useMediaQuery("(min-width: 640px)"));
    expect(result.current).toBe(false);
  });

  it("is true when the query matches", () => {
    stub(true);
    const { result } = renderHook(() => useMediaQuery("(min-width: 640px)"));
    expect(result.current).toBe(true);
  });

  it("updates on change", () => {
    const s = stub(false);
    const { result } = renderHook(() => useMediaQuery("(min-width: 640px)"));
    expect(result.current).toBe(false);
    act(() => s.set(true));
    expect(result.current).toBe(true);
  });
});
