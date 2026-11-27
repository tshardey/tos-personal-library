import { vi } from "vitest";
import type { TaggingState } from "@/contexts/TaggingContext";
import type { AiBudget, LibraryTag, SeriesAuditFlag, SeriesDismissal, SeriesSuggestion, TagJob } from "@/lib/tagging/types";

export const tagFns = { setBookLibraryTag: vi.fn(), retag: vi.fn(), retagMany: vi.fn() };
export const seriesFns = { findSeries: vi.fn(), approveSeries: vi.fn(), dismissSeries: vi.fn() };

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

/** A suggestion that joins a series the household already has. */
export const existingSuggestion = (over: Partial<SeriesSuggestion> = {}): SeriesSuggestion => ({
  id: "e1",
  name: "Lantern Vale Cycle",
  kind: "existing",
  books: [{ bookId: "b1", volume: 3, why: "Third in the cycle" }],
  ...over,
});

/** A pending audit flag; wrong_series by default (Thornmere Cycle #2 -> Saltglass Archive #1). */
export const auditFlag = (over: Partial<SeriesAuditFlag> = {}): SeriesAuditFlag => ({
  id: "f1",
  bookId: "b1",
  kind: "wrong_series",
  currentName: "Thornmere Cycle",
  currentVolume: 2,
  proposedName: "Saltglass Archive",
  proposedVolume: 1,
  why: "The description places it first in the Saltglass Archive.",
  createdAt: "2026-11-20T00:00:00Z",
  ...over,
});

/** A dismissed new suggestion (kind name) or a dismissed book of an existing series (kind book). */
export const dismissal = (over: Partial<SeriesDismissal> = {}): SeriesDismissal =>
  ({ kind: "name", suggestionId: "d1", name: "Wrenfold Tales", decidedAt: "2026-11-21T00:00:00Z", ...over }) as SeriesDismissal;

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
    seriesAvailable: false,
    seriesSuggestions: [],
    seriesChecked: new Set<string>(),
    auditAvailable: false,
    seriesAuditFlags: [],
    seriesAudited: new Set<string>(),
    seriesDismissals: [],
    pendingCount: 0,
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
    auditSeries: vi.fn(),
    applyAudit: vi.fn(),
    keepAudit: vi.fn(),
    editAudit: vi.fn(),
    undoDismissal: vi.fn(),
    ...tagFns,
    ...seriesFns,
    ...over,
  } as TaggingState;
}
