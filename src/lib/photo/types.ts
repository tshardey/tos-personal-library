export type IntakeStatus = "pending" | "processing" | "ready" | "failed" | "confirmed" | "discarded";

export type IntakeErrorCode =
  | "photo_missing"
  | "vision_refused"
  | "vision_rejected"
  | "vision_unreadable"
  | "vision_unavailable"
  | "attempts_exhausted";

export interface Extraction {
  isBook: boolean;
  title: string | null;
  subtitle: string | null;
  authors: string[];
  editionClues: string[];
  publisher: string | null;
  isbn: string | null;
  confidence: "high" | "medium" | "low";
}

export interface LookupResult {
  source: "openlibrary" | "google" | "none";
  agrees: boolean;
  title: string | null;
  authors: string[];
  /** For matching only; never stored on a new book (D8). */
  matchIsbns: string[];
  coverUrl: string | null;
  synopsis: string | null;
  pageCount: number | null;
  publishDate: string | null;
  openlibraryId: string | null;
  googleBooksId: string | null;
}

export interface IntakeItem {
  id: string;
  householdId: string;
  uploadedBy: string | null;
  batchId: string;
  ownerUserId: string | null;
  coverPath: string | null;
  titlePagePath: string | null;
  sourceHash: string;
  status: IntakeStatus;
  attempts: number;
  claimedAt: string | null;
  retryAt: string | null;
  extraction: Extraction | null;
  lookup: LookupResult | null;
  errorCode: IntakeErrorCode | null;
  resultBookId: string | null;
  createdAt: string;
}

export const INTAKE_BUCKET = "library-intake";
export const MAX_ATTEMPTS = 3;
export const LEASE_MS = 7 * 60_000;

const isStringOrNull = (v: unknown): v is string | null => v === null || typeof v === "string";
const isStringArray = (v: unknown): v is string[] =>
  Array.isArray(v) && v.every((e) => typeof e === "string");

/** The model writes this object, so anything off-shape is dropped whole rather than half-used. */
export function parseExtraction(raw: unknown): Extraction | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const subtitle = r.subtitle ?? null;
  const editionClues = r.editionClues ?? [];
  const publisher = r.publisher ?? null;
  const isbn = r.isbn ?? null;
  if (typeof r.isBook !== "boolean") return null;
  if (!isStringOrNull(r.title) || r.title === undefined) return null;
  if (!isStringOrNull(subtitle) || !isStringOrNull(publisher) || !isStringOrNull(isbn)) return null;
  if (!isStringArray(r.authors) || !isStringArray(editionClues)) return null;
  if (r.confidence !== "high" && r.confidence !== "medium" && r.confidence !== "low") return null;
  return {
    isBook: r.isBook,
    title: r.title,
    subtitle,
    authors: r.authors,
    editionClues,
    publisher,
    isbn,
    confidence: r.confidence,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;

/** Reads no claim_token: clients can't select it. */
export function toIntakeItem(row: Row): IntakeItem {
  return {
    id: row.id,
    householdId: row.household_id,
    uploadedBy: row.uploaded_by ?? null,
    batchId: row.batch_id,
    ownerUserId: row.owner_user_id ?? null,
    coverPath: row.cover_path ?? null,
    titlePagePath: row.title_page_path ?? null,
    sourceHash: row.source_hash,
    status: row.status,
    attempts: row.attempts ?? 0,
    claimedAt: row.claimed_at ?? null,
    retryAt: row.retry_at ?? null,
    extraction: parseExtraction(row.extraction),
    lookup: (row.lookup as LookupResult | null) ?? null,
    errorCode: row.error_code ?? null,
    resultBookId: row.result_book_id ?? null,
    createdAt: row.created_at,
  };
}
