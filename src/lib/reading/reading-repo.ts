import { readAllPages } from "@/lib/library-repo";
import { supabase } from "@/lib/supabase";
import type {
  HistoryUploadRow,
  PossibleMatch,
  ReadState,
  ReadStatusRow,
  StoredStatus,
  UploadCounts,
} from "./types";

/** `library.set_read_status` accepts at most this many ids per call. */
const SET_CHUNK = 1000;

interface StatusDbRow {
  book_id: string;
  user_id: string;
  status: StoredStatus;
  finished_on: string | null;
  source: ReadStatusRow["source"];
  marked_at: string;
}

export async function listReadStatuses(householdId: string): Promise<ReadStatusRow[]> {
  const rows = await readAllPages<StatusDbRow>((from, to) =>
    supabase
      .from("read_statuses")
      .select("book_id, user_id, status, finished_on, source, marked_at")
      .eq("household_id", householdId)
      .order("book_id")
      .order("user_id")
      .range(from, to),
  );
  return rows.map((r) => ({
    bookId: r.book_id,
    userId: r.user_id,
    status: r.status,
    finishedOn: r.finished_on,
    source: r.source,
    markedAt: r.marked_at,
  }));
}

export async function setReadStatus(
  householdId: string,
  bookIds: string[],
  status: ReadState,
  finishedOn: string | null,
  keepDates: boolean,
): Promise<{ bookId: string; outcome: string }[]> {
  const out: { bookId: string; outcome: string }[] = [];
  for (let i = 0; i < bookIds.length; i += SET_CHUNK) {
    const { data, error } = await supabase.rpc("set_read_status", {
      p_household: householdId,
      p_book_ids: bookIds.slice(i, i + SET_CHUNK),
      p_status: status,
      p_finished_on: finishedOn,
      p_keep_dates: keepDates,
    });
    if (error) throw error;
    for (const r of (data ?? []) as { book_id: string; outcome: string }[]) {
      out.push({ bookId: r.book_id, outcome: r.outcome });
    }
  }
  return out;
}

/** One RPC; the caller keeps batches to 500 rows. */
export async function uploadHistoryBatch(
  householdId: string,
  rows: HistoryUploadRow[],
): Promise<UploadCounts> {
  const { data, error } = await supabase.rpc("upload_reading_history", {
    p_household: householdId,
    p_rows: rows.map((r) => ({
      title: r.title,
      authors: r.authors,
      isbnUid: r.isbnUid,
      status: r.status,
      lastRead: r.lastRead,
    })),
  });
  if (error) throw error;
  const r = (Array.isArray(data) ? data[0] : data) as UploadCounts | null | undefined;
  if (!r) throw new Error("upload_reading_history returned no row");
  return {
    rows: Number(r.rows),
    matched: Number(r.matched),
    applied: Number(r.applied),
    possible: Number(r.possible),
    unmatched: Number(r.unmatched),
  };
}

interface HistoryEmbed {
  title: string;
  authors: string[];
}

interface CandidateDbRow {
  history_id: string;
  book_id: string;
  reason: string;
  reading_history: HistoryEmbed | HistoryEmbed[] | null;
}

/** Pending candidates for the caller's own history (RLS), with the StoryGraph title and authors. */
export async function listPossibleMatches(): Promise<PossibleMatch[]> {
  const rows = await readAllPages<CandidateDbRow>(
    (from, to) =>
      supabase
        .from("reading_history_candidates")
        .select("history_id, book_id, reason, reading_history(title, authors)")
        .eq("state", "pending")
        .order("history_id")
        .order("book_id")
        .range(from, to) as unknown as PromiseLike<{ data: CandidateDbRow[] | null; error: unknown }>,
  );
  return rows.flatMap((r) => {
    const h = Array.isArray(r.reading_history) ? r.reading_history[0] : r.reading_history;
    if (!h) return [];
    return [
      {
        historyId: r.history_id,
        bookId: r.book_id,
        reason: r.reason,
        sgTitle: h.title,
        sgAuthors: h.authors ?? [],
      },
    ];
  });
}

export async function countUnmatchedHistory(householdId: string): Promise<number> {
  const { count, error } = await supabase
    .from("reading_history")
    .select("id", { count: "exact", head: true })
    .eq("household_id", householdId)
    .eq("match_state", "unmatched");
  if (error) throw error;
  return count ?? 0;
}

export async function linkHistory(historyId: string, bookId: string): Promise<"linked" | "not_found"> {
  const { data, error } = await supabase.rpc("link_reading_history", { p_history: historyId, p_book: bookId });
  if (error) throw error;
  return data as "linked" | "not_found";
}

export async function dismissMatch(historyId: string, bookId: string): Promise<"dismissed" | "not_found"> {
  const { data, error } = await supabase.rpc("dismiss_reading_match", { p_history: historyId, p_book: bookId });
  if (error) throw error;
  return data as "dismissed" | "not_found";
}
