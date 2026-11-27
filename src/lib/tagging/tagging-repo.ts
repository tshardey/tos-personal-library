import { FunctionsHttpError, FunctionsRelayError } from "@supabase/supabase-js";
import { UnexpectedReplyError } from "@/lib/covers/cover-repo";
import { readAllPages } from "@/lib/library-repo";
import { supabase } from "@/lib/supabase";
import type {
  AiBudget,
  AiFeature,
  AskResponse,
  AuditDecision,
  BookCardMeta,
  LibraryTag,
  LibraryTagCategory,
  TagJob,
  TagJobOutcome,
  TagJobStatus,
  SeriesAuditFlag,
  SeriesDismissal,
  SeriesSuggestion,
  TagSuggestion,
} from "./types";

type RawRow = Record<string, unknown>;
type Page = PromiseLike<{ data: RawRow[] | null; error: unknown }>;

const CHUNK = 1000;

const chunks = <T>(items: T[], size: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
};

const str = (v: unknown): string | null => (typeof v === "string" ? v : null);

/** The starting rows (household_id null) plus the household's own. */
export async function listVocabulary(householdId: string): Promise<LibraryTag[]> {
  const rows = await readAllPages<RawRow>(
    (from, to) =>
      supabase
        .from("library_tags")
        .select("id, label, category, active, added_version, household_id")
        .or(`household_id.is.null,household_id.eq.${householdId}`)
        .order("category")
        .order("id")
        .range(from, to) as unknown as Page,
  );
  // A household row and a shared row can share an id; keep one (the household's wins).
  const byId = new Map<string, LibraryTag>();
  for (const r of rows) {
    const tag: LibraryTag = {
      id: r.id as string,
      label: r.label as string,
      category: r.category as LibraryTagCategory,
      active: r.active === true,
      addedVersion: Number(r.added_version),
      householdId: str(r.household_id),
    };
    const seen = byId.get(tag.id);
    if (seen === undefined || (seen.householdId === null && tag.householdId !== null)) byId.set(tag.id, tag);
  }
  return [...byId.values()];
}

/** Library tag ids per book; any page's error rejects, so a partial map is never returned. */
export async function listLibraryTagsByBook(householdId: string): Promise<Map<string, string[]>> {
  const rows = await readAllPages<RawRow>(
    (from, to) =>
      supabase
        .from("book_library_tags")
        .select("book_id, tag_id")
        .eq("household_id", householdId)
        .order("book_id")
        .order("tag_id")
        .range(from, to) as unknown as Page,
  );
  const tags = new Map<string, string[]>();
  for (const row of rows) {
    const list = tags.get(row.book_id as string) ?? [];
    list.push(row.tag_id as string);
    tags.set(row.book_id as string, list);
  }
  return tags;
}

export async function addLibraryTag(bookId: string, householdId: string, tagId: string): Promise<void> {
  const { error } = await supabase
    .from("book_library_tags")
    .upsert(
      { book_id: bookId, household_id: householdId, tag_id: tagId },
      { onConflict: "book_id,tag_id", ignoreDuplicates: true },
    );
  if (error) throw error;
}

export async function removeLibraryTag(bookId: string, tagId: string): Promise<void> {
  const { error } = await supabase.from("book_library_tags").delete().eq("book_id", bookId).eq("tag_id", tagId);
  if (error) throw error;
}

export async function listCardMeta(householdId: string): Promise<Map<string, BookCardMeta>> {
  const rows = await readAllPages<RawRow>(
    (from, to) =>
      supabase
        .from("book_cards")
        .select("book_id, vocab_version, written_at")
        .eq("household_id", householdId)
        .order("book_id")
        .range(from, to) as unknown as Page,
  );
  return new Map(
    rows.map((r) => [
      r.book_id as string,
      { bookId: r.book_id as string, vocabVersion: Number(r.vocab_version), writtenAt: r.written_at as string },
    ]),
  );
}

// Named columns only: claim_token has no select grant for clients.
const JOB_COLUMNS =
  "id, book_id, run_id, kind, reason, status, attempts, claimed_at, retry_at, error_code, created_at";

const toJob = (r: RawRow): TagJob => ({
  id: r.id as string,
  bookId: r.book_id as string,
  runId: str(r.run_id),
  kind: r.kind as TagJob["kind"],
  reason: r.reason as string,
  status: r.status as TagJobStatus,
  attempts: Number(r.attempts),
  claimedAt: str(r.claimed_at),
  retryAt: str(r.retry_at),
  errorCode: str(r.error_code),
  createdAt: r.created_at as string,
});

/**
 * Every queued or processing job, plus each book's newest job of any status (done and failed included),
 * newest first. A job that is both is returned once.
 */
