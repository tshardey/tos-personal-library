import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_VIEW,
  resetLibraryView,
  saveScrollAnchor,
  takeScrollAnchor,
  useLibraryView,
} from "./library-view";

describe("useLibraryView", () => {
  it("keeps a patch across unmounting and remounting", () => {
    const first = renderHook(() => useLibraryView("h1"));
    act(() => first.result.current[1]({ query: "Folio", deluxe: true }));
    expect(first.result.current[0]).toMatchObject({ query: "Folio", deluxe: true });
    first.unmount();

    const second = renderHook(() => useLibraryView("h1"));
    expect(second.result.current[0]).toEqual({ ...DEFAULT_VIEW, query: "Folio", deluxe: true });
  });

  it("merges successive patches", () => {
    const { result } = renderHook(() => useLibraryView("h1"));
    act(() => result.current[1]({ query: "Folio" }));
    act(() => result.current[1]({ signed: true }));
    expect(result.current[0]).toMatchObject({ query: "Folio", signed: true });
  });

  it("resets when the household id differs from the one it last held", () => {
    const first = renderHook(() => useLibraryView("h1"));
    act(() => first.result.current[1]({ query: "Folio" }));
    first.unmount();

    const other = renderHook(() => useLibraryView("h2"));
    expect(other.result.current[0]).toEqual(DEFAULT_VIEW);
    other.unmount();

    const back = renderHook(() => useLibraryView("h1"));
    expect(back.result.current[0]).toEqual(DEFAULT_VIEW);
  });

  it("resets on a household change while mounted", () => {
    const { result, rerender } = renderHook(({ id }) => useLibraryView(id), { initialProps: { id: "h1" } });
    act(() => result.current[1]({ query: "Folio" }));
    rerender({ id: "h2" });
    expect(result.current[0]).toEqual(DEFAULT_VIEW);
  });

  it("resetLibraryView resets it", () => {
    const { result } = renderHook(() => useLibraryView("h1"));
    act(() => result.current[1]({ query: "Folio", unhauled: true }));
    act(() => resetLibraryView());
    expect(result.current[0]).toEqual(DEFAULT_VIEW);
  });
});

describe("scroll anchor", () => {
  it("takeScrollAnchor returns the anchor once, then null", () => {
    const anchor = { bookId: "b1", top: 120, scrollY: 900, viewKey: "k" };
    saveScrollAnchor(anchor);
    expect(takeScrollAnchor()).toEqual(anchor);
    expect(takeScrollAnchor()).toBeNull();
  });

  it("resetLibraryView drops a saved anchor", () => {
    saveScrollAnchor({ bookId: "b1", top: 0, scrollY: 0, viewKey: "k" });
    resetLibraryView();
    expect(takeScrollAnchor()).toBeNull();
  });
});

describe("ask results in the view", () => {
  const done = {
    prompt: "cozy",
    status: "done" as const,
    response: { outcome: "ok" as const, answerable: true, note: null, matches: [] },
  };

  it("keeps ask on an ask-only patch, clears it on any other, and survives remount", () => {
    resetLibraryView();
    const first = renderHook(() => useLibraryView("h1"));
    act(() => first.result.current[1]({ ask: { prompt: "cozy", status: "asking", response: null } }));
    act(() => first.result.current[1]({ ask: done }));
    expect(first.result.current[0].ask).toEqual(done);
    first.unmount();
    const second = renderHook(() => useLibraryView("h1"));
    expect(second.result.current[0].ask).toEqual(done);
    act(() => second.result.current[1]({ owner: "shared" }));
    expect(second.result.current[0].ask).toBeNull();
    expect(second.result.current[0].libraryTags).toEqual([]);
  });
});
