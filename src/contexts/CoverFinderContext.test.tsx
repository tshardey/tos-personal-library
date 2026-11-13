import { act, cleanup, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";

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
  useHousehold: () => ({
    household: { id: "h1", name: "Home", inviteCode: "abc123", createdAt: "" },
    members: [],
    loading: false,
    error: null,
    refresh: vi.fn(),
  }),
}));

import CoversBadge from "@/components/covers/CoversBadge";
import CoverStopBanner from "@/components/covers/CoverStopBanner";
import { mkSearch } from "@/lib/covers/fixtures.test-util";
import type { drainCovers } from "@/lib/covers/drain";
import type { CoverBudget, CoverSearch } from "@/lib/covers/types";
import {
  CoverFinderProvider,
  POLL_ACTIVE_MS,
  POLL_IDLE_MS,
  useCoverFinder,
  type CoverFinderDeps,
} from "./CoverFinderContext";

const R1 = { url: "https://covers.openlibrary.org/b/id/1000001-L.jpg", source: "openlibrary" as const, width: 400, height: 600 };

const BUDGET: CoverBudget = {
  month: "2026-11-01",
  spentMicro: 0,
  budgetMicro: 5_000_000,
  reserveMicro: 4300,
  globalSpentMicro: 0,
  globalBudgetMicro: 5_000_000,
};

type DrainFn = typeof drainCovers;
type DrainOpts = Parameters<DrainFn>[2];

let searches: CoverSearch[] = [];

function mkDrain(result: Awaited<ReturnType<DrainFn>> = { stop: null, gatherPaused: false, screenPaused: false }) {
  return vi.fn<DrainFn>(async () => result);
}

function Probe() {
  const f = useCoverFinder();
  return (
    <div>
      <span data-testid="available">{String(f.available)}</span>
      <span data-testid="review">{f.reviewCount}</span>
      <span data-testid="paused">{String(f.gatherPaused)}</span>
      <span data-testid="screen-paused">{String(f.screenPaused)}</span>
    </div>
  );
}

function mount(deps: Partial<CoverFinderDeps> = {}, children: ReactNode = <Probe />) {
  return render(
    <CoverFinderProvider deps={deps}>
      <CoversBadge />
      <CoverStopBanner />
      {children}
    </CoverFinderProvider>,
  );
}

const flush = () => act(async () => {
  await vi.advanceTimersByTimeAsync(0);
});

