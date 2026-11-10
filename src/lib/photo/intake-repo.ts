import { readAllPages } from "@/lib/library-repo";
import { normalizeBookInput, normalizeCopyInput } from "@/lib/normalize";
import { supabase } from "@/lib/supabase";
import { fromBookPatch, fromCopyPatch, type BookInput, type CopyInput } from "@/lib/types";
import { INTAKE_BUCKET, toIntakeItem, type DiscardReason, type IntakeItem, type LookupResult } from "./types";

// Every column except claim_token, which clients have no select grant on.
const ITEM_COLUMNS =
  "id, household_id, uploaded_by, batch_id, owner_user_id, cover_path, title_page_path, " +
  "source_hash, status, attempts, claimed_at, retry_at, extraction, lookup, error_code, " +
  "result_book_id, created_at, updated_at, source, scanned_isbn, edition_label, extra_copy, discard_reason";

const RETENTION_MS = 7 * 24 * 3600_000;
const CHUNK = 100;
const SIGNED_URL_SECONDS = 3600;

const chunks = <T>(items: T[], size: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
};

type RawRow = Record<string, unknown>;

/** Open items, plus confirmed/discarded ones touched in the last 7 days. */
export async function listIntakeItems(householdId: string): Promise<IntakeItem[]> {
  const cutoff = new Date(Date.now() - RETENTION_MS).toISOString();
  const rows = await readAllPages<RawRow>(
    (from, to) =>
      supabase
        .from("intake_items")
        .select(ITEM_COLUMNS)
        .eq("household_id", householdId)
        .or(`status.not.in.(confirmed,discarded),updated_at.gte.${cutoff}`)
        .order("created_at")
        .order("id")
        .range(from, to) as unknown as PromiseLike<{ data: RawRow[] | null; error: unknown }>,
  );
  return rows.map(toIntakeItem);
}

export const coverPath = (householdId: string, itemId: string) => `${householdId}/${itemId}/cover.jpg`;
export const titlePagePath = (householdId: string, itemId: string) => `${householdId}/${itemId}/title.jpg`;

export async function uploadPhoto(path: string, blob: Blob): Promise<void> {
  const { error } = await supabase.storage
    .from(INTAKE_BUCKET)
    .upload(path, blob, { contentType: "image/jpeg", upsert: false });
  if (!error) return;
  // A retry after a lost response finds its own earlier upload; that's success.
  const e = error as { message?: string; statusCode?: string | number; status?: number };
  const exists = /already exists/i.test(e.message ?? "") || String(e.statusCode) === "409" || e.status === 409;
  if (!exists) throw error;
}

/** True when this household already has a live (not discarded) item for the photo hash. */
export async function sourceHashExists(householdId: string, sourceHash: string): Promise<boolean> {
  const { data, error } = await supabase
    .from("intake_items")
    .select("id")
    .eq("household_id", householdId)
    .eq("source_hash", sourceHash)
    .neq("status", "discarded")
    .limit(1);
  if (error) throw error;
  return (data ?? []).length > 0;
}

export async function createIntakeItem(row: {
  id: string;
  householdId: string;
  batchId: string;
  ownerUserId: string | null;
  coverPath: string;
  titlePagePath: string | null;
  sourceHash: string;
  scannedIsbn?: string | null;
  editionLabel?: string | null;
}): Promise<"created" | "duplicate"> {
  // No .select() after the insert: `returning *` would need claim_token.
  const { error } = await supabase.from("intake_items").insert({
    id: row.id,
    household_id: row.householdId,
    batch_id: row.batchId,
    owner_user_id: row.ownerUserId,
    cover_path: row.coverPath,
    title_page_path: row.titlePagePath,
    source_hash: row.sourceHash,
    ...(row.scannedIsbn != null ? { scanned_isbn: row.scannedIsbn } : {}),
    ...(row.editionLabel != null ? { edition_label: row.editionLabel } : {}),
  });
  if (!error) return "created";
  if ((error as { code?: string }).code === "23505") return "duplicate";
  throw error;
}

export type ProcessOutcome =
  | "ready"
  | "busy"
  | "done"
  | "retry_later"
  | "failed"
  | "daily_cap"
  | "misconfigured";

/** A non-2xx response or network failure rejects, so callers treat it as a transient retry. */
export async function processItem(itemId: string): Promise<ProcessOutcome> {
  const { data, error } = await supabase.functions.invoke("library-intake", { body: { itemId } });
  if (error) throw error;
  return (data as { outcome: ProcessOutcome }).outcome;
}

export async function saveLookup(itemId: string, lookup: LookupResult): Promise<void> {
  const { error } = await supabase.from("intake_items").update({ lookup }).eq("id", itemId);
  if (error) throw error;
}

export async function setItemOwner(itemId: string, ownerUserId: string | null): Promise<void> {
  const { error } = await supabase
    .from("intake_items")
    .update({ owner_user_id: ownerUserId })
    .eq("id", itemId);
  if (error) throw error;
}

export async function retryItem(itemId: string): Promise<boolean> {
  const { data, error } = await supabase.rpc("retry_intake_item", { p_item: itemId });
  if (error) throw error;
  return data === true;
}

