import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const repo = vi.hoisted(() => ({
  listCoverMarks: vi.fn(),
  listCoverSearches: vi.fn(),
  getCoverBudget: vi.fn(),
  markForCover: vi.fn(),
  unmarkForCover: vi.fn(),
  requestCoverSearches: vi.fn(),
  recordCoverCandidates: vi.fn(),
  screenSearch: vi.fn(),
  applyCover: vi.fn(),
  dismissCoverSearch: vi.fn(),
  markResultsSeen: vi.fn(),
}));

vi.mock("@/lib/covers/cover-repo", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/covers/cover-repo")>()),
  ...repo,
}));

vi.mock("@/contexts/HouseholdContext", () => ({
  useHousehold: () => ({ household: { id: "h1", name: "Home", inviteCode: "abc123", createdAt: "" }, members: [] }),
}));

import { CoverFinderProvider, useCoverFinder } from "./CoverFinderContext";

const drain = vi.fn(async () => ({ stop: null, gatherPaused: false, screenPaused: false }));
const flush = () => act(async () => {
  await vi.advanceTimersByTimeAsync(0);
});

function grab() {
  const ref = {} as { api: ReturnType<typeof useCoverFinder> };
  function Grab() {
    ref.api = useCoverFinder();
    return null;
  }
  render(
    <CoverFinderProvider deps={{ drain }}>
      <Grab />
    </CoverFinderProvider>,
  );
  return ref;
}

beforeEach(() => {
  vi.useFakeTimers();
  for (const fn of Object.values(repo)) fn.mockReset();
  drain.mockClear();
  repo.listCoverMarks.mockResolvedValue(new Map());
  repo.listCoverSearches.mockResolvedValue([]);
  repo.getCoverBudget.mockResolvedValue(null);
  repo.markForCover.mockResolvedValue(undefined);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("markMany", () => {
  it("marks each book with the same reasons and note, then reloads once", async () => {
    const ref = grab();
    await flush();
    const loads = repo.listCoverMarks.mock.calls.length;
    let out;
    await act(async () => {
      out = await ref.api.markMany(["b1", "b2"], ["placeholder"], "the paperback");
    });
    expect(out).toEqual({ marked: 2, failed: 0 });
    expect(repo.markForCover.mock.calls).toEqual([
      ["b1", ["placeholder"], "the paperback"],
      ["b2", ["placeholder"], "the paperback"],
    ]);
    expect(repo.listCoverMarks.mock.calls.length).toBe(loads + 1);
    expect(repo.requestCoverSearches).not.toHaveBeenCalled();
  });

  it("carries on past a failed mark and counts it", async () => {
    repo.markForCover.mockRejectedValueOnce(new Error("network"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const ref = grab();
    await flush();
    let out;
    await act(async () => {
      out = await ref.api.markMany(["b1", "b2", "b3"], [], null);
    });
    expect(out).toEqual({ marked: 2, failed: 1 });
    expect(repo.markForCover).toHaveBeenCalledTimes(3);
    warn.mockRestore();
  });
});

describe("findMany", () => {
  it("with no reasons or note, requests without marking: batch rules for the books, manual for the retries", async () => {
    repo.requestCoverSearches
      .mockResolvedValueOnce(new Map([["b1", "queued"], ["b2", "already_open"]]))
      .mockResolvedValueOnce(new Map([["n1", "queued"]]));
    const ref = grab();
    await flush();
    let out;
    await act(async () => {
      out = await ref.api.findMany(["b1", "b2"], ["n1"], [], null);
    });
    expect(out).toEqual({ queued: 2, alreadyOpen: 1, nothingFound: 0 });
    expect(repo.markForCover).not.toHaveBeenCalled();
    const [first, second] = repo.requestCoverSearches.mock.calls;
    expect(first.slice(0, 2)).toEqual(["h1", ["b1", "b2"]]);
    expect(first[3]).toBe(false);
    expect(second.slice(0, 2)).toEqual(["h1", ["n1"]]);
    expect(second[3]).toBe(true);
    // One batch id for the whole request.
    expect(second[2]).toBe(first[2]);
  });

  it("with reasons, marks every requested book first so the search carries them", async () => {
    const order: string[] = [];
    repo.markForCover.mockImplementation(async (id: string) => {
      order.push("mark " + id);
    });
    repo.requestCoverSearches.mockImplementation(async (_h: string, ids: string[]) => {
      order.push("request " + ids.join(","));
      return new Map(ids.map((id) => [id, "queued"]));
    });
    const ref = grab();
    await flush();
    await act(async () => {
      await ref.api.findMany(["b1"], ["n1"], ["wrong_language"], null);
    });
    expect(order).toEqual(["mark b1", "mark n1", "request b1", "request n1"]);
    expect(repo.markForCover).toHaveBeenCalledWith("b1", ["wrong_language"], null);
  });

  it("with only a note, marks too", async () => {
    repo.requestCoverSearches.mockResolvedValue(new Map([["b1", "queued"]]));
    const ref = grab();
    await flush();
    await act(async () => {
      await ref.api.findMany(["b1"], [], [], "the hardback");
    });
    expect(repo.markForCover).toHaveBeenCalledWith("b1", [], "the hardback");
  });

  it("skips an empty request list", async () => {
    repo.requestCoverSearches.mockResolvedValue(new Map([["n1", "queued"]]));
    const ref = grab();
    await flush();
    await act(async () => {
      await ref.api.findMany([], ["n1"], [], null);
    });
    expect(repo.requestCoverSearches).toHaveBeenCalledTimes(1);
    expect(repo.requestCoverSearches.mock.calls[0][3]).toBe(true);
  });

  it("a failed mark stops before any request", async () => {
    repo.markForCover.mockRejectedValue(new Error("network"));
    const ref = grab();
    await flush();
    await act(async () => {
      await expect(ref.api.findMany(["b1"], [], ["placeholder"], null)).rejects.toThrow("network");
    });
    expect(repo.requestCoverSearches).not.toHaveBeenCalled();
  });
});

describe("findMany partial failure", () => {
  it("still reloads and drains when the retry request fails after the first went through", async () => {
    repo.requestCoverSearches
      .mockResolvedValueOnce(new Map([["b1", "queued"]]))
      .mockRejectedValueOnce(new Error("network"));
    const ref = grab();
    await flush();
    const loads = repo.listCoverSearches.mock.calls.length;
    const drains = drain.mock.calls.length;
    await act(async () => {
      await expect(ref.api.findMany(["b1"], ["n1"], [], null)).rejects.toThrow("network");
    });
    expect(repo.listCoverSearches.mock.calls.length).toBeGreaterThan(loads);
    expect(drain.mock.calls.length).toBeGreaterThan(drains);
  });
});

describe("without a provider", () => {
  it("both calls do nothing", async () => {
    const { UNAVAILABLE_COVER_FINDER: u } = await import("./CoverFinderContext");
    await expect(u.markMany(["b1"], [], null)).resolves.toEqual({ marked: 0, failed: 0 });
    await expect(u.findMany(["b1"], [], [], null)).resolves.toEqual({ queued: 0, alreadyOpen: 0, nothingFound: 0 });
  });
});
