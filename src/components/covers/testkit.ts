import { vi } from "vitest";
import type { BookWithCopies } from "@/lib/types";
import type { CoverBudget, CoverSearch } from "@/lib/covers/types";

export function mkBook(id: string, title: string, over: Partial<BookWithCopies> = {}): BookWithCopies {
  return {
    id,
    householdId: "h1",
    title,
    authors: ["Member A"],
    synopsis: null,
    coverUrl: null,
    isbn13: [],
    isbn10: [],
    openlibraryId: null,
    googleBooksId: null,
    pageCount: null,
    publisher: null,
    publishDate: null,
    seriesName: null,
    seriesVolume: null,
    userEditedFields: [],
    createdAt: "",
    updatedAt: "",
    copies: [],
    ...over,
  };
}

export const fns = { requestBatch: vi.fn(), retry: vi.fn() };

export function finderState(over: Record<string, unknown> = {}) {
  return { available: true, marks: new Map(), latest: new Map(), budget: null, ...fns, ...over };
}

export const mkSearch = (bookId: string, status: string, over: Partial<CoverSearch> = {}): CoverSearch =>
  ({ id: "s-" + bookId, bookId, status, createdAt: "2026-11-01T00:00:00Z", ...over }) as CoverSearch;

export const budgetOf = (remainingMicro: number, reserveMicro = 1): CoverBudget => ({
  month: "2026-11",
  spentMicro: 0,
  budgetMicro: remainingMicro,
  reserveMicro,
  globalSpentMicro: 0,
  globalBudgetMicro: 1_000_000_000,
});
