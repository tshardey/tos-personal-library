import { FunctionsFetchError, FunctionsHttpError, FunctionsRelayError } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  queries: [] as { table: string; steps: [string, unknown[]][] }[],
  results: [] as { data: unknown; error: unknown }[],
  rpcCalls: [] as [string, unknown][],
  rpcResults: [] as { data: unknown; error: unknown }[],
  invoke: vi.fn(),
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
      for (const method of ["select", "eq", "or", "order", "range", "in"]) {
        builder[method] = (...args: unknown[]) => {
          query.steps.push([method, args]);
          return builder;
        };
      }
      return builder;
    },
    rpc(name: string, args: unknown) {
      h.rpcCalls.push([name, args]);
      return Promise.resolve(h.rpcResults.shift() ?? { data: null, error: null });
    },
    functions: { invoke: h.invoke },
  },
}));

import {
  applyCover,
  dismissCoverSearch,
  getCoverBudget,
  markResultsSeen,
  recordCoverCandidates,
  isMissingFeature,
  listCoverMarks,
  listCoverSearches,
  markForCover,
  requestCoverSearches,
  screenSearch,
  unmarkForCover,
} from "./cover-repo";

const BOOK = "00000000-0000-4000-8000-000000000001";
const SEARCH = "00000000-0000-4000-8000-000000000002";
const HOUSEHOLD = "00000000-0000-4000-8000-000000000003";
const COVER = "https://covers.openlibrary.org/b/id/1000001-L.jpg";

beforeEach(() => {
  h.queries.length = 0;
  h.results.length = 0;
  h.rpcCalls.length = 0;
  h.rpcResults.length = 0;
  h.invoke.mockReset();
});

const row = (over: Record<string, unknown> = {}) => ({
  id: SEARCH,
  household_id: HOUSEHOLD,
  book_id: BOOK,
  requested_by: null,
  batch_id: "00000000-0000-4000-8000-000000000004",
  reasons: ["placeholder", "bogus"],
  note: null,
  cover_at_request: null,
  status: "ready",
  attempts: 1,
  claimed_at: null,
  retry_at: null,
  candidates: [
    { url: COVER, source: "openlibrary", width: 400, height: 600, language: "eng", editionTitle: "The Salt Road" },
  ],
  results: [{ url: COVER, source: "openlibrary", width: 400, height: 600 }],
  error_code: null,
  seen_at: null,
  created_at: "2026-11-12T00:00:00Z",
  book: { title: "The Salt Road", authors: ["Wren Halloway"], isbn13: ["9780000000019"], isbn10: [], cover_url: null },
  ...over,
});

describe("listCoverSearches", () => {
  it("selects without claim_token, embeds the book, filters active rows and maps snake_case", async () => {
    h.results.push({ data: [row()], error: null }, { data: [], error: null });
    const out = await listCoverSearches(HOUSEHOLD);
    const select = h.queries[0].steps.find(([m]) => m === "select")![1][0] as string;
    expect(select).not.toContain("claim_token");
    expect(select).toContain("book:books(title, authors, isbn13, isbn10, cover_url)");
    expect(h.queries[0].steps).toContainEqual([
      "in",
      ["status", ["queued", "gathered", "processing", "ready", "nothing_found", "failed"]],
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      id: SEARCH,
      householdId: HOUSEHOLD,
      bookId: BOOK,
      status: "ready",
      reasons: ["placeholder"],
      book: { title: "The Salt Road", authors: ["Wren Halloway"], coverUrl: null },
      results: [{ url: COVER, source: "openlibrary", width: 400, height: 600 }],
    });
    expect(out[0].candidates?.[0].editionTitle).toBe("The Salt Road");
  });

  it("makes candidates null when one lacks a url", async () => {
    h.results.push(
      { data: [row({ candidates: [{ source: "google", width: 1, height: 1 }] })], error: null },
      { data: [], error: null },
    );
    expect((await listCoverSearches(HOUSEHOLD))[0].candidates).toBeNull();
  });
});

describe("listCoverMarks", () => {
  it("maps rows by book id", async () => {
    h.results.push(
      {
        data: [{ book_id: BOOK, reasons: ["low_quality", "x"], note: "blurry", marked_by: null, marked_at: "t" }],
        error: null,
      },
      { data: [], error: null },
    );
    const marks = await listCoverMarks(HOUSEHOLD);
    expect(marks.get(BOOK)).toEqual({
      bookId: BOOK,
      reasons: ["low_quality"],
      note: "blurry",
      markedBy: null,
      markedAt: "t",
    });
  });
});

