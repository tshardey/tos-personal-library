import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { saveScrollAnchor } from "@/lib/library-view";
import { RESTORE_WINDOW_MS, useRestoreScroll } from "./useRestoreScroll";

const observers: FakeResizeObserver[] = [];
class FakeResizeObserver {
  observed: Element[] = [];
  disconnected = false;
  constructor(private readonly cb: ResizeObserverCallback) {
    observers.push(this);
  }
  observe(el: Element) {
    this.observed.push(el);
  }
  unobserve() {}
  disconnect() {
    this.disconnected = true;
  }
  fire() {
    this.cb([], this as unknown as ResizeObserver);
  }
}
const resize = () => act(() => observers.forEach((o) => !o.disconnected && o.fire()));

let scrollTo: ReturnType<typeof vi.fn>;
let cardTop = 0;
let container: HTMLDivElement;
const ref = { current: null as HTMLElement | null };

/** The `top` each scrollTo call asked for. */
const tops = () =>
  scrollTo.mock.calls.map((c: unknown[]) => (typeof c[0] === "object" ? (c[0] as ScrollToOptions).top : c[1]));

beforeEach(() => {
  observers.length = 0;
  vi.stubGlobal("ResizeObserver", FakeResizeObserver);
  scrollTo = vi.fn();
  vi.stubGlobal("scrollTo", scrollTo);
  Object.defineProperty(window, "scrollY", { configurable: true, value: 500 });
  container = document.createElement("div");
  const card = document.createElement("a");
  card.setAttribute("data-book-id", "b25");
  card.getBoundingClientRect = () => ({ top: cardTop }) as DOMRect;
  container.appendChild(card);
  document.body.appendChild(container);
  ref.current = container;
  cardTop = 300;
});

afterEach(() => {
  container.remove();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("useRestoreScroll", () => {
  it("with a matching view key, scrolls by the card's current top minus the saved top", () => {
    saveScrollAnchor({ bookId: "b25", top: 120, scrollY: 4000, viewKey: "k" });
    renderHook(() => useRestoreScroll(true, "k", ref));
    // 500 (scrollY) + 300 (card top now) - 120 (card top then)
    expect(tops()).toEqual([680]);
    expect(history.scrollRestoration).toBe("manual");
  });

  it("restores the previous history.scrollRestoration on unmount", () => {
    history.scrollRestoration = "auto";
    const { unmount } = renderHook(() => useRestoreScroll(false, "k", ref));
    expect(history.scrollRestoration).toBe("manual");
    unmount();
    expect(history.scrollRestoration).toBe("auto");
  });

  it("waits for ready before taking the anchor", () => {
    saveScrollAnchor({ bookId: "b25", top: 120, scrollY: 4000, viewKey: "k" });
    const { rerender } = renderHook(({ ready }) => useRestoreScroll(ready, "k", ref), {
      initialProps: { ready: false },
    });
    expect(scrollTo).not.toHaveBeenCalled();
    rerender({ ready: true });
    expect(tops()).toEqual([680]);
  });

  it("re-applies after a resize within the window", () => {
    saveScrollAnchor({ bookId: "b25", top: 120, scrollY: 4000, viewKey: "k" });
    renderHook(() => useRestoreScroll(true, "k", ref));
    expect(observers.some((o) => o.observed.includes(container))).toBe(true);
    cardTop = 400; // something above grew by 100 px
    resize();
    expect(tops()).toEqual([680, 780]);
  });

  it("stops re-applying after the window", () => {
    vi.useFakeTimers();
    saveScrollAnchor({ bookId: "b25", top: 120, scrollY: 4000, viewKey: "k" });
    renderHook(() => useRestoreScroll(true, "k", ref));
    act(() => vi.advanceTimersByTime(RESTORE_WINDOW_MS + 1));
    resize();
    expect(tops()).toEqual([680]);
  });

  it("stops at once after a wheel event", () => {
    saveScrollAnchor({ bookId: "b25", top: 120, scrollY: 4000, viewKey: "k" });
    renderHook(() => useRestoreScroll(true, "k", ref));
    act(() => {
      window.dispatchEvent(new Event("wheel"));
    });
    resize();
    expect(tops()).toEqual([680]);
  });

  it.each(["touchstart", "pointerdown", "keydown"])("stops at once after %s", (type) => {
    saveScrollAnchor({ bookId: "b25", top: 120, scrollY: 4000, viewKey: "k" });
    renderHook(() => useRestoreScroll(true, "k", ref));
    act(() => {
      document.body.dispatchEvent(new Event(type, { bubbles: true }));
    });
    resize();
    expect(tops()).toEqual([680]);
  });

  it("with a different view key, uses the saved scrollY", () => {
    saveScrollAnchor({ bookId: "b25", top: 120, scrollY: 4000, viewKey: "k" });
    renderHook(() => useRestoreScroll(true, "other", ref));
    expect(tops()).toEqual([4000]);
  });

  it("with the anchor card missing, uses the saved scrollY", () => {
    saveScrollAnchor({ bookId: "gone", top: 120, scrollY: 4000, viewKey: "k" });
    renderHook(() => useRestoreScroll(true, "k", ref));
    expect(tops()).toEqual([4000]);
  });

  it("does nothing without an anchor", () => {
    renderHook(() => useRestoreScroll(true, "k", ref));
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it("takes the anchor once: a later mount does not scroll", () => {
    saveScrollAnchor({ bookId: "b25", top: 120, scrollY: 4000, viewKey: "k" });
    renderHook(() => useRestoreScroll(true, "k", ref)).unmount();
    renderHook(() => useRestoreScroll(true, "k", ref));
    expect(tops()).toEqual([680]);
  });
});