export async function listTagJobs(householdId: string): Promise<TagJob[]> {
  const rows = await readAllPages<RawRow>(
    (from, to) =>
      supabase
        .from("tag_jobs")
        .select(JOB_COLUMNS)
        .eq("household_id", householdId)
        .order("created_at", { ascending: false })
        .order("id")
        .range(from, to) as unknown as Page,
  );
  const newestSeen = new Set<string>();
  const out: TagJob[] = [];
  for (const job of rows.map(toJob)) {
    const newest = !newestSeen.has(job.bookId);
    newestSeen.add(job.bookId);
    if (newest || job.status === "queued" || job.status === "processing") out.push(job);
  }
  return out;
}

export async function getAiBudget(householdId: string, feature: AiFeature): Promise<AiBudget> {
  const { data, error } = await supabase.rpc("ai_budget", { p_household: householdId, p_feature: feature });
  if (error) throw error;
  const r = (Array.isArray(data) ? data[0] : data) as RawRow | undefined;
  if (!r) throw new Error("ai_budget returned no row");
  return {
    month: r.month as string,
    spentMicro: Number(r.spent_micro),
    budgetMicro: Number(r.budget_micro),
    reserveMicro: Number(r.reserve_micro),
    globalSpentMicro: Number(r.global_spent_micro),
    globalBudgetMicro: Number(r.global_budget_micro),
  };
}

export type TagRequestOutcome = "queued" | "already_open" | "skipped" | "not_found";

export async function requestTagging(
  householdId: string,
  bookIds: string[],
  reason: "run" | "manual" | "new_tags" | "series" | "audit",
  runId: string | null,
): Promise<Map<string, TagRequestOutcome>> {
  const out = new Map<string, TagRequestOutcome>();
  for (const ids of chunks(bookIds, CHUNK)) {
    const { data, error } = await supabase.rpc("request_tagging", {
      p_household: householdId,
      p_book_ids: ids,
      p_reason: reason,
      p_run: runId,
    });
    if (error) throw error;
    for (const r of (data ?? []) as { book_id: string; outcome: TagRequestOutcome }[]) out.set(r.book_id, r.outcome);
  }
  return out;
}

const TAG_OUTCOMES = [
  "done", "failed", "retry_later", "busy", "budget", "misconfigured", "billing", "rejected", "error",
] as const satisfies readonly TagJobOutcome[];

const ASK_FAILURES = [
  "budget", "misconfigured", "billing", "rejected", "retry_later", "too_large", "empty", "failed",
] as const;

const isNotDeployed = (error: unknown): boolean =>
  (error instanceof FunctionsHttpError || error instanceof FunctionsRelayError) &&
  (error.context as Response | undefined)?.status === 404;

/** A 404 means the Edge Function is not deployed (misconfigured); any other failure rejects. */
export async function runTagJob(jobId: string): Promise<TagJobOutcome> {
  const { data, error } = await supabase.functions.invoke("library-tagger", { body: { jobId } });
  if (error) {
    if (isNotDeployed(error)) return "misconfigured";
    throw error;
  }
  const outcome = (data as { outcome?: unknown } | null)?.outcome;
  // An old function meeting an audit job answers "audit" and has done nothing; the job stays queued.
  if (outcome === "audit") return "busy";
  if (typeof outcome === "string" && (TAG_OUTCOMES as readonly string[]).includes(outcome)) {
    return outcome as TagJobOutcome;
  }
  throw new UnexpectedReplyError("library-tagger");
}

/** Pending suggestions with the books behind each. */
export async function listSuggestions(householdId: string): Promise<TagSuggestion[]> {
  const rows = await readAllPages<RawRow>(
    (from, to) =>
      supabase
        .from("tag_suggestions")
        .select("id, tag_id, label, category, books:tag_suggestion_books(book_id, why)")
        .eq("household_id", householdId)
        .eq("status", "pending")
        .order("created_at")
        .order("id")
        .range(from, to) as unknown as Page,
  );
  return rows.map((r) => ({
    id: r.id as string,
    tagId: r.tag_id as string,
    label: r.label as string,
    category: r.category as LibraryTagCategory,
    books: ((r.books ?? []) as { book_id: string; why: string }[]).map((b) => ({ bookId: b.book_id, why: b.why })),
  }));
}

/** Returns the number of books tagged; 0 when the suggestion is no longer pending. */
export async function approveSuggestion(id: string, label: string, category: LibraryTagCategory): Promise<number> {
  const { data, error } = await supabase.rpc("approve_tag_suggestion", {
    p_suggestion: id,
    p_label: label,
    p_category: category,
  });
  if (error) throw error;
  if (typeof data !== "number") throw new UnexpectedReplyError("approve_tag_suggestion");
  return data;
}