describe("getCoverBudget", () => {
  it("reads the first row of cover_budget", async () => {
    h.rpcResults.push({
      data: [
        {
          month: "2026-11-01",
          spent_micro: 5,
          budget_micro: 100,
          reserve_micro: 4300,
          global_spent_micro: 9,
          global_budget_micro: 500,
        },
      ],
      error: null,
    });
    expect(await getCoverBudget(HOUSEHOLD)).toEqual({
      month: "2026-11-01",
      spentMicro: 5,
      budgetMicro: 100,
      reserveMicro: 4300,
      globalSpentMicro: 9,
      globalBudgetMicro: 500,
    });
    expect(h.rpcCalls[0]).toEqual(["cover_budget", { p_household: HOUSEHOLD }]);
  });
});

describe("markForCover", () => {
  it("sends p_note null for blank notes and does not clip", async () => {
    await markForCover(BOOK, ["placeholder"], "");
    await markForCover(BOOK, ["placeholder"], "   ");
    const long = "x".repeat(600);
    await markForCover(BOOK, ["placeholder"], long);
    expect(h.rpcCalls[0]).toEqual(["mark_for_cover", { p_book: BOOK, p_reasons: ["placeholder"], p_note: null }]);
    expect((h.rpcCalls[1][1] as { p_note: unknown }).p_note).toBeNull();
    expect((h.rpcCalls[2][1] as { p_note: string }).p_note).toBe(long);
  });

  it("rejects on error, keeping the code", async () => {
    h.rpcResults.push({ data: null, error: { code: "42501", message: "no" } });
    await expect(markForCover(BOOK, [], null)).rejects.toMatchObject({ code: "42501" });
  });
});

describe("unmarkForCover", () => {
  it("returns the boolean", async () => {
    h.rpcResults.push({ data: true, error: null });
    expect(await unmarkForCover(BOOK)).toBe(true);
  });
});

describe("requestCoverSearches", () => {
  it("chunks 1500 ids into two RPC calls and merges the outcomes", async () => {
    const ids = Array.from({ length: 1500 }, (_, i) => `id-${i}`);
    h.rpcResults.push(
      { data: ids.slice(0, 1000).map((book_id) => ({ book_id, outcome: "queued" })), error: null },
      { data: ids.slice(1000).map((book_id) => ({ book_id, outcome: "already_open" })), error: null },
    );
    const out = await requestCoverSearches(HOUSEHOLD, ids, "batch", true);
    expect(h.rpcCalls).toHaveLength(2);
    expect((h.rpcCalls[0][1] as { p_book_ids: string[] }).p_book_ids).toHaveLength(1000);
    expect((h.rpcCalls[1][1] as { p_book_ids: string[] }).p_book_ids).toHaveLength(500);
    expect(h.rpcCalls[0][1]).toMatchObject({ p_household: HOUSEHOLD, p_batch: "batch", p_manual: true });
    expect(out.size).toBe(1500);
    expect(out.get("id-0")).toBe("queued");
    expect(out.get("id-1499")).toBe("already_open");
  });
});

describe("screenSearch", () => {
  it.each(["ready", "nothing_found", "busy", "budget", "billing", "rejected"])(
    "resolves %s from the body",
    async (o) => {
      h.invoke.mockResolvedValue({ data: { outcome: o }, error: null });
      expect(await screenSearch(SEARCH)).toBe(o);
      expect(h.invoke).toHaveBeenCalledWith("library-covers", { body: { searchId: SEARCH } });
    },
  );

  it("maps a 404 FunctionsHttpError to misconfigured", async () => {
    h.invoke.mockResolvedValue({ data: null, error: new FunctionsHttpError(new Response(null, { status: 404 })) });
    expect(await screenSearch(SEARCH)).toBe("misconfigured");
  });

  it("maps a 503, a relay error or a fetch error to unavailable", async () => {
    h.invoke.mockResolvedValue({ data: null, error: new FunctionsHttpError(new Response(null, { status: 503 })) });
    expect(await screenSearch(SEARCH)).toBe("unavailable");
    h.invoke.mockResolvedValue({ data: null, error: new FunctionsHttpError(new Response(null, { status: 500 })) });
    expect(await screenSearch(SEARCH)).toBe("unavailable");
    h.invoke.mockResolvedValue({ data: null, error: new FunctionsFetchError(new TypeError("Failed to fetch")) });
    expect(await screenSearch(SEARCH)).toBe("unavailable");
    h.invoke.mockResolvedValue({ data: null, error: new FunctionsRelayError(new Response(null, { status: 502 })) });
    expect(await screenSearch(SEARCH)).toBe("unavailable");
  });

  it("maps a 404 relay error to misconfigured", async () => {
    h.invoke.mockResolvedValue({ data: null, error: new FunctionsRelayError(new Response(null, { status: 404 })) });
    expect(await screenSearch(SEARCH)).toBe("misconfigured");
  });

  it("rejects on other HTTP errors and a thrown invoke", async () => {
    h.invoke.mockResolvedValue({ data: null, error: new FunctionsHttpError(new Response(null, { status: 400 })) });
    await expect(screenSearch(SEARCH)).rejects.toBeInstanceOf(FunctionsHttpError);
    h.invoke.mockRejectedValue(new Error("network"));
    await expect(screenSearch(SEARCH)).rejects.toThrow("network");
  });
});

