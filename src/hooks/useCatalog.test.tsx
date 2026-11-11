import { renderHook, waitFor } from "@testing-library/react";
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

import { useCatalog } from "./useCatalog";

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
