import { rest, supabaseEnv, type TestUser } from "./supabase";

/** Inserts rows into a `library` table as that user (local stack, RLS applies). */
export async function insert<T>(user: TestUser, table: string, rows: unknown[]): Promise<T[]> {
  const { url, key } = supabaseEnv();
  const res = await fetch(`${url}/rest/v1/${table}`, {
    method: "POST",
    headers: {
      apikey: key,
      Authorization: `Bearer ${user.accessToken}`,
      "Content-Type": "application/json",
      "Content-Profile": "library",
      Prefer: "return=representation",
    },
    body: JSON.stringify(rows),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`POST ${table} answered ${res.status}: ${text}`);
  return JSON.parse(text) as T[];
}

export interface JobRow {
  id: string;
  book_id: string;
  reason: string;
  status: string;
}

/** Calls a `library` RPC as that user (local stack). */
export async function rpc<T>(user: TestUser, name: string, args: unknown): Promise<T> {
  const { url, key } = supabaseEnv();
  const res = await fetch(`${url}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: {
      apikey: key,
      Authorization: `Bearer ${user.accessToken}`,
      "Content-Type": "application/json",
      "Content-Profile": "library",
    },
    body: JSON.stringify(args),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`rpc ${name} answered ${res.status}: ${text}`);
  return JSON.parse(text) as T;
}

async function claim(user: TestUser, job: JobRow): Promise<string> {
  const [row] = await rpc<{ outcome: string; claim_token: string }[]>(user, "claim_tag_job", { p_job: job.id });
  if (row.outcome !== "audit") return row.claim_token;
  // An audit job is claimed in two steps: claim_tag_job answers `audit`, and claim_audit_job reserves and returns the token.
  const [audit] = await rpc<{ claim_token: string }[]>(user, "claim_audit_job", { p_job: job.id });
  return audit.claim_token;
}

/** New books queue themselves; claim and refuse each open job so the book has none (its newest job is failed). */
export async function closeOpenJobs(user: TestUser, jobs: JobRow[]): Promise<void> {
  for (const j of jobs) {
    await rpc(user, "release_tag_job", {
      p_job: j.id,
      p_claim: await claim(user, j),
      p_error: "tag_refused",
      p_retry_at: null,
      p_usage: null,
      p_cost_micro: 0,
    });
  }
}

/** Claims and finishes each open job with a made-up summary and no tags, at no cost: the book is tagged (done, with a card). */
export async function finishOpenJobs(user: TestUser, jobs: JobRow[]): Promise<void> {
  await finishOpenJobsWith(user, jobs, () => ({}));
}

/**
 * Like `finishOpenJobs`, with `resultFor(bookId)` merged into each job's result (a `series` key, say).
 * The e2e stack's fake tagger: claimed and finished over RPC as the user, at no cost, with no function and no API.
 */
export async function finishOpenJobsWith(
  user: TestUser,
  jobs: JobRow[],
  resultFor: (bookId: string) => object,
): Promise<void> {
  for (const j of jobs) {
    await rpc(user, "finish_tag_job", {
      p_job: j.id,
      p_claim: await claim(user, j),
      p_result: resultPayload(resultFor(j.book_id)),
      p_usage: null,
      p_cost_micro: 0,
      p_model: "e2e-fake",
    });
  }
}

/** An audit result is sent as the audit payload (no `series` key); anything else gets a made-up summary. */
function resultPayload(result: object): object {
  if ("audit" in result) {
    return { tos: [], library: [], summary: null, coverDescription: null, coverSeen: false, suggestions: [], ...result };
  }
  return { summary: "An invented tale for the end-to-end tests.", tos: [], library: [], suggestions: [], ...result };
}

export interface AuditSeed {
  title: string;
  authors?: string[];
  /** The series the book already has (tagger-filled: not in user_edited_fields). */
  series: string;
  volume: number | null;
  /** The audit's answer, as the finish payload's `audit` object. */
  audit: { verdict: string; name: string | null; volume: number | null; why: string };
}

const JOB_FIELDS = "id,book_id,reason,status";

/**
 * Books that carry a series, a card and one finished audit each, so each audit that disagrees leaves a pending flag.
 * The jobs go over RPC as the user (no function, no API). Returns each title's book id.
 */
export async function seedAuditFlags(user: TestUser, seeds: AuditSeed[]): Promise<Record<string, string>> {
  const books = await insert<{ id: string; title: string }>(
    user,
    "books",
    seeds.map((s) => ({
      household_id: user.householdId,
      title: s.title,
      authors: s.authors ?? ["Ines Dravenholt"],
      series_name: s.series,
      series_volume: s.volume,
    })),
  );
  const ids = books.map((b) => b.id).join(",");
  await finishOpenJobs(user, await rest<JobRow[]>(user, `tag_jobs?select=${JOB_FIELDS}&book_id=in.(${ids})`));
  await rpc(user, "request_tagging", { p_household: user.householdId, p_book_ids: books.map((b) => b.id), p_reason: "audit", p_run: null });
  const audits = await rest<JobRow[]>(user, `tag_jobs?select=${JOB_FIELDS}&kind=eq.audit&status=eq.queued&book_id=in.(${ids})`);
  const byId = new Map(books.map((b) => [b.id, b.title]));
  await finishOpenJobsWith(user, audits, (bookId) => ({ audit: seeds.find((s) => s.title === byId.get(bookId))!.audit }));
  return Object.fromEntries(books.map((b) => [b.title, b.id]));
}

/**
 * One dismissed name (a new series) and one dismissed book (an existing-series suggestion), for the Dismissed list.
 * Invented names only.
 */
export async function seedDismissals(user: TestUser): Promise<void> {
  const books = await insert<{ id: string; title: string }>(user, "books", [
    { household_id: user.householdId, title: "Loom Ember One", authors: ["Petra Wynnecombe"], series_name: null, series_volume: null },
    { household_id: user.householdId, title: "Wrenfold Anchor", authors: ["M. Holt"], series_name: "Wrenfold Tales", series_volume: 1 },
    { household_id: user.householdId, title: "Wrenfold Stray", authors: ["A. Reed"], series_name: null, series_volume: null },
  ]);
  const id = (title: string) => books.find((b) => b.title === title)!.id;
  const ids = books.map((b) => b.id).join(",");
  const open = await rest<JobRow[]>(user, `tag_jobs?select=${JOB_FIELDS}&book_id=in.(${ids})`);
  await closeOpenJobs(user, open.filter((j) => j.book_id === id("Wrenfold Anchor")));
  await finishOpenJobsWith(user, open.filter((j) => j.book_id !== id("Wrenfold Anchor")), (bookId) =>
    bookId === id("Loom Ember One")
      ? { series: { name: "Ember Loom", volume: 1, why: "w" }, seriesStatus: "found" }
      : { series: { name: "Wrenfold Tales", volume: 2, why: "w" }, seriesStatus: "found" },
  );
  const pending = await rest<{ id: string }[]>(user, "series_suggestions?select=id&status=eq.pending&name=in.(%22Ember%20Loom%22,%22Wrenfold%20Tales%22)");
  for (const s of pending) await rpc(user, "dismiss_series_suggestion", { p_suggestion: s.id });
}
