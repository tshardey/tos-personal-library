import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";

vi.mock("@/contexts/HouseholdContext", () => ({
  useHousehold: () => ({
    household: { id: "h1", name: "Home", inviteCode: "abc123", createdAt: "" },
    members: [],
    loading: false,
    error: null,
    refresh: vi.fn(),
  }),
}));

import TagStopBanner from "@/components/tags/TagStopBanner";
import { drainTagging, TAG_PAUSE_MS } from "@/lib/tagging/drain";
import type {
  AiBudget,
  LibraryTag,
  SeriesSuggestion,
  TagJob,
  TagSuggestion,
} from "@/lib/tagging/types";
import {
  POLL_ACTIVE_MS,
  POLL_IDLE_MS,
  TaggingProvider,
  UNAVAILABLE_TAGGING,
  useTagging,
  type TaggingDeps,
  type TaggingState,
} from "./TaggingContext";

const BUDGET: AiBudget = {
  month: "2026-11-01",
  spentMicro: 0,
  budgetMicro: 5_000_000,
  reserveMicro: 4300,
  globalSpentMicro: 0,
  globalBudgetMicro: 5_000_000,
};

const TAG: LibraryTag = {
  id: "slow-burn",
  label: "Slow burn",
  category: "trope",
  active: true,
  addedVersion: 1,
  householdId: null,
};

function mkJob(id: string, status: TagJob["status"] = "queued"): TagJob {
  return {
    id,
    bookId: `book-${id}`,
    runId: null,
    kind: "full",
    reason: "manual",
    status,
    attempts: 0,
    claimedAt: null,
    retryAt: null,
    errorCode: null,
    createdAt: "2026-11-01T00:00:00Z",
  };
}

let jobs: TagJob[] = [];
let latest: TaggingState;

function fakeDeps(over: Partial<TaggingDeps> = {}): TaggingDeps {
  return {
    listVocabulary: vi.fn(async () => [TAG]),
    listLibraryTagsByBook: vi.fn(async () => new Map()),
    listCardMeta: vi.fn(async () => new Map()),
    listTagJobs: vi.fn(async () => jobs),
    listSuggestions: vi.fn(async () => []),
    getAiBudget: vi.fn(async () => BUDGET),
    addLibraryTag: vi.fn(async () => {}),
    removeLibraryTag: vi.fn(async () => {}),
    requestTagging: vi.fn(async () => new Map()),
    runTagJob: vi.fn(async () => "done" as const),
    approveSuggestion: vi.fn(async () => 1),
    dismissSuggestion: vi.fn(async () => {}),
    listSeriesSuggestions: vi.fn(async () => []),
    listSeriesChecked: vi.fn(async () => new Set<string>()),
    approveSeriesSuggestion: vi.fn(async () => 2),
    dismissSeriesSuggestion: vi.fn(async () => {}),
    createLibraryTag: vi.fn(async () => 2),
    ask: vi.fn(async () => ({ outcome: "empty" as const })),
    loadTosTags: vi.fn(async () => ({
      tags: [
        {
          id: "enemies-to-lovers",
          label: "Enemies to lovers",
          category: "trope",
        },
      ],
      stale: false,
    })),
    drain: vi.fn<typeof drainTagging>(async () => ({ stop: null, paused: false })),
    now: () => new Date("2026-11-12T12:00:00Z"),
    newRunId: () => "run-1",
    ...over,
  };
}

function Probe() {
  latest = useTagging();
  return (
    <div>
      <span data-testid="available">{String(latest.available)}</span>
      <span data-testid="version">{latest.tagsVersion}</span>
    </div>
  );
}

function mount(deps: TaggingDeps, children: ReactNode = <Probe />) {
  return render(
    <TaggingProvider deps={deps}>
      <TagStopBanner />
      {children}
    </TaggingProvider>,
  );
}

const flush = () =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });

