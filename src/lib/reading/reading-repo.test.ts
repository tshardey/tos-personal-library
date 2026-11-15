import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  queries: [] as { table: string; steps: [string, unknown[]][] }[],
  results: [] as { data?: unknown; count?: number | null; error: unknown }[],
  rpcCalls: [] as [string, Record<string, unknown>][],
  rpcResults: [] as { data: unknown; error: unknown }[],
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from(table: string) {
      const query = { table, steps: [] as [string, unknown[]][] };
      h.queries.push(query);
      const builder: Record<string, unknown> = {
        then(resolve: (v: unknown) => void, reject: (e: unknown) => void) {
          const next = h.results.shift();
          if (next) resolve(next);
          else reject(new Error("no result queued"));
        },
      };
      for (const method of ["select", "eq", "order", "range"]) {
        builder[method] = (...args: unknown[]) => {
          query.steps.push([method, args]);
          return builder;
        };
      }
      return builder;
    },
    rpc(name: string, args: Record<string, unknown>) {
      h.rpcCalls.push([name, args]);
      return Promise.resolve(h.rpcResults.shift() ?? { data: null, error: null });
    },
  },
}));

import {
  countUnmatchedHistory,
  dismissMatch,
  linkHistory,
  listPossibleMatches,
  listReadStatuses,
  setReadStatus,
  uploadHistoryBatch,
} from "./reading-repo";

beforeEach(() => {
  h.queries.length = 0;
  h.results.length = 0;
  h.rpcCalls.length = 0;
  h.rpcResults.length = 0;
});

const ids = (n: number) => Array.from({ length: n }, (_, i) => `book-${i}`);

describe("setReadStatus", () => {
  it("chunks 1,500 ids into two calls carrying status, date and keep flag", async () => {
    h.rpcResults.push(
      { data: ids(1000).map((b) => ({ book_id: b, outcome: "set" })), error: null },
      { data: ids(500).map((b) => ({ book_id: b, outcome: "set" })), error: null },
    );
    const out = await setReadStatus("hh", ids(1500), "read", "2026-03-04", true);
    expect(h.rpcCalls).toHaveLength(2);
    expect(h.rpcCalls[0][0]).toBe("set_read_status");
    expect(h.rpcCalls[0][1]).toMatchObject({
      p_household: "hh",
      p_status: "read",
      p_finished_on: "2026-03-04",
      p_keep_dates: true,
    });
    expect((h.rpcCalls[0][1].p_book_ids as string[]).length).toBe(1000);
    expect((h.rpcCalls[1][1].p_book_ids as string[]).length).toBe(500);
    expect(out).toHaveLength(1500);
    expect(out[0]).toEqual({ bookId: "book-0", outcome: "set" });
  });

  it("sends unread as unread", async () => {
    await setReadStatus("hh", ["b"], "unread", null, false);
    expect(h.rpcCalls[0][1]).toMatchObject({ p_status: "unread", p_finished_on: null, p_keep_dates: false });
  });

  it("rejects on an RPC error", async () => {
    h.rpcResults.push({ data: null, error: new Error("boom") });
    await expect(setReadStatus("hh", ["b"], "dnf", null, false)).rejects.toThrow("boom");
  });
});

describe("uploadHistoryBatch", () => {
  it("sends exactly the five fields and maps the counts", async () => {
    h.rpcResults.push({
      data: [{ rows: 1, matched: 1, applied: 1, possible: 0, unmatched: 0 }],
      error: null,
    });
    const row = {
      title: "The Salt Road",
      authors: ["Petra Wynnecombe"],
      isbnUid: "9780000000026",
      status: "read" as const,
      lastRead: "2026-01-02",
      extra: "leak",
    };
    const counts = await uploadHistoryBatch("hh", [row]);
    expect(h.rpcCalls[0][0]).toBe("upload_reading_history");
    const sent = (h.rpcCalls[0][1].p_rows as Record<string, unknown>[])[0];
    expect(Object.keys(sent).sort()).toEqual(["authors", "isbnUid", "lastRead", "status", "title"]);
    expect(counts).toEqual({ rows: 1, matched: 1, applied: 1, possible: 0, unmatched: 0 });
  });

  it("rejects on an RPC error", async () => {
    h.rpcResults.push({ data: null, error: new Error("nope") });
    await expect(uploadHistoryBatch("hh", [])).rejects.toThrow("nope");
  });
});

describe("listReadStatuses", () => {
  it("pages until an empty page and maps rows", async () => {
    const page = Array.from({ length: 1000 }, (_, i) => ({
      book_id: `b${i}`,
      user_id: "a",
      status: "read",
      finished_on: null,
      source: "app",
      marked_at: "t",
    }));
    h.results.push({ data: page, error: null }, { data: page.slice(0, 5), error: null }, { data: [], error: null });
    const rows = await listReadStatuses("hh");
    expect(rows).toHaveLength(1005);
    expect(rows[0]).toMatchObject({ bookId: "b0", userId: "a", status: "read", finishedOn: null });
    expect(h.queries.length).toBeGreaterThanOrEqual(2);
    expect(h.queries[0].table).toBe("read_statuses");
    expect(h.queries[0].steps.filter(([m]) => m === "order").map(([, a]) => a[0])).toEqual(["book_id", "user_id"]);
  });
});

describe("listPossibleMatches", () => {
  it("maps pending candidates joined to history", async () => {
    h.results.push(
      {
        data: [
          {
            history_id: "h1",
            book_id: "b1",
            reason: "several_books",
            reading_history: { title: "The Salt Road", authors: ["Petra Wynnecombe"] },
          },
          { history_id: "h2", book_id: "b2", reason: "title_prefix", reading_history: null },
        ],
        error: null,
      },
      { data: [], error: null },
    );
    expect(await listPossibleMatches()).toEqual([
      {
        historyId: "h1",
        bookId: "b1",
        reason: "several_books",
        sgTitle: "The Salt Road",
        sgAuthors: ["Petra Wynnecombe"],
      },
    ]);
    expect(h.queries[0].steps).toContainEqual(["eq", ["state", "pending"]]);
  });
});

describe("countUnmatchedHistory", () => {
  it("head-counts unmatched rows in the household", async () => {
    h.results.push({ count: 7, error: null });
    expect(await countUnmatchedHistory("hh")).toBe(7);
    expect(h.queries[0].table).toBe("reading_history");
    expect(h.queries[0].steps[0]).toEqual(["select", ["id", { count: "exact", head: true }]]);
    expect(h.queries[0].steps).toContainEqual(["eq", ["match_state", "unmatched"]]);
  });
  it("rejects on error", async () => {
    h.results.push({ count: null, error: new Error("x") });
    await expect(countUnmatchedHistory("hh")).rejects.toThrow("x");
  });
});

describe("linkHistory / dismissMatch", () => {
  it("returns the RPC outcome", async () => {
    h.rpcResults.push({ data: "linked", error: null }, { data: "not_found", error: null });
    expect(await linkHistory("h", "b")).toBe("linked");
    expect(await dismissMatch("h", "b")).toBe("not_found");
    expect(h.rpcCalls[0]).toEqual(["link_reading_history", { p_history: "h", p_book: "b" }]);
    expect(h.rpcCalls[1]).toEqual(["dismiss_reading_match", { p_history: "h", p_book: "b" }]);
  });
});
