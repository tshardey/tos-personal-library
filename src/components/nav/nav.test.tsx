import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  covers: { available: true, reviewCount: 0 },
  tagging: true,
  reading: true,
}));
vi.mock("@/contexts/CoverFinderContext", async (importOriginal) => {
  const orig = await importOriginal<typeof import("@/contexts/CoverFinderContext")>();
  return { ...orig, useCoverFinder: () => ({ ...orig.UNAVAILABLE_COVER_FINDER, ...state.covers }) };
});
vi.mock("@/contexts/TaggingContext", async (importOriginal) => {
  const orig = await importOriginal<typeof import("@/contexts/TaggingContext")>();
  return { ...orig, useTagging: () => ({ ...orig.UNAVAILABLE_TAGGING, available: state.tagging }) };
});
vi.mock("@/contexts/ReadingContext", async (importOriginal) => {
  const orig = await importOriginal<typeof import("@/contexts/ReadingContext")>();
  return { ...orig, useReading: () => ({ ...orig.UNAVAILABLE_READING, available: state.reading }) };
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

import type { Route } from "@/lib/router";
import AppShell from "./AppShell";

const onSignOut = vi.fn();

function mount(route: Route = { name: "library" }) {
  return render(
    <AppShell route={route} email="a@b.co" onSignOut={onSignOut}>
      <p>Page body</p>
    </AppShell>,
  );
}

/** Fails unless each element comes after the one before it in the document. */
function expectInOrder(els: HTMLElement[]) {
  for (let i = 1; i < els.length; i++) {
    expect(els[i - 1].compareDocumentPosition(els[i]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  }
}

function expectMoreItems(panel: HTMLElement) {
  const q = within(panel);
  const items = [
    q.getByRole("link", { name: "Reading history" }),
    q.getByRole("link", { name: "Tag suggestions" }),
    q.getByRole("link", { name: "Edition labels" }),
    q.getByRole("link", { name: "Import" }),
    q.getByRole("link", { name: "Photos" }),
    q.getByText("a@b.co"),
    q.getByText("abc123"),
    q.getByRole("button", { name: "Sign out" }),
  ];
  expect(items[0]).toHaveAttribute("href", "#/reading");
  expect(items[1]).toHaveAttribute("href", "#/tags");
  expect(items[2]).toHaveAttribute("href", "#/editions");
  expect(items[3]).toHaveAttribute("href", "#/import");
  expect(items[4]).toHaveAttribute("href", "#/inbox");
  expectInOrder(items);
}

beforeEach(() => {
  state.covers = { available: true, reviewCount: 0 };
  state.tagging = true;
  state.reading = true;
  onSignOut.mockReset();
});
afterEach(() => cleanup());

describe("phone navigation", () => {
  it("has one Main navigation with Library, Scan, Covers links and Add, More buttons", () => {
    mount();
    const navs = screen.getAllByRole("navigation", { name: "Main" });
    expect(navs).toHaveLength(1);
    expect(screen.getByTestId("bottom-tab-bar")).toBe(navs[0]);
    expect(screen.getByRole("banner")).not.toContainElement(navs[0]);
    const nav = within(navs[0]);
    expect(nav.getByRole("link", { name: "Library" })).toHaveAttribute("href", "#/");
    expect(nav.getByRole("link", { name: "Scan" })).toHaveAttribute("href", "#/scan");
    expect(nav.getByRole("link", { name: "Covers" })).toHaveAttribute("href", "#/covers");
    expect(nav.getByRole("button", { name: "Add" })).toBeInTheDocument();
    expect(nav.getByRole("button", { name: "More" })).toBeInTheDocument();
    expect(nav.getByRole("link", { name: "Library" })).toHaveAttribute("aria-current", "page");
  });

  it("keeps the title and the page in the shell", () => {
    mount();
    expect(screen.getByRole("heading", { name: "Our Library" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Our Library" })).toHaveAttribute("href", "#/");
    expect(screen.getByRole("main")).toHaveTextContent("Page body");
    expect(screen.getByRole("main").className).toContain("pb-[var(--nav-bottom)]");
  });

  it("marks Add as current on #/inbox", () => {
    mount({ name: "inbox" });
    expect(screen.getByRole("button", { name: "Add" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Library" })).not.toHaveAttribute("aria-current");
  });

  it("marks More as current on #/tags", () => {
    mount({ name: "tags" });
    expect(screen.getByRole("button", { name: "More" })).toHaveAttribute("aria-current", "page");
  });

  describe("Add chooser", () => {
    it("opens Add books with the three links", () => {
      mount();
      fireEvent.click(screen.getByRole("button", { name: "Add" }));
      const dialog = screen.getByRole("dialog", { name: "Add books" });
      const q = within(dialog);
      expect(q.getByRole("link", { name: "Type it in" })).toHaveAttribute("href", "#/add");
      expect(q.getByRole("link", { name: "Photos" })).toHaveAttribute("href", "#/inbox");
      expect(q.getByRole("link", { name: "Import" })).toHaveAttribute("href", "#/import");
      expect(q.getByRole("link", { name: "Type it in" })).toHaveAccessibleDescription("Title, author or ISBN");
      expect(q.getByRole("link", { name: "Photos" })).toHaveAccessibleDescription("Read books from photos");
      expect(q.getByRole("link", { name: "Import" })).toHaveAccessibleDescription("A libib CSV export");
    });

    it("closes when a link is clicked", () => {
      mount();
      fireEvent.click(screen.getByRole("button", { name: "Add" }));
      fireEvent.click(within(screen.getByRole("dialog", { name: "Add books" })).getByRole("link", { name: "Photos" }));
      expect(screen.queryByRole("dialog", { name: "Add books" })).not.toBeInTheDocument();
    });

    it("closes on Escape and focuses Add", () => {
      mount();
      const add = screen.getByRole("button", { name: "Add" });
      add.focus(); // a click focuses the button in the browser; fireEvent.click does not
      fireEvent.click(add);
      fireEvent.keyDown(screen.getByRole("dialog", { name: "Add books" }), { key: "Escape" });
      expect(screen.queryByRole("dialog", { name: "Add books" })).not.toBeInTheDocument();
      expect(add).toHaveFocus();
    });
  });

  describe("More", () => {
    it("opens More holding the links, then the email, invite code and Sign out", () => {
      mount();
      fireEvent.click(screen.getByRole("button", { name: "More" }));
      const dialog = screen.getByRole("dialog", { name: "More" });
      expectMoreItems(dialog);
      fireEvent.click(within(dialog).getByRole("button", { name: "Sign out" }));
      expect(onSignOut).toHaveBeenCalledTimes(1);
    });

    it("hides Reading history and Tag suggestions when those features are unavailable", () => {
      state.reading = false;
      state.tagging = false;
      mount();
      fireEvent.click(screen.getByRole("button", { name: "More" }));
      const q = within(screen.getByRole("dialog", { name: "More" }));
      expect(q.queryByRole("link", { name: "Reading history" })).not.toBeInTheDocument();
      expect(q.queryByRole("link", { name: "Tag suggestions" })).not.toBeInTheDocument();
      expect(q.getByRole("link", { name: "Edition labels" })).toBeInTheDocument();
    });

    it("closes when a link is clicked, and on Escape with focus back on More", () => {
      mount();
      const more = screen.getByRole("button", { name: "More" });
      fireEvent.click(more);
      fireEvent.click(within(screen.getByRole("dialog", { name: "More" })).getByRole("link", { name: "Edition labels" }));
      expect(screen.queryByRole("dialog", { name: "More" })).not.toBeInTheDocument();
      more.focus();
      fireEvent.click(more);
      fireEvent.keyDown(screen.getByRole("dialog", { name: "More" }), { key: "Escape" });
      expect(screen.queryByRole("dialog", { name: "More" })).not.toBeInTheDocument();
      expect(more).toHaveFocus();
    });
  });

  describe("Covers tab", () => {
    it("names the count when covers wait for review", () => {
      state.covers = { available: true, reviewCount: 3 };
      mount();
      const link = screen.getByRole("link", { name: "Covers, 3 to review" });
      expect(link).toHaveAttribute("href", "#/covers");
      const badge = within(link).getByText("3");
      expect(badge.closest("[aria-hidden='true']")).not.toBeNull();
    });

    it("is plain Covers with no badge when nothing waits", () => {
      state.covers = { available: true, reviewCount: 0 };
      mount();
      const link = screen.getByRole("link", { name: "Covers" });
      expect(link).toHaveAttribute("href", "#/covers");
      expect(link).toHaveTextContent(/^Covers$/);
    });

    it("stays present when the finder is unavailable", () => {
      state.covers = { available: false, reviewCount: 3 };
      mount();
      const link = screen.getByRole("link", { name: "Covers" });
      expect(link).toHaveAttribute("href", "#/covers");
      expect(link).toHaveTextContent(/^Covers$/);
    });

    it("is current on #/covers", () => {
      mount({ name: "covers" });
      expect(screen.getByRole("link", { name: "Covers" })).toHaveAttribute("aria-current", "page");
    });
  });
});

describe("desktop navigation", () => {
  const original = window.matchMedia;
  beforeEach(() => {
    window.matchMedia = ((query: string) => ({
      matches: query === "(min-width: 640px)",
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    })) as typeof window.matchMedia;
  });
  afterEach(() => {
    window.matchMedia = original;
  });

  it("puts Our Library and the Main nav in the header, with Add and More as menus, and no bottom bar", () => {
    mount();
    const header = screen.getByRole("banner");
    expect(within(header).getByRole("heading", { name: "Our Library" })).toBeInTheDocument();
    const navs = screen.getAllByRole("navigation", { name: "Main" });
    expect(navs).toHaveLength(1);
    expect(header).toContainElement(navs[0]);
    expect(screen.queryByTestId("bottom-tab-bar")).not.toBeInTheDocument();
    const nav = within(navs[0]);
    expect(nav.getByRole("link", { name: "Library" })).toHaveAttribute("aria-current", "page");
    expect(nav.getByRole("link", { name: "Scan" })).toHaveAttribute("href", "#/scan");
    expect(nav.getByRole("link", { name: "Covers" })).toHaveAttribute("href", "#/covers");
    expect(nav.getByRole("button", { name: "Add" })).toHaveAttribute("aria-expanded", "false");
    expect(nav.getByRole("button", { name: "More" })).toHaveAttribute("aria-expanded", "false");
  });

  it("opens the Add menu with the three links", () => {
    mount({ name: "import" });
    const add = screen.getByRole("button", { name: "Add" });
    expect(add).toHaveAttribute("aria-current", "page");
    fireEvent.click(add);
    expect(add).toHaveAttribute("aria-expanded", "true");
    const panel = document.getElementById(add.getAttribute("aria-controls")!)!;
    expect(within(panel).getByRole("link", { name: "Type it in" })).toHaveAttribute("href", "#/add");
    fireEvent.click(within(panel).getByRole("link", { name: "Type it in" }));
    expect(add).toHaveAttribute("aria-expanded", "false");
  });

  it("opens the More panel with the same items, and Escape closes it and focuses the button", () => {
    mount();
    const more = screen.getByRole("button", { name: "More" });
    fireEvent.click(more);
    expect(more).toHaveAttribute("aria-expanded", "true");
    const panel = document.getElementById(more.getAttribute("aria-controls")!)!;
    expectMoreItems(panel);
    fireEvent.keyDown(within(panel).getByRole("link", { name: "Edition labels" }), { key: "Escape" });
    expect(more).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("abc123")).not.toBeInTheDocument();
    expect(more).toHaveFocus();
  });

  it("shows the Covers count in the top nav", () => {
    state.covers = { available: true, reviewCount: 3 };
    mount();
    expect(screen.getByRole("link", { name: "Covers, 3 to review" })).toHaveAttribute("href", "#/covers");
  });
});
