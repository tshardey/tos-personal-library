import { renderHook, waitFor, act } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BookWithCopies, Copy } from "@/lib/types";

const signedPhotoUrls = vi.fn();
vi.mock("@/lib/photo/intake-repo", () => ({
  signedPhotoUrls: (p: string[]) => signedPhotoUrls(p),
}));

import { useCopyPhotoUrls } from "./useCopyPhotoUrls";

function copy(id: string, photoPath: string | null, createdAt: string): Copy {
  return {
    id,
    bookId: "x",
    ownerUserId: null,
    editionNote: null,
    location: null,
    photoPath,
    createdAt,
  } as Copy;
}
function book(id: string, coverUrl: string | null, copies: Copy[]): BookWithCopies {
  return { id, title: id, authors: [], coverUrl, copies } as unknown as BookWithCopies;
}

beforeEach(() => {
  signedPhotoUrls.mockReset();
  signedPhotoUrls.mockImplementation(async (paths: string[]) => new Map(paths.map((p) => [p, `signed:${p}`])));
});
afterEach(() => vi.useRealTimers());

describe("useCopyPhotoUrls", () => {
  it("never requests a URL for a book that has a cover", async () => {
    const books = [book("a", "http://c", [copy("c1", "p/a.jpg", "2026-01-01")])];
    const { result } = renderHook(() => useCopyPhotoUrls(books));
    await act(async () => {});
    expect(signedPhotoUrls).not.toHaveBeenCalled();
    expect(result.current.size).toBe(0);
  });
  it("batches coverless books into one call using the oldest photographed copy", async () => {
    const books = [
      book("a", null, [copy("c2", "p/a-new.jpg", "2026-03-01"), copy("c1", "p/a-old.jpg", "2026-01-01")]),
      book("b", null, [copy("c3", null, "2026-01-01"), copy("c4", "p/b.jpg", "2026-02-01")]),
      book("c", null, [copy("c5", null, "2026-01-01")]),
    ];
    const { result } = renderHook(() => useCopyPhotoUrls(books));
    await waitFor(() => expect(result.current.size).toBe(2));
    expect(signedPhotoUrls).toHaveBeenCalledTimes(1);
    expect(signedPhotoUrls).toHaveBeenCalledWith(["p/a-old.jpg", "p/b.jpg"]);
    expect(result.current.get("a")).toBe("signed:p/a-old.jpg");
    expect(result.current.get("b")).toBe("signed:p/b.jpg");
  });
  it("does not refetch when re-rendered with equivalent books", async () => {
    const mk = () => [book("a", null, [copy("c1", "p/a.jpg", "2026-01-01")])];
    const { rerender, result } = renderHook(({ b }) => useCopyPhotoUrls(b), { initialProps: { b: mk() } });
    await waitFor(() => expect(result.current.size).toBe(1));
    rerender({ b: mk() });
    await act(async () => {});
    expect(signedPhotoUrls).toHaveBeenCalledTimes(1);
  });
  it("leaves an empty map when signing rejects", async () => {
    signedPhotoUrls.mockRejectedValue(new Error("boom"));
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const books = [book("a", null, [copy("c1", "p/a.jpg", "2026-01-01")])];
    const { result } = renderHook(() => useCopyPhotoUrls(books));
    await waitFor(() => expect(err).toHaveBeenCalled());
    expect(result.current.size).toBe(0);
    err.mockRestore();
  });
  it("refreshes after 50 minutes and stops on unmount", async () => {
    vi.useFakeTimers();
    const books = [book("a", null, [copy("c1", "p/a.jpg", "2026-01-01")])];
    const { unmount } = renderHook(() => useCopyPhotoUrls(books));
    await act(async () => {});
    expect(signedPhotoUrls).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(50 * 60 * 1000);
    });
    expect(signedPhotoUrls).toHaveBeenCalledTimes(2);
    unmount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(120 * 60 * 1000);
    });
    expect(signedPhotoUrls).toHaveBeenCalledTimes(2);
  });
});
