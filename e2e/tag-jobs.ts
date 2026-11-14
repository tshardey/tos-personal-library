import { supabaseEnv, type TestUser } from "./supabase";

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
  const [row] = await rpc<{ claim_token: string }[]>(user, "claim_tag_job", { p_job: job.id });
  return row.claim_token;
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
  for (const j of jobs) {
    await rpc(user, "finish_tag_job", {
      p_job: j.id,
      p_claim: await claim(user, j),
      p_result: { summary: "An invented tale for the end-to-end tests.", tos: [], library: [], suggestions: [] },
      p_usage: null,
      p_cost_micro: 0,
      p_model: "e2e-fake",
    });
  }
}