beforeEach(() => {
  vi.useFakeTimers();
  for (const fn of Object.values(repo)) fn.mockReset();
  searches = [];
  repo.listCoverMarks.mockImplementation(async () => new Map());
  repo.listCoverSearches.mockImplementation(async () => searches);
  repo.getCoverBudget.mockResolvedValue(BUDGET);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("CoverFinderProvider", () => {
  it("before the push: a missing table hides everything and never screens", async () => {
    repo.listCoverSearches.mockRejectedValue({ code: "PGRST205" });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    mount();
    await flush();
    expect(screen.getByTestId("available")).toHaveTextContent("false");
    expect(repo.screenSearch).not.toHaveBeenCalled();
    expect(screen.queryByRole("link", { name: /covers to review/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    warn.mockRestore();
  });

  it("polls every 15 s while a search is queued", async () => {
    searches = [mkSearch("s1", "b1", "queued")];
    const drain = mkDrain();
    mount({ drain });
    await flush();
    const loads = repo.listCoverSearches.mock.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(POLL_ACTIVE_MS);
    });
    expect(POLL_ACTIVE_MS).toBe(15_000);
    expect(repo.listCoverSearches.mock.calls.length).toBeGreaterThan(loads);
  });

  it("polls every 120 s when nothing is active", async () => {
    searches = [mkSearch("s1", "b1", "ready")];
    mount({ drain: mkDrain() });
    await flush();
    const loads = repo.listCoverSearches.mock.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(POLL_ACTIVE_MS * 2);
    });
    expect(repo.listCoverSearches.mock.calls.length).toBe(loads);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(POLL_IDLE_MS - POLL_ACTIVE_MS * 2);
    });
    expect(POLL_IDLE_MS).toBe(120_000);
    expect(repo.listCoverSearches.mock.calls.length).toBeGreaterThan(loads);
  });

  it("with a billing stop, polls at 120 s and does not drain", async () => {
    searches = [mkSearch("s1", "b1", "queued")];
    const drain = mkDrain({ stop: "billing", gatherPaused: false, screenPaused: false });
    mount({ drain });
    await flush();
    expect(drain).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("status")).toHaveTextContent(
      "Cover finding stopped: the Claude account's spending limit is reached.",
    );
    const loads = repo.listCoverSearches.mock.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(POLL_ACTIVE_MS * 2);
    });
    expect(repo.listCoverSearches.mock.calls.length).toBe(loads);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(POLL_IDLE_MS);
    });
    expect(repo.listCoverSearches.mock.calls.length).toBeGreaterThan(loads);
    expect(drain).toHaveBeenCalledTimes(1);
  });

  it("a gather pause carries into later drains and resumes once after 60 s", async () => {
    searches = [mkSearch("s1", "b1", "ready")];
    let calls = 0;
    const drain = vi.fn<DrainFn>(async (_rows, _deps, opts?: DrainOpts) => {
      calls += 1;
      return calls === 1 ? { stop: null, gatherPaused: true, screenPaused: false } : { stop: null, gatherPaused: opts?.gatherPaused ?? false, screenPaused: false };
    });
    mount({ drain });
    await flush();
    expect(drain).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("paused")).toHaveTextContent("true");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
      document.dispatchEvent(new Event("visibilitychange"));
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(drain).toHaveBeenCalledTimes(2);
    expect(drain.mock.calls[1][2]).toEqual({ gatherPaused: true, screenPaused: false });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    const unpaused = drain.mock.calls.slice(1).filter((c: Parameters<DrainFn>) => c[2]?.gatherPaused === false);
    expect(unpaused).toHaveLength(1);
    expect(drain).toHaveBeenCalledTimes(3);
    expect(screen.getByTestId("paused")).toHaveTextContent("false");
  });

  it("a screen pause carries into later drains and resumes once after 60 s, with no banner", async () => {
    searches = [mkSearch("s1", "b1", "gathered")];
    let calls = 0;
    const drain = vi.fn<DrainFn>(async (_rows, _deps, opts?: DrainOpts) => {
      calls += 1;
      return calls === 1
        ? { stop: null, gatherPaused: false, screenPaused: true }
        : { stop: null, gatherPaused: opts?.gatherPaused ?? false, screenPaused: opts?.screenPaused ?? false };
    });
    mount({ drain });
    await flush();
    expect(drain).toHaveBeenCalledTimes(1);
    expect(drain.mock.calls[0][2]).toEqual({ gatherPaused: false, screenPaused: false });
    expect(screen.getByTestId("screen-paused")).toHaveTextContent("true");
    expect(screen.queryByRole("status")).not.toBeInTheDocument();

    // The 15 s active polls during the pause pass it on, so nothing is screened.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(POLL_ACTIVE_MS);
    });
    expect(drain).toHaveBeenCalledTimes(2);
    expect(drain.mock.calls[1][2]).toEqual({ gatherPaused: false, screenPaused: true });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000 - POLL_ACTIVE_MS);
    });
    const unpaused = drain.mock.calls.slice(1).filter((c: Parameters<DrainFn>) => c[2]?.screenPaused === false);
    expect(unpaused.length).toBeGreaterThanOrEqual(1);
    // The calls between the first drain and the timer firing were all paused.
    const firstUnpaused = drain.mock.calls.findIndex((c: Parameters<DrainFn>, i: number) => i > 0 && c[2]?.screenPaused === false);
    expect(drain.mock.calls.slice(1, firstUnpaused).every((c: Parameters<DrainFn>) => c[2]?.screenPaused === true)).toBe(true);
    expect(screen.getByTestId("screen-paused")).toHaveTextContent("false");
  });

  it("a pause timer firing during a paused drain resumes once, unpaused, without re-arming", async () => {
    searches = [mkSearch("s1", "b1", "ready")];
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    let calls = 0;
    const drain = vi.fn<DrainFn>(async (_rows, _deps, opts?: DrainOpts) => {
      calls += 1;
      if (calls === 1) return { stop: null, gatherPaused: true, screenPaused: false };
      if (calls === 2) await held;
      // drainCovers echoes the pause it was given.
      return { stop: null, gatherPaused: opts?.gatherPaused ?? false, screenPaused: false };
    });
    mount({ drain });
    await flush();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(59_000);
      document.dispatchEvent(new Event("visibilitychange"));
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(drain).toHaveBeenCalledTimes(2);
    expect(drain.mock.calls[1][2]).toEqual({ gatherPaused: true, screenPaused: false });

    // The 60 s timer fires while drain 2 is still held.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    expect(drain).toHaveBeenCalledTimes(2);
    await act(async () => {
      release();
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(drain).toHaveBeenCalledTimes(3);
    expect(drain.mock.calls[2][2]).toEqual({ gatherPaused: false, screenPaused: false });
    expect(screen.getByTestId("paused")).toHaveTextContent("false");

    // No new pause timer was armed: nothing else drains before the next idle poll.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(59_000);
    });
    expect(drain).toHaveBeenCalledTimes(3);
    expect(drain.mock.calls.slice(1).filter((c: Parameters<DrainFn>) => c[2]?.gatherPaused === false)).toHaveLength(1);
  });

  it("unmounting mid-gather makes no further gather or screen calls", async () => {
    const book = { title: "Glass Orchard", authors: ["Member B"], isbn13: [], isbn10: [], coverUrl: null };
    searches = [
      mkSearch("s1", "b1", "queued", { book, createdAt: "2026-11-01T00:00:01Z" }),
      mkSearch("s2", "b2", "queued", { book, createdAt: "2026-11-01T00:00:02Z" }),
      mkSearch("s3", "b3", "gathered", { book, createdAt: "2026-11-01T00:00:03Z" }),
    ];
    let release!: (c: []) => void;
    const gather = vi.fn<CoverFinderDeps["gather"]>(() => new Promise((r) => (release = r)));
    repo.recordCoverCandidates.mockResolvedValue("nothing_found");
    const { unmount } = mount({ gather, sleep: async () => {} });
    await flush();
    expect(gather).toHaveBeenCalledTimes(1);
    unmount();
    await act(async () => {
      release([]);
      await vi.advanceTimersByTimeAsync(5_000);
    });
    expect(gather).toHaveBeenCalledTimes(1);
    expect(repo.screenSearch).not.toHaveBeenCalled();
  });

  it("counts ready rows with a result (an empty one is not listed) plus unseen nothing found and failed rows", async () => {
    searches = [
      mkSearch("s1", "b1", "ready", { results: [R1] }),
      mkSearch("s0", "b0", "ready"),
      mkSearch("s2", "b2", "nothing_found"),
      mkSearch("s3", "b3", "failed"),
      mkSearch("s4", "b4", "nothing_found", { seenAt: "2026-11-02T00:00:00Z" }),
      mkSearch("s5", "b5", "queued"),
    ];
    mount({ drain: mkDrain() });
    await flush();
    expect(screen.getByTestId("review")).toHaveTextContent("3");
    expect(screen.getByRole("link", { name: "Covers to review (3)" })).toHaveAttribute("href", "#/covers");
  });

  it("runReview sums outcomes, marks seen once, then reloads", async () => {
    repo.applyCover.mockResolvedValueOnce("applied").mockResolvedValueOnce("cover_changed");
    repo.dismissCoverSearch.mockResolvedValue("not_ready");
    repo.markResultsSeen.mockResolvedValue(2);
    let api!: ReturnType<typeof useCoverFinder>;
    function Grab() {
      api = useCoverFinder();
      return null;
    }
    mount({ drain: mkDrain() }, <Grab />);
    await flush();
    const loads = repo.listCoverSearches.mock.calls.length;
    let out!: { applied: number; changed: number; gone: number };
    await act(async () => {
      out = await api.runReview([
        { kind: "apply", searchId: "s1", url: "https://covers.openlibrary.org/b/id/1000001-L.jpg", expectedCover: null },
        { kind: "apply", searchId: "s2", url: "https://covers.openlibrary.org/b/id/1000002-L.jpg", expectedCover: null },
        { kind: "keep", searchId: "s3" },
        { kind: "seen", searchId: "s4" },
        { kind: "seen", searchId: "s5" },
      ]);
    });
    expect(out).toEqual({ applied: 1, changed: 1, gone: 1 });
    expect(repo.applyCover).toHaveBeenCalledTimes(2);
    expect(repo.markResultsSeen.mock.calls).toEqual([[["s4", "s5"]]]);
    expect(repo.listCoverSearches.mock.calls.length).toBeGreaterThan(loads);
  });

  it("a budget stop shows its banner without Try again", async () => {
    searches = [mkSearch("s1", "b1", "gathered")];
    mount({ drain: mkDrain({ stop: "budget", gatherPaused: false, screenPaused: false }) });
    await flush();
    expect(screen.getByRole("status")).toHaveTextContent(
      "This month's cover-finding budget is used up. The rest wait for next month or a manual retry.",
    );
    expect(screen.queryByRole("button", { name: "Try again" })).not.toBeInTheDocument();
  });

  it("a rejected stop shows its banner, and Try again drains once more", async () => {
    searches = [mkSearch("s1", "b1", "gathered")];
    const drain = vi.fn<DrainFn>(async () => ({ stop: "rejected", gatherPaused: false, screenPaused: false }));
    mount({ drain });
    await flush();
    expect(screen.getByRole("status")).toHaveTextContent(
      "Cover finding stopped: the requests were refused. Check the Claude workspace limit, then try again.",
    );
    drain.mockResolvedValue({ stop: null, gatherPaused: false, screenPaused: false });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Try again" }));
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(drain).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("requestBatch counts outcomes with a fresh batch id, then reloads and drains", async () => {
    repo.requestCoverSearches.mockResolvedValue(
      new Map([
        ["b1", "queued"],
        ["b2", "already_open"],
        ["b3", "nothing_found"],
        ["b4", "queued"],
      ]),
    );
    const drain = mkDrain();
    let api!: ReturnType<typeof useCoverFinder>;
    function Grab() {
      api = useCoverFinder();
      return null;
    }
    mount({ drain }, <Grab />);
    await flush();
    let out!: { queued: number; alreadyOpen: number; nothingFound: number };
    await act(async () => {
      out = await api.requestBatch(["b1", "b2", "b3", "b4"]);
    });
    expect(out).toEqual({ queued: 2, alreadyOpen: 1, nothingFound: 1 });
    const [household, ids, batch, manual] = repo.requestCoverSearches.mock.calls[0];
    expect(household).toBe("h1");
    expect(ids).toEqual(["b1", "b2", "b3", "b4"]);
    expect(batch).toMatch(/^[0-9a-f-]{36}$/);
    expect(manual).toBe(false);
    expect(drain).toHaveBeenCalledTimes(2);
  });
});