export async function discardItem(itemId: string, reason: DiscardReason): Promise<boolean> {
  const { data, error } = await supabase.rpc("discard_intake_item", { p_item: itemId, p_reason: reason });
  if (error) throw error;
  return data === true;
}

export interface ScanItemArgs {
  id: string;
  householdId: string;
  batchId: string;
  ownerUserId: string | null;
  isbn: string;
  editionLabel: string | null;
  extraCopy: boolean;
}

/** A failed scan save: `status` is the HTTP status, null when the request never got an answer. */
export class ScanSaveError extends Error {
  code: string | null;
  status: number | null;
  constructor(code: string | null, status: number | null) {
    super(code ? `scan save failed (${code})` : "scan save failed");
    this.name = "ScanSaveError";
    this.code = code;
    this.status = status;
  }
}

/** Idempotent on the id: a resend after a lost response answers "exists". */
export async function createScanItem(args: ScanItemArgs): Promise<"created" | "exists"> {
  let res: { data: unknown; error: unknown; status?: number };
  try {
    res = await supabase.rpc("create_scan_item", {
      p_item: args.id,
      p_household: args.householdId,
      p_batch: args.batchId,
      p_owner: args.ownerUserId,
      p_isbn: args.isbn,
      p_edition: args.editionLabel,
      p_extra_copy: args.extraCopy,
    });
  } catch {
    throw new ScanSaveError(null, null);
  }
  if (res.error) {
    const code = (res.error as { code?: string }).code;
    throw new ScanSaveError(code ?? null, typeof res.status === "number" ? res.status : null);
  }
  return res.data === "exists" ? "exists" : "created";
}

/** Trims; a blank label clears the edition. */
export async function setItemEdition(itemId: string, label: string | null): Promise<void> {
  const { error } = await supabase
    .from("intake_items")
    .update({ edition_label: label?.trim() || null })
    .eq("id", itemId);
  if (error) throw error;
}

/** Edition labels on open items, for the picker's list. */
export async function listOpenEditionLabels(householdId: string): Promise<string[]> {
  const rows = await readAllPages<RawRow>(
    (from, to) =>
      supabase
        .from("intake_items")
        .select("edition_label")
        .eq("household_id", householdId)
        .in("status", ["pending", "processing", "ready", "failed"])
        .not("edition_label", "is", null)
        .order("id")
        .range(from, to) as unknown as PromiseLike<{ data: RawRow[] | null; error: unknown }>,
  );
  return rows.map((r) => r.edition_label as string);
}

/** A new book from a photo: BookInput plus the ids an agreeing lookup supplies (D8). */
export type NewBookInput = BookInput & { openlibraryId?: string | null; googleBooksId?: string | null };

export async function confirmItem(
  itemId: string,
  target: { bookId: string } | { book: NewBookInput },
  copy: CopyInput,
): Promise<{ bookId: string; copyId: string }> {
  const { data, error } = await supabase.rpc("confirm_intake_item", {
    p_item: itemId,
    p_book_id: "bookId" in target ? target.bookId : null,
    p_book: "book" in target ? newBookPayload(target.book) : null,
    p_copy: fromCopyPatch(normalizeCopyInput(copy)),
  });
  if (error) throw error;
  const row = (Array.isArray(data) ? data[0] : data) as { book_id: string; copy_id: string } | undefined;
  if (!row) throw new Error("confirm_intake_item returned no row");
  return { bookId: row.book_id, copyId: row.copy_id };
}

function newBookPayload(book: NewBookInput) {
  const text = (v: string | null | undefined) => v?.trim() || undefined;
  return fromBookPatch({
    ...normalizeBookInput(book),
    openlibraryId: text(book.openlibraryId),
    googleBooksId: text(book.googleBooksId),
  });
}

export async function signedPhotoUrls(paths: string[]): Promise<Map<string, string>> {
  const urls = new Map<string, string>();
  for (const batch of chunks(paths, CHUNK)) {
    const { data, error } = await supabase.storage
      .from(INTAKE_BUCKET)
      .createSignedUrls(batch, SIGNED_URL_SECONDS);
    if (error) throw error;
    for (const entry of data ?? []) {
      if (entry.path && entry.signedUrl && !entry.error) urls.set(entry.path, entry.signedUrl);
    }
  }
  return urls;
}

/** Deletes files the database says are no longer needed, then records that they're gone. */
export async function purgeIntakePhotos(householdId: string): Promise<number> {
  const { data, error } = await supabase.rpc("intake_purgeable", { p_household: householdId });
  if (error) throw error;
  const paths = ((data ?? []) as { path: string }[]).map((r) => r.path);
  if (paths.length === 0) return 0;
  for (const batch of chunks(paths, CHUNK)) {
    const { error: removeError } = await supabase.storage.from(INTAKE_BUCKET).remove(batch);
    if (removeError) throw removeError;
  }
  const { error: markError } = await supabase.rpc("mark_intake_purged", {
    p_household: householdId,
    p_paths: paths,
  });
  if (markError) throw markError;
  return paths.length;
}
