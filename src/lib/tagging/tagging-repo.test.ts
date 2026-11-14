import { FunctionsFetchError, FunctionsHttpError } from "@supabase/supabase-js";
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
      for (const method of ["select", "eq", "or", "order", "range", "in", "upsert", "delete"]) {
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

import { formatUsd, remainingMicro, budgetUsedUp } from "@/lib/covers/cost";
import {
  addLibraryTag,
  approveSuggestion,
  ask,
  createLibraryTag,
  dismissSuggestion,
  getAiBudget,
  listCardMeta,
  listLibraryTagsByBook,
  listSuggestions,
  listTagJobs,
  listVocabulary,
  removeLibraryTag,
  requestTagging,
  runTagJob,
} from "./tagging-repo";
import { LIBRARY_TAG_CATEGORIES } from "./types";

const HOUSEHOLD = "00000000-0000-4000-8000-000000000003";
const BOOK = "00000000-0000-4000-8000-000000000001";
const JOB = "00000000-0000-4000-8000-000000000002";

beforeEach(() => {
  h.queries.length = 0;
  h.results.length = 0;
  h.rpcCalls.length = 0;
  h.rpcResults.length = 0;
  h.invoke.mockReset();
});

const http = (status: number) => new FunctionsHttpError(new Response("{}", { status }));

describe("categories", () => {
  it("lists the thirteen categories in display order", () => {
    expect(LIBRARY_TAG_CATEGORIES.map((c) => c.id)).toEqual([
      "trope", "creature", "setting", "era", "theme", "mood", "plot", "protagonist",
      "audience", "subgenre", "cover-colour", "cover-motif", "fact",
    ]);
    expect(LIBRARY_TAG_CATEGORIES[1].label).toBe("Creatures and beings");
    expect(LIBRARY_TAG_CATEGORIES[5].label).toBe("Mood and pace");
  });
});

describe("listVocabulary", () => {
  it("maps snake_case rows and reads the starting and household rows", async () => {
    h.results.push({
      data: [
        { id: "found-family", label: "Found family", category: "trope", active: true, added_version: 1, household_id: null },
        { id: "salt-magic", label: "Salt magic", category: "theme", active: false, added_version: 3, household_id: HOUSEHOLD },
      ],
      error: null,
    });
    h.results.push({ data: [], error: null });
    const tags = await listVocabulary(HOUSEHOLD);
    expect(tags).toEqual([
      { id: "found-family", label: "Found family", category: "trope", active: true, addedVersion: 1, householdId: null },
      { id: "salt-magic", label: "Salt magic", category: "theme", active: false, addedVersion: 3, householdId: HOUSEHOLD },
    ]);
    expect(h.queries[0].table).toBe("library_tags");
    expect(h.queries[0].steps).toContainEqual(["or", [`household_id.is.null,household_id.eq.${HOUSEHOLD}`]]);
  });
});

describe("listLibraryTagsByBook", () => {
  it("groups tag ids per book", async () => {
    h.results.push({
      data: [
        { book_id: "b1", tag_id: "a" },
        { book_id: "b1", tag_id: "b" },
        { book_id: "b2", tag_id: "a" },
      ],
      error: null,
    });
    h.results.push({ data: [], error: null });
    const map = await listLibraryTagsByBook(HOUSEHOLD);
    expect(map.get("b1")).toEqual(["a", "b"]);
    expect(map.get("b2")).toEqual(["a"]);
    expect(h.queries[0].table).toBe("book_library_tags");
  });

  it("rejects when any page fails", async () => {
    h.results.push({ data: Array.from({ length: 1000 }, (_, i) => ({ book_id: `b${i}`, tag_id: "a" })), error: null });
    h.results.push({ data: null, error: { code: "57014", message: "timeout" } });
    await expect(listLibraryTagsByBook(HOUSEHOLD)).rejects.toMatchObject({ code: "57014" });
  });
});

describe("addLibraryTag and removeLibraryTag", () => {
  it("upserts ignoring duplicates", async () => {
    h.results.push({ data: null, error: null });
    await addLibraryTag(BOOK, HOUSEHOLD, "found-family");
    expect(h.queries[0].table).toBe("book_library_tags");
    expect(h.queries[0].steps[0]).toEqual([
      "upsert",
      [
        { book_id: BOOK, household_id: HOUSEHOLD, tag_id: "found-family" },
        { onConflict: "book_id,tag_id", ignoreDuplicates: true },
      ],
    ]);
  });

  it("keeps the error code on a failed delete", async () => {
    h.results.push({ data: null, error: { code: "42501" } });
    await expect(removeLibraryTag(BOOK, "a")).rejects.toMatchObject({ code: "42501" });
  });
});

describe("listCardMeta", () => {
  it("maps cards by book id", async () => {
    h.results.push({ data: [{ book_id: BOOK, vocab_version: 4, written_at: "2026-11-14T00:00:00Z" }], error: null });
    h.results.push({ data: [], error: null });
    const map = await listCardMeta(HOUSEHOLD);
    expect(map.get(BOOK)).toEqual({ bookId: BOOK, vocabVersion: 4, writtenAt: "2026-11-14T00:00:00Z" });
  });
});

describe("listTagJobs", () => {
  const job = (over: Record<string, unknown>) => ({
    id: JOB,
    book_id: BOOK,
    run_id: null,
    kind: "full",
    reason: "run",
    status: "queued",
    attempts: 0,
    claimed_at: null,
    retry_at: null,
    error_code: null,
    created_at: "2026-11-14T00:00:00Z",
    ...over,
  });

  it("never selects claim_token and maps rows", async () => {
    h.results.push({ data: [job({ status: "failed", error_code: "tag_refused", attempts: 1 })], error: null });
    h.results.push({ data: [], error: null });
    const jobs = await listTagJobs(HOUSEHOLD);
    expect(jobs[0]).toEqual({
      id: JOB, bookId: BOOK, runId: null, kind: "full", reason: "run", status: "failed", attempts: 1,
      claimedAt: null, retryAt: null, errorCode: "tag_refused", createdAt: "2026-11-14T00:00:00Z",
    });
    const select = h.queries[0].steps.find(([m]) => m === "select")![1][0] as string;
    expect(select).not.toContain("claim_token");
    expect(select).not.toContain("*");
  });

  it("returns only the newer done job when an older one failed", async () => {
    h.results.push({
      data: [
        job({ id: "done", status: "done", created_at: "2026-11-14T02:00:00Z" }),
        job({ id: "old", status: "failed", created_at: "2026-11-14T01:00:00Z" }),
      ],
      error: null,
    });
    h.results.push({ data: [], error: null });
    expect((await listTagJobs(HOUSEHOLD)).map((j) => j.id)).toEqual(["done"]);
  });

  it("returns only the queued job when it is newer than a failed one", async () => {
    h.results.push({
      data: [
        job({ id: "q", status: "queued", created_at: "2026-11-14T02:00:00Z" }),
        job({ id: "old", status: "failed", created_at: "2026-11-14T01:00:00Z" }),
      ],
      error: null,
    });
    h.results.push({ data: [], error: null });
    expect((await listTagJobs(HOUSEHOLD)).map((j) => j.id)).toEqual(["q"]);
  });

  it("keeps an open job even when a newer job exists, and one job per other book", async () => {
    h.results.push({
      data: [
        job({ id: "f", status: "failed", created_at: "2026-11-14T03:00:00Z" }),
        job({ id: "q", status: "queued", created_at: "2026-11-14T02:00:00Z" }),
        job({ id: "other", book_id: "b2", status: "done" }),
      ],
      error: null,
    });
    h.results.push({ data: [], error: null });
    expect((await listTagJobs(HOUSEHOLD)).map((j) => j.id)).toEqual(["f", "q", "other"]);
  });

  it("rejects when a page fails", async () => {
    h.results.push({ data: Array.from({ length: 1000 }, (_, i) => job({ id: `j${i}`, book_id: `b${i}` })), error: null });
    h.results.push({ data: null, error: { code: "57014" } });
    await expect(listTagJobs(HOUSEHOLD)).rejects.toMatchObject({ code: "57014" });
  });
});

describe("getAiBudget", () => {
  it("maps the row and fits the cover cost helpers", async () => {
    h.rpcResults.push({
      data: [{
        month: "2026-11-01", spent_micro: "1000000", budget_micro: "5000000", reserve_micro: 2000,
        global_spent_micro: "1000000", global_budget_micro: "5000000",
      }],
      error: null,
    });
    const b = await getAiBudget(HOUSEHOLD, "tagging");
    expect(h.rpcCalls[0]).toEqual(["ai_budget", { p_household: HOUSEHOLD, p_feature: "tagging" }]);
    expect(b.spentMicro).toBe(1_000_000);
    expect(remainingMicro(b)).toBe(4_000_000);
    expect(budgetUsedUp(b)).toBe(false);
    expect(formatUsd(remainingMicro(b))).toBe("$4.00");
  });

  it("rejects on an rpc error", async () => {
    h.rpcResults.push({ data: null, error: { code: "42501" } });
    await expect(getAiBudget(HOUSEHOLD, "ask")).rejects.toMatchObject({ code: "42501" });
  });
});

describe("requestTagging", () => {
  it("calls the rpc once per 1000 ids and merges outcomes", async () => {
    const ids = Array.from({ length: 1500 }, (_, i) => `b${i}`);
    h.rpcResults.push({ data: [{ book_id: "b0", outcome: "queued" }], error: null });
    h.rpcResults.push({ data: [{ book_id: "b1400", outcome: "skipped" }], error: null });
    const out = await requestTagging(HOUSEHOLD, ids, "run", "run-1");
    expect(h.rpcCalls).toHaveLength(2);
    expect((h.rpcCalls[0][1] as { p_book_ids: string[] }).p_book_ids).toHaveLength(1000);
    expect((h.rpcCalls[1][1] as { p_book_ids: string[] }).p_book_ids).toHaveLength(500);
    expect(h.rpcCalls[0]).toEqual([
      "request_tagging",
      { p_household: HOUSEHOLD, p_book_ids: ids.slice(0, 1000), p_reason: "run", p_run: "run-1" },
    ]);
    expect(out.get("b0")).toBe("queued");
    expect(out.get("b1400")).toBe("skipped");
  });

  it("rejects with the code kept", async () => {
    h.rpcResults.push({ data: null, error: { code: "22023" } });
    await expect(requestTagging(HOUSEHOLD, [BOOK], "manual", null)).rejects.toMatchObject({ code: "22023" });
  });
});

describe("runTagJob", () => {
  it("returns the function's outcome", async () => {
    h.invoke.mockResolvedValue({ data: { outcome: "done" }, error: null });
    expect(await runTagJob(JOB)).toBe("done");
    expect(h.invoke).toHaveBeenCalledWith("library-tagger", { body: { jobId: JOB } });
  });

  it("maps a 404 to misconfigured", async () => {
    h.invoke.mockResolvedValue({ data: null, error: http(404) });
    expect(await runTagJob(JOB)).toBe("misconfigured");
  });

  it("rejects on a network error", async () => {
    const err = new FunctionsFetchError(new Error("offline"));
    h.invoke.mockResolvedValue({ data: null, error: err });
    await expect(runTagJob(JOB)).rejects.toBe(err);
  });

  it("rejects on an unknown outcome", async () => {
    h.invoke.mockResolvedValue({ data: { outcome: "weird" }, error: null });
    await expect(runTagJob(JOB)).rejects.toMatchObject({ code: "unexpected_reply" });
  });
});

describe("suggestions", () => {
  it("lists pending suggestions with their books", async () => {
    h.results.push({
      data: [{
        id: "s1", tag_id: "salt-magic", label: "Salt magic", category: "theme",
        books: [{ book_id: BOOK, why: "Salt wards the harbour." }],
      }],
      error: null,
    });
    h.results.push({ data: [], error: null });
    const out = await listSuggestions(HOUSEHOLD);
    expect(out).toEqual([{
      id: "s1", tagId: "salt-magic", label: "Salt magic", category: "theme",
      books: [{ bookId: BOOK, why: "Salt wards the harbour." }],
    }]);
    expect(h.queries[0].steps).toContainEqual(["eq", ["status", "pending"]]);
  });

  it("approves and returns the number of books tagged", async () => {
    h.rpcResults.push({ data: 3, error: null });
    expect(await approveSuggestion("s1", "Salt magic", "theme")).toBe(3);
    expect(h.rpcCalls[0]).toEqual([
      "approve_tag_suggestion",
      { p_suggestion: "s1", p_label: "Salt magic", p_category: "theme" },
    ]);
  });

  it("rejects when approve replies with a non-number", async () => {
    h.rpcResults.push({ data: "3", error: null });
    await expect(approveSuggestion("s1", "Salt magic", "theme")).rejects.toMatchObject({ code: "unexpected_reply" });
  });

  it("dismisses", async () => {
    h.rpcResults.push({ data: "dismissed", error: null });
    await dismissSuggestion("s1");
    expect(h.rpcCalls[0]).toEqual(["dismiss_tag_suggestion", { p_suggestion: "s1" }]);
  });
});

describe("createLibraryTag", () => {
  it("returns the new vocabulary version", async () => {
    h.rpcResults.push({ data: 7, error: null });
    expect(await createLibraryTag(HOUSEHOLD, "salt-magic", "Salt magic", "theme")).toBe(7);
    expect(h.rpcCalls[0]).toEqual([
      "add_library_tag",
      { p_household: HOUSEHOLD, p_id: "salt-magic", p_label: "Salt magic", p_category: "theme" },
    ]);
  });

  it("keeps 23505", async () => {
    h.rpcResults.push({ data: null, error: { code: "23505", message: "tag_exists" } });
    await expect(createLibraryTag(HOUSEHOLD, "found-family", "Found family", "trope")).rejects.toMatchObject({
      code: "23505",
    });
  });
});

describe("ask", () => {
  it("returns an ok answer", async () => {
    h.invoke.mockResolvedValue({
      data: { outcome: "ok", answerable: true, note: null, matches: [{ bookId: BOOK, confidence: 0.8, reason: "Fits." }] },
      error: null,
    });
    const r = await ask(HOUSEHOLD, "a quiet harbour mystery", [BOOK]);
    expect(h.invoke).toHaveBeenCalledWith("library-ask", {
      body: { householdId: HOUSEHOLD, prompt: "a quiet harbour mystery", bookIds: [BOOK] },
    });
    expect(r).toEqual({
      outcome: "ok", answerable: true, note: null, matches: [{ bookId: BOOK, confidence: 0.8, reason: "Fits." }],
    });
  });

  it("passes through failure outcomes", async () => {
    h.invoke.mockResolvedValue({ data: { outcome: "too_large" }, error: null });
    expect(await ask(HOUSEHOLD, "x", [BOOK])).toEqual({ outcome: "too_large" });
  });

  it("maps a 404 to misconfigured", async () => {
    h.invoke.mockResolvedValue({ data: null, error: http(404) });
    expect(await ask(HOUSEHOLD, "x", [BOOK])).toEqual({ outcome: "misconfigured" });
  });

  it("rejects on a network error", async () => {
    const err = new FunctionsFetchError(new Error("offline"));
    h.invoke.mockResolvedValue({ data: null, error: err });
    await expect(ask(HOUSEHOLD, "x", [BOOK])).rejects.toBe(err);
  });
});