describe("unhauled outcome", () => {
  function grab() {
    const ref = {} as { api: ReturnType<typeof useCoverFinder> };
    function Grab() {
      ref.api = useCoverFinder();
      return null;
    }
    mount({ drain: mkDrain() }, <Grab />);
    return ref;
  }

  it("requestBatch counts an unhauled row in no bucket", async () => {
    repo.requestCoverSearches.mockResolvedValue(
      new Map([
        ["b1", "queued"],
        ["b2", "unhauled"],
        ["b3", "queued"],
      ]),
    );
    const ref = grab();
    await flush();
    let out!: { queued: number; alreadyOpen: number; nothingFound: number };
    await act(async () => {
      out = await ref.api.requestBatch(["b1", "b2", "b3"]);
    });
    expect(out).toEqual({ queued: 2, alreadyOpen: 0, nothingFound: 0 });
  });

  it("findNow still requests with p_manual true, and returns the outcome", async () => {
    repo.requestCoverSearches.mockResolvedValue(new Map([["u1", "queued"]]));
    const ref = grab();
    await flush();
    let out;
    await act(async () => {
      out = await ref.api.findNow("u1", [], null);
    });
    expect(out).toBe("queued");
    expect(repo.requestCoverSearches.mock.calls[0][3]).toBe(true);
  });
});

describe("useCoverFinder without a provider", () => {
  it("returns the unavailable state instead of throwing", async () => {
    const { result } = renderHook(() => useCoverFinder());
    expect(result.current.available).toBe(false);
    expect(result.current.marks.size).toBe(0);
    await expect(result.current.requestBatch(["b1"])).resolves.toEqual({ queued: 0, alreadyOpen: 0, nothingFound: 0 });
  });
});
