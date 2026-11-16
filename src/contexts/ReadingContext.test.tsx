import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const hh = vi.hoisted(() => ({ id: "h1" }));
vi.mock("@/contexts/HouseholdContext", () => ({
  useHousehold: () => ({
    household: { id: hh.id, name: "Home", inviteCode: "abc123", createdAt: "" },
    members: [],
    loading: false,
    error: null,
    refresh: vi.fn(),
  }),
}));
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: { id: "user-a", email: "a@b.co" } }),
}));

import type { ReadStatusRow } from "@/lib/reading/types";
import { ReadingProvider, useReading, type ReadingDeps, type ReadingState } from "./ReadingContext";

const ROW: ReadStatusRow = {
  bookId: "book-1",
  userId: "user-a",
  status: "read",
  finishedOn: "2026-03-01",
  source: "app",
  markedAt: "2026-03-01T00:00:00Z",
};

let latest: ReadingState;
function Probe() {
  latest = useReading();
  return <span data-testid="available">{String(latest.available)}</span>;
}

function fakeDeps(over: Partial<ReadingDeps> = {}): ReadingDeps {
  return {
    listReadStatuses: vi.fn(async () => [ROW]),
    setReadStatus: vi.fn(async () => []),
    ...over,
  };
}

async function mount(deps: ReadingDeps) {
  render(
    <ReadingProvider deps={deps}>
      <Probe />
    </ReadingProvider>,
  );
  await act(async () => {});
}

afterEach(() => {
  cleanup();
  hh.id = "h1";
});

describe("ReadingProvider", () => {
  it("loads the household's statuses and exposes the signed-in user", async () => {
    await mount(fakeDeps());
    expect(screen.getByTestId("available")).toHaveTextContent("true");
    expect(latest.rows).toEqual([ROW]);
    expect(latest.byBook.get("book-1")?.get("user-a")?.state).toBe("read");
    expect(latest.userId).toBe("user-a");
  });

  it("is unavailable on PGRST205 and breaks nothing", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await mount(
      fakeDeps({
        listReadStatuses: vi.fn(async () => {
          throw { code: "PGRST205" };
        }),
      }),
    );
    expect(screen.getByTestId("available")).toHaveTextContent("false");
    expect(latest.loading).toBe(false);
    expect(latest.rows).toEqual([]);
    warn.mockRestore();
  });

  it("reloads when the tab becomes visible", async () => {
    const deps = fakeDeps();
    await mount(deps);
    expect(deps.listReadStatuses).toHaveBeenCalledTimes(1);
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(deps.listReadStatuses).toHaveBeenCalledTimes(2);
  });

  it("setStatus calls the repo once and reloads", async () => {
    const deps = fakeDeps();
    await mount(deps);
    await act(async () => {
      await latest.setStatus(["book-1"], "read", "2026-04-01", false);
    });
    expect(deps.setReadStatus).toHaveBeenCalledTimes(1);
    expect(deps.setReadStatus).toHaveBeenCalledWith("h1", ["book-1"], "read", "2026-04-01", false);
    expect(deps.listReadStatuses).toHaveBeenCalledTimes(2);
  });

  it("ignores a second setStatus while one is running", async () => {
    let release: () => void = () => {};
    const deps = fakeDeps({
      setReadStatus: vi.fn(
        () =>
          new Promise<never[]>((res) => {
            release = () => res([]);
          }),
      ),
    });
    await mount(deps);
    let first: Promise<void> = Promise.resolve();
    await act(async () => {
      first = latest.setStatus(["book-1"], "read", null, false);
      await latest.setStatus(["book-2"], "dnf", null, false);
    });
    expect(deps.setReadStatus).toHaveBeenCalledTimes(1);
    await act(async () => {
      release();
      await first;
    });
    expect(deps.listReadStatuses).toHaveBeenCalledTimes(2);
  });

  it("useReading outside a provider is unavailable and does not throw", () => {
    function Bare() {
      return <span data-testid="a">{String(useReading().available)}</span>;
    }
    render(<Bare />);
    expect(screen.getByTestId("a")).toHaveTextContent("false");
  });

  it("a rejected write rejects to the caller and releases the guard", async () => {
    const setReadStatus = vi
      .fn<ReadingDeps["setReadStatus"]>()
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValue([]);
    const deps = fakeDeps({ setReadStatus });
    await mount(deps);
    await act(async () => {
      await expect(latest.setStatus(["book-1"], "read", null, false)).rejects.toThrow("boom");
    });
    await act(async () => {
      await latest.setStatus(["book-1"], "read", null, false);
    });
    expect(setReadStatus).toHaveBeenCalledTimes(2);
  });

  it("a household change drops the old rows, even when the new load fails", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const list = vi.fn(async (id: string) => {
      if (id === "h2") throw { code: "500" };
      return [ROW];
    });
    const deps = fakeDeps({ listReadStatuses: list });
    const view = render(
      <ReadingProvider deps={deps}>
        <Probe />
      </ReadingProvider>,
    );
    await act(async () => {});
    expect(latest.rows).toEqual([ROW]);
    hh.id = "h2";
    view.rerender(
      <ReadingProvider deps={deps}>
        <Probe />
      </ReadingProvider>,
    );
    await act(async () => {});
    expect(latest.rows).toEqual([]);
    expect(latest.available).toBe(false);
    expect(latest.loading).toBe(false);
    warn.mockRestore();
  });

  it("a stale load that resolves after a newer one does not overwrite it", async () => {
    const stale = { ...ROW, bookId: "old-book" };
    const resolvers: ((r: ReadStatusRow[]) => void)[] = [];
    const list = vi
      .fn<ReadingDeps["listReadStatuses"]>()
      .mockResolvedValueOnce([])
      .mockImplementation(() => new Promise((res) => resolvers.push(res)));
    await mount(fakeDeps({ listReadStatuses: list }));
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(resolvers).toHaveLength(2);
    await act(async () => {
      resolvers[1]([ROW]);
    });
    await act(async () => {
      resolvers[0]([stale]);
    });
    expect(latest.rows).toEqual([ROW]);
  });
});
