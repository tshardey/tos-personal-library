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
import type { AiBudget, LibraryTag, TagJob } from "@/lib/tagging/types";
import {
  POLL_ACTIVE_MS,
  POLL_IDLE_MS,
  TaggingProvider,
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

  it("createTag maps 23505 to exists, and a ToS, vocabulary or empty id to exists without the RPC", async () => {
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
      expect(await latest.createTag("!!!", "trope")).toBe("exists");
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
});
