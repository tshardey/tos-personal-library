import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const reading = vi.hoisted(() => ({
  state: null as import("@/contexts/ReadingContext").ReadingState | null,
}));
vi.mock("@/contexts/ReadingContext", async (importOriginal) => {
  const orig = await importOriginal<typeof import("@/contexts/ReadingContext")>();
  return { ...orig, useReading: () => reading.state ?? orig.UNAVAILABLE_READING };
});
vi.mock("@/contexts/HouseholdContext", () => ({
  useHousehold: () => ({
    household: { id: "h1", name: "Home", inviteCode: "abc123", createdAt: "" },
    members: [],
    loading: false,
    error: null,
    refresh: vi.fn(),
  }),
}));

import { UNAVAILABLE_READING, type ReadingState } from "@/contexts/ReadingContext";
import { clearCatalogCache, writeCatalogCache } from "@/lib/catalog-cache";
import { bookFixture, copyFixture } from "@/lib/flag-fixtures.test-util";
import { toStatusMap } from "@/lib/reading/status";
import AppShell from "./AppShell";

const books = ["The Salt Road", "Glass Orchard", "The Tin Lantern"].map((t) =>
  bookFixture(t, [copyFixture({ ownerUserId: "user-a" })]),
);
const rows = books.slice(0, 2).map((b) => ({
  bookId: b.id,
  userId: "user-a",
  status: "read" as const,
  finishedOn: null,
  source: "app" as const,
  markedAt: "2026-01-01T00:00:00Z",
}));

function available(over: Partial<ReadingState> = {}) {
  reading.state = {
    ...UNAVAILABLE_READING,
    available: true,
    rows,
    byBook: toStatusMap(rows),
    userId: "user-a",
    ...over,
  };
}
/** Opens More and returns queries scoped to its sheet. */
function open() {
  render(
    <AppShell route={{ name: "library" }} email="a@b.co" onSignOut={() => {}}>
      <p>Page body</p>
    </AppShell>,
  );
  fireEvent.click(screen.getByRole("button", { name: "More" }));
  return within(screen.getByRole("dialog", { name: "More" }));
}

beforeEach(() => {
  reading.state = null;
  clearCatalogCache();
});
afterEach(() => cleanup());

describe("More reading", () => {
  it("shows the Reading history link and the summary when available", () => {
    writeCatalogCache({ householdId: "h1", books, tags: new Map() });
    available();
    const more = open();
    expect(more.getByRole("link", { name: "Reading history" })).toHaveAttribute("href", "#/reading");
    expect(more.getByText("You've read 2 of 3 (67%)")).toBeInTheDocument();
    // The summary tops the list.
    const order = more
      .getByText("You've read 2 of 3 (67%)")
      .compareDocumentPosition(more.getByRole("link", { name: "Reading history" }));
    expect(order & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("omits the summary without a cached catalogue", () => {
    available();
    const more = open();
    expect(more.getByRole("link", { name: "Reading history" })).toBeInTheDocument();
    expect(screen.queryByText(/You've read/)).not.toBeInTheDocument();
  });

  it("omits the summary when the member owns nothing", () => {
    writeCatalogCache({ householdId: "h1", books: [], tags: new Map() });
    available();
    const more = open();
    expect(more.getByRole("link", { name: "Edition labels" })).toBeInTheDocument();
    expect(screen.queryByText(/You've read/)).not.toBeInTheDocument();
  });

  it("shows neither when unavailable", () => {
    writeCatalogCache({ householdId: "h1", books, tags: new Map() });
    const more = open();
    expect(more.getByRole("link", { name: "Edition labels" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Reading history" })).not.toBeInTheDocument();
    expect(screen.queryByText(/You've read/)).not.toBeInTheDocument();
  });
});
