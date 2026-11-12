import { FunctionsHttpError } from "@supabase/supabase-js";
import { readAllPages } from "@/lib/library-repo";
import { supabase } from "@/lib/supabase";
import {
  toCoverMark,
  toCoverSearch,
  type CoverBudget,
  type CoverCandidate,
  type CoverMark,
  type CoverReason,
  type CoverSearch,
} from "./types";

type RawRow = Record<string, unknown>;
type Page = PromiseLike<{ data: RawRow[] | null; error: unknown }>;

// Every column except claim_token, which clients have no select grant on.
const SEARCH_COLUMNS =
  "id, household_id, book_id, requested_by, batch_id, reasons, note, cover_at_request, status, attempts, " +
  "claimed_at, retry_at, candidates, results, error_code, seen_at, created_at, " +
  "book:books(title, authors, isbn13, isbn10, cover_url)";

const CHUNK = 1000;

const chunks = <T>(items: T[], size: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
};

const firstRow = (data: unknown): RawRow | undefined => (Array.isArray(data) ? data[0] : data) as RawRow | undefined;

/** True when the cover tables or functions do not exist yet (migration not applied). */
export function isMissingFeature(err: unknown): boolean {
  const code = (err as { code?: unknown } | null)?.code;
  return code === "42P01" || code === "PGRST205" || code === "PGRST202";
}

export async function listCoverMarks(householdId: string): Promise<Map<string, CoverMark>> {
  const rows = await readAllPages<RawRow>(
    (from, to) =>
      supabase
        .from("cover_marks")
        .select("book_id, reasons, note, marked_by, marked_at")
        .eq("household_id", householdId)
        .order("book_id")
        .range(from, to) as unknown as Page,
  );
  return new Map(rows.map((r) => [r.book_id as string, toCoverMark(r)]));
}

/** Active rows only: open ones plus nothing_found and failed (applied and dismissed are history). */
export async function listCoverSearches(householdId: string): Promise<CoverSearch[]> {
  const rows = await readAllPages<RawRow>(
    (from, to) =>
      supabase
        .from("cover_searches")
        .select(SEARCH_COLUMNS)
        .eq("household_id", householdId)
        .in("status", ["queued", "gathered", "processing", "ready", "nothing_found", "failed"])
        .order("created_at")
        .order("id")
        .range(from, to) as unknown as Page,
  );
  return rows.map(toCoverSearch);
}

export async function getCoverBudget(householdId: string): Promise<CoverBudget> {
  const { data, error } = await supabase.rpc("cover_budget", { p_household: householdId });
  if (error) throw error;
  const r = firstRow(data);
  if (!r) throw new Error("cover_budget returned no row");
  return {
    month: r.month as string,
    spentMicro: Number(r.spent_micro),
    budgetMicro: Number(r.budget_micro),
    reserveMicro: Number(r.reserve_micro),
    globalSpentMicro: Number(r.global_spent_micro),
    globalBudgetMicro: Number(r.global_budget_micro),
  };
}

/** A blank note is sent as null; its length is checked by the server. */
export async function markForCover(bookId: string, reasons: CoverReason[], note: string | null): Promise<void> {
  const { error } = await supabase.rpc("mark_for_cover", {
    p_book: bookId,
    p_reasons: reasons,
    p_note: note?.trim() || null,
  });
  if (error) throw error;
}

export async function unmarkForCover(bookId: string): Promise<boolean> {
  const { error, data } = await supabase.rpc("unmark_for_cover", { p_book: bookId });
  if (error) throw error;
  return data === true;
}

export type RequestOutcome = "queued" | "already_open" | "nothing_found" | "not_found";

export async function requestCoverSearches(
  householdId: string,
  bookIds: string[],
  batchId: string,
  manual: boolean,
): Promise<Map<string, RequestOutcome>> {
  const out = new Map<string, RequestOutcome>();
  for (const ids of chunks(bookIds, CHUNK)) {
    const { data, error } = await supabase.rpc("request_cover_searches", {
      p_household: householdId,
      p_book_ids: ids,
      p_batch: batchId,
      p_manual: manual,
    });
    if (error) throw error;
    for (const r of (data ?? []) as { book_id: string; outcome: RequestOutcome }[]) out.set(r.book_id, r.outcome);
  }
  return out;
}

export async function recordCoverCandidates(
  searchId: string,
  candidates: CoverCandidate[],
): Promise<"gathered" | "nothing_found" | "skipped"> {
  const { data, error } = await supabase.rpc("record_cover_candidates", {
    p_search: searchId,
    p_candidates: candidates,
  });
  if (error) throw error;
  return data as "gathered" | "nothing_found" | "skipped";
}

export type ScreenOutcome =
  | "ready"
  | "nothing_found"
  | "busy"
  | "done"
  | "retry_later"
  | "failed"
  | "budget"
  | "not_gathered"
  | "misconfigured"
  | "billing"
  | "rejected";

/** A 404 means the Edge Function is not deployed; any other failure rejects (a transient retry). */
export async function screenSearch(searchId: string): Promise<ScreenOutcome> {
  const { data, error } = await supabase.functions.invoke("library-covers", { body: { searchId } });
  if (error) {
    if (error instanceof FunctionsHttpError && (error.context as Response | undefined)?.status === 404) {
      return "misconfigured";
    }
    throw error;
  }
  return (data as { outcome: ScreenOutcome }).outcome;
}

export type ApplyOutcome = "applied" | "cover_changed" | "not_ready" | "invalid_choice";

export async function applyCover(searchId: string, url: string, expectedCover: string | null): Promise<ApplyOutcome> {
  const { data, error } = await supabase.rpc("apply_cover", {
    p_search: searchId,
    p_url: url,
    p_expected_cover: expectedCover,
  });
  if (error) {
    // The book or the search was deleted meanwhile.
    if ((error as { code?: string }).code === "42501") return "not_ready";
    throw error;
  }
  return data as ApplyOutcome;
}

export async function dismissCoverSearch(searchId: string): Promise<"dismissed" | "not_ready"> {
  const { data, error } = await supabase.rpc("dismiss_cover_search", { p_search: searchId });
  if (error) throw error;
  return data as "dismissed" | "not_ready";
}

export async function markResultsSeen(searchIds: string[]): Promise<number> {
  if (searchIds.length === 0) return 0;
  const { data, error } = await supabase.rpc("mark_cover_results_seen", { p_searches: searchIds });
  if (error) throw error;
  return typeof data === "number" ? data : 0;
}
