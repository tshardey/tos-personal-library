export type CoverReason = "wrong_language" | "placeholder" | "wrong_book" | "low_quality";

export const COVER_REASONS: readonly CoverReason[] = ["wrong_language", "placeholder", "wrong_book", "low_quality"];

export const REASON_LABELS: Record<CoverReason, string> = {
  wrong_language: "Wrong language",
  placeholder: "Placeholder",
  wrong_book: "Wrong book",
  low_quality: "Low quality",
};

export type CoverSearchStatus =
  | "queued"
  | "gathered"
  | "processing"
  | "ready"
  | "nothing_found"
  | "failed"
  | "applied"
  | "dismissed";

export const OPEN_STATUSES: ReadonlySet<CoverSearchStatus> = new Set<CoverSearchStatus>([
  "queued",
  "gathered",
  "processing",
  "ready",
]);

export type CoverSource = "openlibrary" | "google";

export interface CoverCandidate {
  url: string;
  source: CoverSource;
  width: number;
  height: number;
  language: string | null;
  editionTitle: string | null;
}

export interface CoverResult {
  url: string;
  source: CoverSource;
  width: number;
  height: number;
}

export interface CoverSearchBook {
  title: string;
  authors: string[];
  isbn13: string[];
  isbn10: string[];
  coverUrl: string | null;
}

export interface CoverSearch {
  id: string;
  householdId: string;
  bookId: string;
  requestedBy: string | null;
  batchId: string;
  reasons: CoverReason[];
  note: string | null;
  coverAtRequest: string | null;
  status: CoverSearchStatus;
  attempts: number;
  claimedAt: string | null;
  retryAt: string | null;
  candidates: CoverCandidate[] | null;
  results: CoverResult[];
  errorCode: string | null;
  seenAt: string | null;
  createdAt: string;
  book: CoverSearchBook | null;
}

export interface CoverMark {
  bookId: string;
  reasons: CoverReason[];
  note: string | null;
  markedBy: string | null;
  markedAt: string;
}

export interface CoverBudget {
  month: string;
  spentMicro: number;
  budgetMicro: number;
  reserveMicro: number;
  /** The project-wide row, read through cover_budget(). */
  globalSpentMicro: number;
  globalBudgetMicro: number;
}

/** A search claimed longer ago than this is treated as abandoned. */
export const LEASE_MS = 7 * 60_000;
export const MAX_NOTE = 500;

type Raw = Record<string, unknown>;

const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const strArray = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];

const STATUSES = new Set<string>([
  "queued",
  "gathered",
  "processing",
  "ready",
  "nothing_found",
  "failed",
  "applied",
  "dismissed",
]);

/** Known reasons only; anything else is dropped. */
export function toReasons(v: unknown): CoverReason[] {
  return strArray(v).filter((r): r is CoverReason => (COVER_REASONS as readonly string[]).includes(r));
}

const isSource = (v: unknown): v is CoverSource => v === "openlibrary" || v === "google";

function toResult(v: unknown): CoverResult | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Raw;
  if (typeof o.url !== "string" || !isSource(o.source)) return null;
  return { url: o.url, source: o.source, width: num(o.width), height: num(o.height) };
}

function toCandidate(v: unknown): CoverCandidate | null {
  const r = toResult(v);
  if (r === null) return null;
  const o = v as Raw;
  return { ...r, language: str(o.language), editionTitle: str(o.editionTitle) };
}

/** Null when the column is null or any entry is malformed. */
function toCandidates(v: unknown): CoverCandidate[] | null {
  if (!Array.isArray(v)) return null;
  const out: CoverCandidate[] = [];
  for (const item of v) {
    const c = toCandidate(item);
    if (c === null) return null;
    out.push(c);
  }
  return out;
}

function toResults(v: unknown): CoverResult[] {
  if (!Array.isArray(v)) return [];
  return v.map(toResult).filter((r): r is CoverResult => r !== null);
}

function toBook(v: unknown): CoverSearchBook | null {
  const o = (Array.isArray(v) ? v[0] : v) as Raw | null | undefined;
  if (!o || typeof o !== "object") return null;
  return {
    title: str(o.title) ?? "",
    authors: strArray(o.authors),
    isbn13: strArray(o.isbn13),
    isbn10: strArray(o.isbn10),
    coverUrl: str(o.cover_url),
  };
}

export function toCoverSearch(row: Raw): CoverSearch {
  const status = STATUSES.has(row.status as string) ? (row.status as CoverSearchStatus) : "failed";
  return {
    id: row.id as string,
    householdId: row.household_id as string,
    bookId: row.book_id as string,
    requestedBy: str(row.requested_by),
    batchId: row.batch_id as string,
    reasons: toReasons(row.reasons),
    note: str(row.note),
    coverAtRequest: str(row.cover_at_request),
    status,
    attempts: num(row.attempts),
    claimedAt: str(row.claimed_at),
    retryAt: str(row.retry_at),
    candidates: toCandidates(row.candidates),
    results: toResults(row.results),
    errorCode: str(row.error_code),
    seenAt: str(row.seen_at),
    createdAt: row.created_at as string,
    book: toBook(row.book),
  };
}

export function toCoverMark(row: Raw): CoverMark {
  return {
    bookId: row.book_id as string,
    reasons: toReasons(row.reasons),
    note: str(row.note),
    markedBy: str(row.marked_by),
    markedAt: row.marked_at as string,
  };
}
