import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const listBooks = vi.fn();
const listBookTags = vi.fn();
vi.mock("@/lib/library-repo", () => ({
  listBooks: (id: string) => listBooks(id),
  listBookTags: (id: string) => listBookTags(id),
}));
vi.mock("@/contexts/HouseholdContext", () => ({
  useHousehold: () => ({ household: { id: "h1" } }),
}));

import { clearCatalogCache, useCatalog } from "./useCatalog";

beforeEach(() => {
  listBooks.mockReset();
  listBookTags.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("useCatalog tags", () => {
  it("loads books and tags together", async () => {
    listBooks.mockResolvedValue([{ id: "b1" }]);
    listBookTags.mockResolvedValue(new Map([["b1", ["fantasy"]]]));
    const { result } = renderHook(() => useCatalog());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.books).toHaveLength(1);
    expect(result.current.tags.get("b1")).toEqual(["fantasy"]);
    expect(result.current.tagsError).toBeNull();
  });

  it("a tags failure keeps the books and sets only tagsError (D11 rollback)", async () => {
    listBooks.mockResolvedValue([{ id: "b1" }]);
    listBookTags.mockRejectedValue(new Error("relation does not exist"));
    const { result } = renderHook(() => useCatalog());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.books).toHaveLength(1);
    expect(result.current.error).toBeNull();
    expect(result.current.tagsError).toBe("Tome of Secrets tags unavailable");
    expect(result.current.tags.size).toBe(0);
  });
});

describe("useCatalog cache (D9)", () => {
  it("a second mount for the same household starts from the cache and refreshes in the background", async () => {
    listBooks.mockResolvedValue([{ id: "b1" }]);
    listBookTags.mockResolvedValue(new Map([["b1", ["fantasy"]]]));
    const first = renderHook(() => useCatalog());
    await waitFor(() => expect(first.result.current.loading).toBe(false));
    first.unmount();
    expect(listBooks).toHaveBeenCalledTimes(1);

    listBooks.mockResolvedValue([{ id: "b1" }, { id: "b2" }]);
    const renders: ReturnType<typeof useCatalog>[] = [];
    const second = renderHook(() => {
      const r = useCatalog();
      renders.push(r);
      return r;
    });
    // The very first render: no Loading screen, the cached books.
    const firstRender = renders[0];
    expect(firstRender.loading).toBe(false);
    expect(firstRender.books).toEqual([{ id: "b1" }]);
    expect(firstRender.tags.get("b1")).toEqual(["fantasy"]);
    await waitFor(() => expect(second.result.current.books).toHaveLength(2));
    expect(listBooks).toHaveBeenCalledTimes(2);
    expect(second.result.current.loading).toBe(false);
  });

  it("clearCatalogCache makes the next mount show loading again", async () => {
    listBooks.mockResolvedValue([{ id: "b1" }]);
    listBookTags.mockResolvedValue(new Map());
    const first = renderHook(() => useCatalog());
    await waitFor(() => expect(first.result.current.loading).toBe(false));
    first.unmount();

    clearCatalogCache();
    const second = renderHook(() => useCatalog());
    expect(second.result.current.loading).toBe(true);
    expect(second.result.current.books).toEqual([]);
    await waitFor(() => expect(second.result.current.loading).toBe(false));
  });

  it("reload() after an edit updates the cache for the next mount", async () => {
    listBooks.mockResolvedValue([{ id: "b1" }]);
    listBookTags.mockResolvedValue(new Map());
    const first = renderHook(() => useCatalog());
    await waitFor(() => expect(first.result.current.loading).toBe(false));
    listBooks.mockResolvedValue([{ id: "b1" }, { id: "b3" }]);
    await act(() => first.result.current.reload());
    first.unmount();

    listBooks.mockReturnValue(new Promise(() => {}));
    const second = renderHook(() => useCatalog());
    expect(second.result.current.books).toEqual([{ id: "b1" }, { id: "b3" }]);
  });
});
