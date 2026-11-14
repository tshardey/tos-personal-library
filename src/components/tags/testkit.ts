import { vi } from "vitest";
import type { TaggingState } from "@/contexts/TaggingContext";
import type { AiBudget, LibraryTag, TagJob } from "@/lib/tagging/types";

export const tagFns = { setBookLibraryTag: vi.fn(), retag: vi.fn() };

export const mkTag = (id: string, label: string, category: LibraryTag["category"], active = true): LibraryTag => ({
  id,
  label,
  category,
  active,
  addedVersion: 1,
  householdId: null,
});

export const mkJob = (bookId: string, status: TagJob["status"]): TagJob => ({
  id: "j-" + bookId,
  bookId,
  runId: null,
  kind: "full",
  reason: "manual",
  status,
  attempts: 0,
  claimedAt: null,
  retryAt: null,
  errorCode: null,
  createdAt: "2026-11-01T00:00:00Z",
});

export const aiBudget = (remainingMicro: number, reserveMicro = 1): AiBudget => ({
  month: "2026-11",
  spentMicro: 0,
  budgetMicro: remainingMicro,
  reserveMicro,
  globalSpentMicro: 0,
  globalBudgetMicro: 1_000_000_000,
});

/** A TaggingState for component tests that mock `@/contexts/TaggingContext`'s `useTagging`. */
export function taggingState(over: Partial<TaggingState> = {}): TaggingState {
  return {
    available: true,
    loading: false,
    vocabulary: [],
    vocabVersion: 1,
    libraryTagsByBook: new Map(),
    cards: new Map(),
    jobs: [],
    latestJob: new Map(),
    suggestions: [],
    budgets: { tagging: null, ask: null },
    stop: null,
    runId: null,
    tagsVersion: 0,
    tagAll: vi.fn(),
    checkNewTags: vi.fn(),
    approve: vi.fn(),
    dismiss: vi.fn(),
    createTag: vi.fn(),
    ask: vi.fn(),
    clearStop: vi.fn(),
    reload: vi.fn(),
    ...tagFns,
    ...over,
  } as TaggingState;
}