describe("applyCover", () => {
  it("sends p_expected_cover null for a coverless book", async () => {
    h.rpcResults.push({ data: "applied", error: null });
    expect(await applyCover(SEARCH, COVER, null)).toBe("applied");
    expect(h.rpcCalls[0]).toEqual(["apply_cover", { p_search: SEARCH, p_url: COVER, p_expected_cover: null }]);
  });

  it("maps 42501 to not_ready and rejects other errors", async () => {
    h.rpcResults.push({ data: null, error: { code: "42501", message: "x" } });
    expect(await applyCover(SEARCH, COVER, null)).toBe("not_ready");
    h.rpcResults.push({ data: null, error: { code: "XX000", message: "x" } });
    await expect(applyCover(SEARCH, COVER, null)).rejects.toMatchObject({ code: "XX000" });
  });
});

describe("isMissingFeature", () => {
  it("is true for missing relation/table/function codes only", () => {
    expect(isMissingFeature({ code: "42P01" })).toBe(true);
    expect(isMissingFeature({ code: "PGRST205" })).toBe(true);
    expect(isMissingFeature({ code: "PGRST202" })).toBe(true);
    expect(isMissingFeature({ code: "42501" })).toBe(false);
    expect(isMissingFeature(null)).toBe(false);
  });
});

describe("unexpected replies", () => {
  it("screenSearch rejects on a null body or an unknown outcome", async () => {
    h.invoke.mockResolvedValue({ data: null, error: null });
    await expect(screenSearch(SEARCH)).rejects.toMatchObject({ code: "unexpected_reply" });
    h.invoke.mockResolvedValue({ data: { outcome: "weird" }, error: null });
    await expect(screenSearch(SEARCH)).rejects.toMatchObject({ code: "unexpected_reply" });
    // "unavailable" is the client's own outcome, never a reply.
    h.invoke.mockResolvedValue({ data: { outcome: "unavailable" }, error: null });
    await expect(screenSearch(SEARCH)).rejects.toMatchObject({ code: "unexpected_reply" });
  });

  it("recordCoverCandidates validates and passes outcomes through", async () => {
    h.rpcResults.push({ data: "gathered", error: null });
    expect(await recordCoverCandidates(SEARCH, [])).toBe("gathered");
    expect(h.rpcCalls[0]).toEqual(["record_cover_candidates", { p_search: SEARCH, p_candidates: [] }]);
    h.rpcResults.push({ data: "bogus", error: null });
    await expect(recordCoverCandidates(SEARCH, [])).rejects.toMatchObject({ code: "unexpected_reply" });
    h.rpcResults.push({ data: null, error: null });
    await expect(recordCoverCandidates(SEARCH, [])).rejects.toMatchObject({ code: "unexpected_reply" });
  });

  it("applyCover rejects on an unexpected value", async () => {
    h.rpcResults.push({ data: "bogus", error: null });
    await expect(applyCover(SEARCH, COVER, null)).rejects.toMatchObject({ code: "unexpected_reply" });
    h.rpcResults.push({ data: null, error: null });
    await expect(applyCover(SEARCH, COVER, null)).rejects.toMatchObject({ code: "unexpected_reply" });
  });

  it("dismissCoverSearch validates and passes outcomes through", async () => {
    h.rpcResults.push({ data: "dismissed", error: null });
    expect(await dismissCoverSearch(SEARCH)).toBe("dismissed");
    h.rpcResults.push({ data: "not_ready", error: null });
    expect(await dismissCoverSearch(SEARCH)).toBe("not_ready");
    h.rpcResults.push({ data: "bogus", error: null });
    await expect(dismissCoverSearch(SEARCH)).rejects.toMatchObject({ code: "unexpected_reply" });
    h.rpcResults.push({ data: null, error: null });
    await expect(dismissCoverSearch(SEARCH)).rejects.toMatchObject({ code: "unexpected_reply" });
  });

  it("markResultsSeen short-circuits on empty and returns the count", async () => {
    expect(await markResultsSeen([])).toBe(0);
    expect(h.rpcCalls).toHaveLength(0);
    h.rpcResults.push({ data: 2, error: null });
    expect(await markResultsSeen([SEARCH, BOOK])).toBe(2);
    expect(h.rpcCalls[0]).toEqual(["mark_cover_results_seen", { p_searches: [SEARCH, BOOK] }]);
  });
});