export async function dismissSuggestion(id: string): Promise<void> {
  const { error } = await supabase.rpc("dismiss_tag_suggestion", { p_suggestion: id });
  if (error) throw error;
}

/** Pending series suggestions with their books (volume arrives as a numeric string such as "2.50"). */
export async function listSeriesSuggestions(householdId: string): Promise<SeriesSuggestion[]> {
  const rows = await readAllPages<RawRow>(
    (from, to) =>
      supabase
        .from("series_suggestions")
        .select("id, name, kind, books:series_suggestion_books(book_id, volume, why, status)")
        .eq("household_id", householdId)
        .eq("status", "pending")
        .order("created_at")
        .order("id")
        .range(from, to) as unknown as Page,
  );
  return rows
    .map((r): SeriesSuggestion => ({
      id: r.id as string,
      name: r.name as string,
      kind: r.kind === "existing" ? "existing" : "new",
      books: ((r.books ?? []) as { book_id: string; volume: unknown; why: unknown; status: unknown }[])
        .filter((b) => b.status === "pending")
        .map((b) => ({
          bookId: b.book_id,
          volume: b.volume === null || b.volume === undefined ? null : Number(b.volume),
          why: str(b.why),
        })),
    }))
    // An existing suggestion lives only while it has a pending book; a new one stays as before.
    .filter((s) => s.kind === "new" || s.books.length > 0);
}

/** Books whose series check has run; any page's error rejects, so a partial set is never returned. */
export async function listSeriesChecked(householdId: string): Promise<Set<string>> {
  const rows = await readAllPages<RawRow>(
    (from, to) =>
      supabase
        .from("book_cards")
        .select("book_id")
        .eq("household_id", householdId)
        .not("series_checked_at", "is", null)
        .order("book_id")
        .range(from, to) as unknown as Page,
  );
  return new Set(rows.map((r) => r.book_id as string));
}

const numOrNull = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

/** Pending audit flags (numerics arrive as strings such as "2.50"). Stale and decided flags are never listed. */
export async function listSeriesAuditFlags(householdId: string): Promise<SeriesAuditFlag[]> {
  const rows = await readAllPages<RawRow>(
    (from, to) =>
      supabase
        .from("series_audit_flags")
        .select("id, book_id, kind, current_name, current_volume, proposed_name, proposed_volume, why, created_at")
        .eq("household_id", householdId)
        .eq("status", "pending")
        .order("created_at")
        .order("id")
        .range(from, to) as unknown as Page,
  );
  return rows.map((r): SeriesAuditFlag => ({
    id: r.id as string,
    bookId: r.book_id as string,
    kind: r.kind === "wrong_number" ? "wrong_number" : "wrong_series",
    currentName: r.current_name as string,
    currentVolume: numOrNull(r.current_volume),
    proposedName: str(r.proposed_name),
    proposedVolume: numOrNull(r.proposed_volume),
    why: str(r.why),
    createdAt: r.created_at as string,
  }));
}

/** Books whose series audit has run; any page's error rejects, so a partial set is never returned. */
export async function listSeriesAudited(householdId: string): Promise<Set<string>> {
  const rows = await readAllPages<RawRow>(
    (from, to) =>
      supabase
        .from("book_cards")
        .select("book_id")
        .eq("household_id", householdId)
        .not("series_audited_at", "is", null)
        .order("book_id")
        .range(from, to) as unknown as Page,
  );
  return new Set(rows.map((r) => r.book_id as string));
}

/** Dismissed new suggestions plus the dismissed books of existing ones, newest first, undated last. */
export async function listSeriesDismissals(householdId: string): Promise<SeriesDismissal[]> {
  const names = await readAllPages<RawRow>(
    (from, to) =>
      supabase
        .from("series_suggestions")
        .select("id, name, decided_at")
        .eq("household_id", householdId)
        .eq("kind", "new")
        .eq("status", "dismissed")
        .order("id")
        .range(from, to) as unknown as Page,
  );
  const existing = await readAllPages<RawRow>(
    (from, to) =>
      supabase
        .from("series_suggestions")
        .select("id, name, books:series_suggestion_books!inner(book_id, decided_at, status)")
        .eq("household_id", householdId)
        .eq("kind", "existing")
        .eq("books.status", "dismissed")
        .order("id")
        .range(from, to) as unknown as Page,
  );
  const out: SeriesDismissal[] = names.map((r) => ({
    kind: "name",
    suggestionId: r.id as string,
    name: r.name as string,
    decidedAt: str(r.decided_at),
  }));
  for (const r of existing) {
    for (const b of (r.books ?? []) as { book_id: string; decided_at: unknown; status: unknown }[]) {
      if (b.status !== "dismissed") continue;
      out.push({ kind: "book", suggestionId: r.id as string, bookId: b.book_id, name: r.name as string, decidedAt: str(b.decided_at) });
    }
  }
  const tie = (d: SeriesDismissal) => d.suggestionId + (d.kind === "book" ? d.bookId : "");
  return out.sort((a, b) => {
    if (a.decidedAt !== b.decidedAt) {
      if (a.decidedAt === null) return 1;
      if (b.decidedAt === null) return -1;
      return a.decidedAt < b.decidedAt ? 1 : -1;
    }
    return tie(a) < tie(b) ? -1 : tie(a) > tie(b) ? 1 : 0;
  });
}

