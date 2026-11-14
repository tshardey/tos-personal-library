export type LibraryTagCategory =
  | "trope" | "creature" | "setting" | "era" | "theme" | "mood" | "plot" | "protagonist"
  | "audience" | "subgenre" | "cover-colour" | "cover-motif" | "fact";

/** Display order and labels (plan D3). */
export const LIBRARY_TAG_CATEGORIES: readonly { id: LibraryTagCategory; label: string }[] = [
  { id: "trope", label: "Tropes" },
  { id: "creature", label: "Creatures and beings" },
  { id: "setting", label: "Setting" },
  { id: "era", label: "Era" },
  { id: "theme", label: "Themes" },
  { id: "mood", label: "Mood and pace" },
  { id: "plot", label: "Plot elements" },
  { id: "protagonist", label: "Protagonist" },
  { id: "audience", label: "Audience" },
  { id: "subgenre", label: "Subgenre" },
  { id: "cover-colour", label: "Cover colour" },
  { id: "cover-motif", label: "Cover motifs" },
  { id: "fact", label: "Facts" },
];

export interface LibraryTag {
  id: string;
  label: string;
  category: LibraryTagCategory;
  active: boolean;
  addedVersion: number;
  /** null for the shared starting vocabulary. */
  householdId: string | null;
}

export type TagJobStatus = "queued" | "processing" | "done" | "failed";

export interface TagJob {
  id: string;
  bookId: string;
  runId: string | null;
  kind: "full" | "new_tags";
  reason: string;
  status: TagJobStatus;
  attempts: number;
  claimedAt: string | null;
  retryAt: string | null;
  errorCode: string | null;
  createdAt: string;
}

export interface BookCardMeta {
  bookId: string;
  vocabVersion: number;
  writtenAt: string;
}

export interface TagSuggestion {
  id: string;
  tagId: string;
  label: string;
  category: LibraryTagCategory;
  books: { bookId: string; why: string }[];
}

export type AiFeature = "tagging" | "ask";

/** Same shape as CoverBudget, so the covers/cost.ts helpers apply. */
export interface AiBudget {
  month: string;
  spentMicro: number;
  budgetMicro: number;
  reserveMicro: number;
  globalSpentMicro: number;
  globalBudgetMicro: number;
}

export type TagJobOutcome =
  | "done" | "failed" | "retry_later" | "busy" | "budget" | "misconfigured" | "billing" | "rejected" | "error";

export interface AskMatch {
  bookId: string;
  confidence: number;
  reason: string;
}

export type AskResponse =
  | { outcome: "ok"; answerable: boolean; note: string | null; matches: AskMatch[] }
  | { outcome: "budget" | "misconfigured" | "billing" | "rejected" | "retry_later" | "too_large" | "empty" | "failed" };