beforeEach(() => {
  vi.useFakeTimers();
  jobs = [];
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("TaggingProvider", () => {
  it("before the push: a missing table hides everything and never runs a job", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    jobs = [mkJob("j1")];
    const deps = fakeDeps({
      listTagJobs: vi.fn(async () => Promise.reject({ code: "PGRST205" })),
      drain: drainTagging,
    });
    mount(deps);
    await flush();
    expect(screen.getByTestId("available")).toHaveTextContent("false");
    expect(deps.runTagJob).not.toHaveBeenCalled();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    warn.mockRestore();
  });

  it("runs a due job once and bumps tagsVersion after a done", async () => {
    jobs = [mkJob("j1")];
    const deps = fakeDeps({ drain: drainTagging });
    mount(deps);
    await flush();
    expect(deps.runTagJob).toHaveBeenCalledTimes(1);
    expect(deps.runTagJob).toHaveBeenCalledWith("j1");
    expect(screen.getByTestId("version")).toHaveTextContent("1");
  });

  it("does not bump tagsVersion when nothing finished done", async () => {
    jobs = [mkJob("j1")];
    const deps = fakeDeps({
      drain: drainTagging,
      runTagJob: vi.fn(async () => "retry_later" as const),
    });
    mount(deps);
    await flush();
    expect(deps.runTagJob).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("version")).toHaveTextContent("0");
  });

  it("polls every 15 s while a job is due and every 120 s otherwise", async () => {
    jobs = [mkJob("j1")];
    const deps = fakeDeps();
    mount(deps);
    await flush();
    const loads = vi.mocked(deps.listTagJobs).mock.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(POLL_ACTIVE_MS);
    });
    expect(POLL_ACTIVE_MS).toBe(15_000);
    expect(vi.mocked(deps.listTagJobs).mock.calls.length).toBeGreaterThan(
      loads,
    );
    cleanup();

    jobs = [mkJob("j2", "done")];
    const idle = fakeDeps();
    mount(idle);
    await flush();
    const idleLoads = vi.mocked(idle.listTagJobs).mock.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(POLL_ACTIVE_MS * 2);
    });
    expect(vi.mocked(idle.listTagJobs).mock.calls.length).toBe(idleLoads);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(POLL_IDLE_MS);
    });
    expect(POLL_IDLE_MS).toBe(120_000);
    expect(vi.mocked(idle.listTagJobs).mock.calls.length).toBeGreaterThan(
      idleLoads,
    );
  });

  it("shows the stop banner and stops draining until Try again", async () => {
    jobs = [mkJob("j1")];
    const drain = vi.fn<typeof drainTagging>(async () => ({
      stop: "billing",
      paused: false,
    }));
    mount(fakeDeps({ drain }));
    await flush();
    expect(screen.getByRole("status")).toHaveTextContent(
      "Tagging stopped: the Claude account's spending limit is reached.",
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(POLL_ACTIVE_MS * 2);
    });
    expect(drain).toHaveBeenCalledTimes(1);
    await act(async () => {
      screen.getByRole("button", { name: "Try again" }).click();
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(drain).toHaveBeenCalledTimes(2);
  });

  it("two unreachable jobs pause the drain; nothing re-drains until the pause ends", async () => {
    jobs = [mkJob("j1"), mkJob("j2")];
    const deps = fakeDeps({
      drain: drainTagging,
      runTagJob: vi.fn(async () => "retry_later" as const),
    });
    mount(deps);
    await flush();
    expect(deps.runTagJob).toHaveBeenCalledTimes(2);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(POLL_ACTIVE_MS * 3);
      document.dispatchEvent(new Event("visibilitychange"));
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(deps.runTagJob).toHaveBeenCalledTimes(2);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(TAG_PAUSE_MS);
    });
    expect(vi.mocked(deps.runTagJob).mock.calls.length).toBeGreaterThan(2);
  });

  it("the budget banner has no Try again", async () => {
    jobs = [mkJob("j1")];
    mount(
      fakeDeps({
        drain: vi.fn<typeof drainTagging>(async () => ({
          stop: "budget",
          paused: false,
        })),
      }),
    );
    await flush();
    expect(screen.getByRole("status")).toHaveTextContent(
      "This month's tagging budget is used up. The rest carry on next month.",
    );
    expect(
      screen.queryByRole("button", { name: "Try again" }),
    ).not.toBeInTheDocument();
  });

  it("createTag maps 23505 to exists, a ToS or vocabulary id to exists, and an empty id to invalid without the RPC", async () => {
    const deps = fakeDeps({
      createLibraryTag: vi.fn(async () => Promise.reject({ code: "23505" })),
    });
    mount(deps);
    await flush();
    await act(async () => {
      expect(await latest.createTag("Found family", "trope")).toBe("exists");
    });
    expect(deps.createLibraryTag).toHaveBeenCalledTimes(1);
    await act(async () => {
      expect(await latest.createTag("Enemies to Lovers", "trope")).toBe(
        "exists",
      );
      expect(await latest.createTag("Slow burn", "trope")).toBe("exists");
      expect(await latest.createTag("!!!", "trope")).toBe("invalid");
    });
    expect(deps.createLibraryTag).toHaveBeenCalledTimes(1);
  });

  it("createTag adds a new tag", async () => {
    const deps = fakeDeps();
    mount(deps);
    await flush();
    await act(async () => {
      expect(await latest.createTag("Found family", "trope")).toBe("added");
    });
    expect(deps.createLibraryTag).toHaveBeenCalledWith(
      "h1",
      "found-family",
      "Found family",
      "trope",
    );
  });

  it("ask refreshes the Ask budget afterwards and never retries", async () => {
    const deps = fakeDeps({
      ask: vi.fn(async () => ({ outcome: "retry_later" as const })),
    });
    mount(deps);
    await flush();
    const asks = () =>
      vi.mocked(deps.getAiBudget).mock.calls.filter((c) => c[1] === "ask")
        .length;
    const before = asks();
    await act(async () => {
      expect(await latest.ask("a quiet mystery", ["b1"])).toEqual({
        outcome: "retry_later",
      });
    });
    expect(deps.ask).toHaveBeenCalledTimes(1);
    expect(asks()).toBe(before + 1);
  });

  it("tagAll queues under one new run id and counts the queued books", async () => {
    const deps = fakeDeps({
      requestTagging: vi.fn(
        async () =>
          new Map([
            ["b1", "queued" as const],
            ["b2", "already_open" as const],
          ]),
      ),
    });
    mount(deps);
    await flush();
    await act(async () => {
      expect(await latest.tagAll(["b1", "b2"])).toBe(1);
    });
    expect(deps.requestTagging).toHaveBeenCalledWith(
      "h1",
      ["b1", "b2"],
      "run",
      "run-1",
    );
  });

  it("retagMany queues manual jobs without a run id and counts only the new ones", async () => {
    const deps = fakeDeps({
      requestTagging: vi.fn(
        async () =>
          new Map([
            ["b1", "queued" as const],
            ["b2", "already_open" as const],
            ["b3", "queued" as const],
          ]),
      ),
    });
    mount(deps);
    await flush();
    await act(async () => {
      expect(await latest.retagMany(["b1", "b2", "b3"])).toBe(2);
    });
    expect(deps.requestTagging).toHaveBeenCalledWith("h1", ["b1", "b2", "b3"], "manual", null);
  });

  describe("series", () => {
    const SERIES: SeriesSuggestion = {
      id: "s1",
      name: "Thornmere Cycle",
      books: [{ bookId: "b1", volume: 1, why: null }],
    };
    const TAG_SUGGESTION = { id: "t1" } as unknown as TagSuggestion;

    it("a missing series table hides only series; tagging and tag suggestions keep working", async () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      mount(
        fakeDeps({
          listSuggestions: vi.fn(async () => [TAG_SUGGESTION]),
          listSeriesSuggestions: vi.fn(async () =>
            Promise.reject({ code: "PGRST205" }),
          ),
        }),
      );
      await flush();
      expect(latest.available).toBe(true);
      expect(latest.suggestions).toHaveLength(1);
      expect(latest.seriesAvailable).toBe(false);
      expect(latest.pendingCount).toBe(1);
      warn.mockRestore();
    });

    it("a missing series_checked_at column (42703) hides only series", async () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      mount(
        fakeDeps({
          listSuggestions: vi.fn(async () => [TAG_SUGGESTION]),
          listSeriesChecked: vi.fn(async () =>
            Promise.reject({ code: "42703" }),
          ),
        }),
      );
      await flush();
      expect(latest.available).toBe(true);
      expect(latest.seriesAvailable).toBe(false);
      expect(latest.pendingCount).toBe(1);
      warn.mockRestore();
    });

    it("after one success, a transient error keeps the lists; a missing feature hides them", async () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const list = vi
        .fn<TaggingDeps["listSeriesSuggestions"]>()
        .mockResolvedValueOnce([SERIES])
        .mockRejectedValueOnce({ code: "57014" })
        .mockRejectedValueOnce({ code: "42703" });
      mount(fakeDeps({ listSeriesSuggestions: list }));
      await flush();
      expect(latest.seriesAvailable).toBe(true);
      await act(async () => {
        await latest.reload();
      });
      expect(latest.seriesAvailable).toBe(true);
      expect(latest.seriesSuggestions).toEqual([SERIES]);
      await act(async () => {
        await latest.reload();
      });
      expect(latest.seriesAvailable).toBe(false);
      warn.mockRestore();
    });

    it("a hung series read does not hold up loading, availability or the drain", async () => {
      const deps = fakeDeps({
        listSeriesSuggestions: vi.fn(() => new Promise<never>(() => {})),
      });
      mount(deps);
      await flush();
      expect(latest.loading).toBe(false);
      expect(latest.available).toBe(true);
      expect(deps.drain).toHaveBeenCalled();
    });

    it("pendingCount is tag suggestions plus series suggestions", async () => {
      mount(
        fakeDeps({
          listSuggestions: vi.fn(async () => [TAG_SUGGESTION]),
          listSeriesSuggestions: vi.fn(async () => [SERIES]),
          listSeriesChecked: vi.fn(async () => new Set(["b1"])),
        }),
      );
      await flush();
      expect(latest.seriesAvailable).toBe(true);
      expect(latest.seriesChecked).toEqual(new Set(["b1"]));
      expect(latest.pendingCount).toBe(2);
    });

    it("findSeries queues under a new run id and returns the queued count", async () => {
      const deps = fakeDeps({
        requestTagging: vi.fn(
          async () =>
            new Map([
              ["b1", "queued" as const],
              ["b2", "already_open" as const],
            ]),
        ),
      });
      mount(deps);
      await flush();
      await act(async () => {
        expect(await latest.findSeries(["b1", "b2"])).toBe(1);
      });
      expect(deps.requestTagging).toHaveBeenCalledWith(
        "h1",
        ["b1", "b2"],
        "series",
        "run-1",
      );
    });

    it("approveSeries calls the repo, reloads series and bumps tagsVersion", async () => {
      const deps = fakeDeps();
      mount(deps);
      await flush();
      const before = vi.mocked(deps.listSeriesSuggestions).mock.calls.length;
      await act(async () => {
        expect(await latest.approveSeries("s1", "Thornmere Cycle", { b1: 1 })).toBe(2);
      });
      expect(deps.approveSeriesSuggestion).toHaveBeenCalledWith(
        "s1",
        "Thornmere Cycle",
        { b1: 1 },
      );
      expect(vi.mocked(deps.listSeriesSuggestions).mock.calls.length).toBeGreaterThan(before);
      expect(screen.getByTestId("version")).toHaveTextContent("1");
    });

    it("dismissSeries reloads the series lists", async () => {
      const deps = fakeDeps();
      mount(deps);
      await flush();
      const before = vi.mocked(deps.listSeriesSuggestions).mock.calls.length;
      await act(async () => {
        await latest.dismissSeries("s1");
      });
      expect(deps.dismissSeriesSuggestion).toHaveBeenCalledWith("s1");
      expect(vi.mocked(deps.listSeriesSuggestions).mock.calls.length).toBeGreaterThan(before);
    });

    it("outside a provider the series defaults are unavailable and empty", async () => {
      expect(UNAVAILABLE_TAGGING.seriesAvailable).toBe(false);
      expect(UNAVAILABLE_TAGGING.seriesSuggestions).toEqual([]);
      expect(UNAVAILABLE_TAGGING.seriesChecked.size).toBe(0);
      expect(UNAVAILABLE_TAGGING.pendingCount).toBe(0);
      expect(await UNAVAILABLE_TAGGING.findSeries(["b1"])).toBe(0);
      expect(await UNAVAILABLE_TAGGING.approveSeries("s", "n", {})).toBe(0);
    });
  });
});