const AUDIT_DECISIONS = ["applied", "kept", "edited", "stale", "not_pending"] as const satisfies readonly AuditDecision[];

async function decideAudit(fn: string, args: Record<string, unknown>): Promise<AuditDecision> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw error;
  if (typeof data === "string" && (AUDIT_DECISIONS as readonly string[]).includes(data)) return data as AuditDecision;
  throw new UnexpectedReplyError(fn);
}

export const applySeriesAudit = (flagId: string): Promise<AuditDecision> =>
  decideAudit("apply_series_audit", { p_flag: flagId });

export const keepSeriesAudit = (flagId: string): Promise<AuditDecision> =>
  decideAudit("keep_series_audit", { p_flag: flagId });

/** A null or blank name clears the series; a null volume clears the number. */
export const editSeriesAudit = (flagId: string, name: string | null, volume: number | null): Promise<AuditDecision> =>
  decideAudit("edit_series_audit", { p_flag: flagId, p_name: name, p_volume: volume });

/** Puts a dismissed suggestion, or one dismissed book, back. "not_eligible" means the book has a series now. */
export async function undoSeriesDismissal(d: SeriesDismissal): Promise<"restored" | "not_dismissed" | "not_eligible"> {
  const fn = d.kind === "name" ? "undo_series_dismissal" : "undo_series_book_dismissal";
  const args = d.kind === "name" ? { p_suggestion: d.suggestionId } : { p_suggestion: d.suggestionId, p_book: d.bookId };
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw error;
  const allowed = d.kind === "name" ? ["restored", "not_dismissed"] : ["restored", "not_eligible", "not_dismissed"];
  if (typeof data === "string" && allowed.includes(data)) return data as "restored" | "not_dismissed" | "not_eligible";
  throw new UnexpectedReplyError(fn);
}

/** Volumes are keyed by book id exactly as the database returned it. Returns the number of books filled. */
export async function approveSeriesSuggestion(
  id: string,
  name: string,
  volumes: Record<string, number | null>,
): Promise<number> {
  const { data, error } = await supabase.rpc("approve_series_suggestion", {
    p_suggestion: id,
    p_name: name,
    p_volumes: volumes,
  });
  if (error) throw error;
  if (typeof data !== "number") throw new UnexpectedReplyError("approve_series_suggestion");
  return data;
}

/** A suggestion that is no longer pending ("not_pending") is already gone, so it is not an error. */
export async function dismissSeriesSuggestion(id: string): Promise<void> {
  const { error } = await supabase.rpc("dismiss_series_suggestion", { p_suggestion: id });
  if (error) throw error;
}

/** Returns the new vocabulary version. An id equal to a starting tag rejects with code 23505. */
export async function createLibraryTag(
  householdId: string,
  id: string,
  label: string,
  category: LibraryTagCategory,
): Promise<number> {
  const { data, error } = await supabase.rpc("add_library_tag", {
    p_household: householdId,
    p_id: id,
    p_label: label,
    p_category: category,
  });
  if (error) throw error;
  return Number(data);
}

export async function ask(householdId: string, prompt: string, bookIds: string[]): Promise<AskResponse> {
  const { data, error } = await supabase.functions.invoke("library-ask", { body: { householdId, prompt, bookIds } });
  if (error) {
    if (isNotDeployed(error)) return { outcome: "misconfigured" };
    throw error;
  }
  const r = data as { outcome?: unknown; answerable?: unknown; note?: unknown; matches?: unknown } | null;
  if (r?.outcome === "ok" && typeof r.answerable === "boolean" && Array.isArray(r.matches)) {
    return {
      outcome: "ok",
      answerable: r.answerable,
      note: str(r.note),
      matches: (r.matches as RawRow[]).map((m) => ({
        bookId: m.bookId as string,
        confidence: Number(m.confidence),
        reason: String(m.reason),
      })),
    };
  }
  if (typeof r?.outcome === "string" && (ASK_FAILURES as readonly string[]).includes(r.outcome)) {
    return { outcome: r.outcome as (typeof ASK_FAILURES)[number] };
  }
  throw new UnexpectedReplyError("library-ask");
}
