import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { bookFixture, copyFixture } from "@/lib/flag-fixtures.test-util";
import { takeScrollAnchor } from "@/lib/library-view";

const h = vi.hoisted(() => ({ catalog: {} as Record<string, unknown> }));
const repo = vi.hoisted(() => ({ updateCopyFields: vi.fn(), updateBook: vi.fn() }));

vi.mock("@/contexts/HouseholdContext", () => ({
  useHousehold: () => ({
    household: { id: "h" },
    members: [{ householdId: "h", userId: "u-a", displayName: "Member A", createdAt: "" }],
  }),
}));
vi.mock("@/hooks/useCatalog", () => ({ useCatalog: () => h.catalog }));
vi.mock("@/hooks/useCopyPhotoUrls", () => ({ useCopyPhotoUrls: () => new Map() }));
vi.mock("@/lib/tos-tags", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tos-tags")>()),
  loadTosTags: vi.fn().mockResolvedValue({ tags: [], stale: false }),
}));
vi.mock("@/lib/library-repo", () => repo);
import LibraryPage from "./LibraryPage";

const BOOKS = [
  bookFixture("Ember Atlas", [copyFixture({ id: "e1", bookId: "Ember Atlas" })]),
  bookFixture("Ember Codex", [copyFixture({ id: "e2", bookId: "Ember Codex" })]),
  bookFixture("Glass Orchard", [copyFixture({ id: "g1", bookId: "Glass Orchard" })]),
];

function setCatalog() {
  h.catalog = {
    books: BOOKS,
    tags: new Map(),
    loading: false,
    error: null,
    tagsError: null,
    reload: vi.fn(),
    refresh: vi.fn().mockResolvedValue(true),
  };
}

const bar = () => screen.getByRole("region", { name: "Selection" });
const search = (q: string) => fireEvent.change(screen.getByRole("searchbox"), { target: { value: q } });

describe("LibraryPage select mode", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.location.hash = "";
    repo.updateCopyFields.mockResolvedValue(undefined);
    setCatalog();
  });

  it("Select turns the cards into tickboxes and the bar counts them", () => {
    render(<LibraryPage />);
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(screen.getAllByRole("link").length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "Select" }));
    expect(screen.getAllByRole("checkbox", { name: /^Select / })).toHaveLength(3);
    expect(within(bar()).getByText("0 selected")).toBeInTheDocument();
    expect(within(bar()).getByRole("button", { name: "Edit" })).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox", { name: "Select Glass Orchard" }));
    expect(within(bar()).getByText("1 selected")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("checkbox", { name: "Select Glass Orchard" }));
    expect(within(bar()).getByText("0 selected")).toBeInTheDocument();
  });

  it("Select all picks every book the search shows, and the ticks outlive a new search", () => {
    render(<LibraryPage />);
    fireEvent.click(screen.getByRole("button", { name: "Select" }));
    search("ember");
    fireEvent.click(screen.getByRole("button", { name: "Select all" }));
    expect(within(bar()).getByText("2 selected")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Select all" })).toBeDisabled();
    search("");
    expect(screen.getByRole("checkbox", { name: "Select Ember Atlas" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Select Glass Orchard" })).not.toBeChecked();
    expect(within(bar()).getByText("2 selected")).toBeInTheDocument();
  });

  it("Done leaves select mode and drops the selection", () => {
    render(<LibraryPage />);
    fireEvent.click(screen.getByRole("button", { name: "Select" }));
    fireEvent.click(screen.getByRole("button", { name: "Select all" }));
    fireEvent.click(within(bar()).getByRole("button", { name: "Done" }));
    expect(screen.queryByRole("region", { name: "Selection" })).toBeNull();
    expect(screen.queryByRole("checkbox")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Select" }));
    expect(within(bar()).getByText("0 selected")).toBeInTheDocument();
  });

  it("a tap in select mode saves no scroll anchor (Plan 6 restoration is untouched)", () => {
    render(<LibraryPage />);
    fireEvent.click(screen.getByRole("button", { name: "Select" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Select Ember Atlas" }));
    expect(takeScrollAnchor()).toBeNull();
    expect(window.location.hash).toBe("");
  });

  it("Edit opens the sheet for the selected books; saving reloads, reports and leaves select mode", async () => {
    render(<LibraryPage />);
    fireEvent.click(screen.getByRole("button", { name: "Select" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Select Ember Codex" }));
    fireEvent.click(within(bar()).getByRole("button", { name: "Edit" }));
    const sheet = screen.getByRole("dialog", { name: "Edit selected books" });
    expect(within(sheet).getByRole("heading", { level: 2 })).toHaveTextContent("Edit 1 book");
    expect(within(sheet).getByRole("group", { name: "Ember Codex" })).toBeInTheDocument();
    fireEvent.change(within(sheet).getByLabelText("Owner"), { target: { value: "u-a" } });
    fireEvent.click(within(sheet).getByRole("button", { name: "Save" }));
    fireEvent.click(within(sheet).getByRole("button", { name: "Confirm" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Changed 1 copy."));
    expect(repo.updateCopyFields).toHaveBeenCalledWith("e2", { ownerUserId: "u-a" }, ["ownerUserId"]);
    expect(h.catalog.refresh).toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByRole("region", { name: "Selection" })).toBeNull();
  });
});
