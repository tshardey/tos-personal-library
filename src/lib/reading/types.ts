export type StoredStatus = "read" | "dnf" | "cleared";
export type ReadState = "read" | "dnf" | "unread";

export interface ReadStatusRow {
  bookId: string;
  userId: string;
  status: StoredStatus;
  finishedOn: string | null;
  source: "app" | "storygraph" | "tos";
  markedAt: string;
}

/** bookId -> userId -> state. Never holds `cleared`; a missing entry means unread. */
export type ReadStatusMap = Map<string, Map<string, { state: "read" | "dnf"; finishedOn: string | null }>>;

export interface HistoryUploadRow {
  title: string;
  authors: string[];
  isbnUid: string | null;
  status: "read" | "dnf";
  lastRead: string | null;
}

export interface UploadCounts {
  rows: number;
  matched: number;
  applied: number;
  possible: number;
  unmatched: number;
}

export interface PossibleMatch {
  historyId: string;
  bookId: string;
  reason: string;
  sgTitle: string;
  sgAuthors: string[];
}
