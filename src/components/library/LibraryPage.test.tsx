import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BookWithCopies } from "@/lib/types";
import { bookFixture, copyFixture } from "@/lib/flag-fixtures.test-util";

const h = vi.hoisted(() => ({ catalog: {} as Record<string, unknown> }));

vi.mock("@/contexts/HouseholdContext", () => ({ useHousehold: () => ({ members: [] }) }));
vi.mock("@/hooks/useCatalog", () => ({ useCatalog: () => h.catalog }));
vi.mock("@/hooks/useCopyPhotoUrls", () => ({ useCopyPhotoUrls: () => new Map() }));
vi.mock("@/lib/tos-tags", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tos-tags")>()),
  loadTosTags: vi.fn().mockResolvedValue({
    tags: [
      { id: "epistolary", label: "Letters / Documents / Found Records", category: "form" },
      { id: "fantasy", label: "Fantasy", category: "genre" },
    ],
    stale: false,
  }),
}));
import LibraryPage from "./LibraryPage";

const openFilters = () => fireEvent.click(screen.getByRole("button", { name: /^Filters/ }));

function book(
  id: string,
  title: string,
  seriesName: string | null = null,
  seriesVolume: number | null = null,
): BookWithCopies {
  return {
    id,
    householdId: "h1",
    title,
    authors: ["Member A"],
    synopsis: null,
    coverUrl: null,
    isbn13: [],
    isbn10: [],
    openlibraryId: null,
    googleBooksId: null,
    pageCount: null,
    publisher: null,
    publishDate: null,
    seriesName,
    seriesVolume,
    onShelf: true,
    userEditedFields: [],
    createdAt: "",
    updatedAt: "",
    copies: [],
  };
}

const books = [book("a", "The Salt Road", "Saga"), book("b", "Glass Orchard"), book("c", "Paper Tide", "Saga")];

function setCatalog(extra: Record<string, unknown> = {}) {
  h.catalog = {
    books,
    tags: new Map([
      ["a", ["epistolary", "fantasy"]],
      ["b", ["epistolary"]],
      ["c", ["fantasy"]],
    ]),
    loading: false,
    error: null,
    tagsError: null,
    reload: vi.fn(),
    ...extra,
  };
}

describe("LibraryPage series and tag filters", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.location.hash = "";
  });

  it("presets the series filter from the route", () => {
    setCatalog();
    render(<LibraryPage series="Saga" />);
    openFilters();
    expect(screen.getByLabelText("Series")).toHaveValue("Saga");
    expect(screen.queryAllByText("The Salt Road").length).toBeGreaterThan(0);
    expect(screen.queryAllByText("Paper Tide").length).toBeGreaterThan(0);
    expect(screen.queryAllByText("Glass Orchard")).toHaveLength(0);
  });

  it("shows only books carrying every chosen tag", async () => {
    setCatalog();
    render(<LibraryPage />);
    openFilters();
    fireEvent.click(await screen.findByRole("button", { name: "ToS tags" }));
    const dialog = await screen.findByRole("dialog", { name: "ToS tags" });
    await waitFor(() => within(dialog).getByLabelText("Fantasy"));
    fireEvent.click(within(dialog).getByLabelText("Letters / Documents / Found Records"));
    fireEvent.click(within(dialog).getByLabelText("Fantasy"));
    fireEvent.click(within(dialog).getByRole("button", { name: "Close" }));
    expect(screen.queryAllByText("The Salt Road").length).toBeGreaterThan(0);
    expect(screen.queryAllByText("Glass Orchard")).toHaveLength(0);
    expect(screen.queryAllByText("Paper Tide")).toHaveLength(0);
  });

  it("still lists books when tags are unavailable, without the tag filter", async () => {
    setCatalog({ tags: new Map(), tagsError: "Tome of Secrets tags unavailable" });
    render(<LibraryPage />);
    openFilters();
    expect(screen.queryAllByText("Glass Orchard").length).toBeGreaterThan(0);
    expect(screen.getByText("Tome of Secrets tags unavailable.")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole("button", { name: "ToS tags" })).not.toBeInTheDocument());
  });

  it("sorts a series by volume, nulls last, with 2.5 between 2 and 3", () => {
    setCatalog({
      books: [
        book("a", "Alpha", "Saga", 3),
        book("b", "Bravo", "Saga", 2.5),
        book("c", "Charlie", "Saga", 2),
        book("d", "Delta", "Saga"),
        book("e", "Echo", "Saga", 1),
      ],
    });
    render(<LibraryPage series="Saga" />);
    const order = screen.getAllByRole("link").map((l) => l.textContent ?? "");
    const titles = ["Echo", "Charlie", "Bravo", "Alpha", "Delta"];
    const positions = titles.map((t) => order.findIndex((o) => o.includes(t)));
    expect(positions.every((p) => p >= 0)).toBe(true);
    expect([...positions].sort((x, y) => x - y)).toEqual(positions);
  });

  it("changing the series select updates the hash, including back to All series", () => {
    setCatalog();
    render(<LibraryPage series="Saga" />);
    openFilters();
    fireEvent.change(screen.getByLabelText("Series"), { target: { value: "" } });
    expect(window.location.hash).toBe("#/");
    fireEvent.change(screen.getByLabelText("Series"), { target: { value: "Saga" } });
    expect(window.location.hash).toBe("#/series/Saga");
  });

  it("the ToS tags sheet takes focus, closes on Escape and returns focus", async () => {
    setCatalog();
    render(<LibraryPage />);
    openFilters();
    const trigger = await screen.findByRole("button", { name: "ToS tags" });
    fireEvent.click(trigger);
    const dialog = await screen.findByRole("dialog", { name: "ToS tags" });
    expect(dialog.contains(document.activeElement)).toBe(true);
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "ToS tags" })).not.toBeInTheDocument();
    expect(document.activeElement).toBe(trigger);
  });
});

describe("LibraryPage copy flag filters", () => {
  const D12 = "2026-11-12";
  const at = (day: string, hh = "12") => `${day}T${hh}:00:00`;
  const card = (c: HTMLElement, id: string) => c.querySelector(`[data-book-id="${id}"]`) as HTMLElement | null;

  function flagBooks() {
    const P = bookFixture(
      "The Salt Road",
      [
        copyFixture({ deluxe: true, createdAt: at(D12) }),
        copyFixture({ createdAt: at(D12, "13") }),
        copyFixture({ unhauledAt: at(D12, "20"), createdAt: at(D12, "14") }),
      ],
      { publishDate: "2015" },
    );
    const U = bookFixture("Glass Orchard", [copyFixture({ unhauledAt: at(D12, "20"), createdAt: at(D12, "15") })]);
    const Z = bookFixture(
      "Paper Tide",
      [copyFixture({ signed: true, createdAt: at(D12, "16") }), copyFixture({ createdAt: at("2026-11-10") })],
      { publishDate: "2010-05-01" },
    );
    const fillers = Array.from({ length: 40 }, (_, i) => bookFixture(`Filler ${i}`, []));
    return [P, U, Z, ...fillers];
  }
  const count = () => document.querySelector("p[aria-live='polite']")?.textContent;

  beforeEach(() => {
    vi.clearAllMocks();
    window.location.hash = "";
    setCatalog({ books: flagBooks(), tags: new Map() });
  });

  it("main view counts 42 books and hides the unhauled one", () => {
    const { container } = render(<LibraryPage />);
    expect(count()).toBe("42 books");
    expect(card(container, "Glass Orchard")).toBeNull();
  });

  it("a search shows the unhauled book with its badge", () => {
    const { container } = render(<LibraryPage />);
    fireEvent.change(screen.getByLabelText("Search books"), { target: { value: "Glass Orchard" } });
    expect(within(card(container, "Glass Orchard")!).getByText("Unhauled")).toBeInTheDocument();
    expect(count()).toBe("1 book");
  });

  it("the Unhauled chip shows books with an unhauled copy", () => {
    const { container } = render(<LibraryPage />);
    openFilters();
    fireEvent.click(screen.getByRole("button", { name: "Unhauled" }));
    expect(card(container, "The Salt Road")).not.toBeNull();
    expect(card(container, "Glass Orchard")).not.toBeNull();
    expect(count()).toBe("2 books");
  });

  it("the Deluxe chip shows books with an on-shelf deluxe copy and their badge", () => {
    const { container } = render(<LibraryPage />);
    openFilters();
    fireEvent.click(screen.getByRole("button", { name: "Deluxe" }));
    expect(count()).toBe("1 book");
    expect(within(card(container, "The Salt Road")!).getByText("Deluxe")).toBeInTheDocument();
  });

  it("the Signed chip shows signed books", () => {
    const { container } = render(<LibraryPage />);
    openFilters();
    fireEvent.click(screen.getByRole("button", { name: "Signed" }));
    expect(count()).toBe("1 book");
    expect(within(card(container, "Paper Tide")!).getByText("Signed")).toBeInTheDocument();
  });

  it("Date added lists the newest day first and filters by it", () => {
    const { container } = render(<LibraryPage />);
    openFilters();
    const select = screen.getByLabelText("Date added") as HTMLSelectElement;
    const opts = Array.from(select.options).map((o) => o.textContent);
    expect(opts[0]).toBe("Any day");
    expect(opts[1]).toBe("Nov 12 · 3");
    fireEvent.change(select, { target: { value: D12 } });
    expect(count()).toBe("2 books");
    expect(card(container, "The Salt Road")).not.toBeNull();
    expect(card(container, "Paper Tide")).not.toBeNull();
  });

  it("keeps a selected day listed at 0 when its copies are unhauled, and says no matching books", () => {
    const { rerender } = render(<LibraryPage />);
    openFilters();
    fireEvent.change(screen.getByLabelText("Date added"), { target: { value: D12 } });
    const P = bookFixture("The Salt Road", [
      copyFixture({ unhauledAt: at(D12, "20"), createdAt: at(D12) }),
      copyFixture({ createdAt: at("2026-11-10") }),
    ]);
    setCatalog({ books: [P], tags: new Map() });
    rerender(<LibraryPage />);
    const select = screen.getByLabelText("Date added") as HTMLSelectElement;
    expect(select.value).toBe(D12);
    expect(Array.from(select.options).map((o) => o.textContent)).toContain("Nov 12 · 0");
    expect(screen.getByText("No matching books")).toBeInTheDocument();
  });

  it("filters by published range, trims, ignores letters and swaps reversed ends", () => {
    render(<LibraryPage />);
    openFilters();
    const from = screen.getByLabelText("Published from");
    const to = screen.getByLabelText("Published to");
    fireEvent.change(from, { target: { value: "2010" } });
    fireEvent.change(to, { target: { value: "2020" } });
    expect(count()).toBe("2 books");
    fireEvent.change(from, { target: { value: " 2015 " } });
    fireEvent.change(to, { target: { value: "" } });
    expect(count()).toBe("1 book");
    fireEvent.change(from, { target: { value: "abc" } });
    expect(count()).toBe("42 books");
    expect(from).toHaveValue("abc");
    fireEvent.change(from, { target: { value: "2020" } });
    fireEvent.change(to, { target: { value: "2010" } });
    expect(count()).toBe("2 books");
  });

  it("a partly typed year is no bound", () => {
    render(<LibraryPage />);
    openFilters();
    const to = screen.getByLabelText("Published to");
    fireEvent.change(to, { target: { value: "202" } });
    expect(count()).toBe("42 books");
    expect(to).toHaveValue("202");
  });

  it("combines the Unhauled chip with a day", () => {
    const { container } = render(<LibraryPage />);
    openFilters();
    fireEvent.click(screen.getByRole("button", { name: "Unhauled" }));
    fireEvent.change(screen.getByLabelText("Date added"), { target: { value: D12 } });
    expect(count()).toBe("2 books");
    expect(card(container, "Paper Tide")).toBeNull();
    expect(card(container, "Glass Orchard")).not.toBeNull();
  });
});

describe("LibraryPage keeps its view across leaving the page (D9)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.location.hash = "";
    setCatalog();
  });

  it("restores the search box and the Deluxe chip after unmount and remount", () => {
    const first = render(<LibraryPage />);
    openFilters();
    fireEvent.change(screen.getByLabelText("Search books"), { target: { value: "Salt" } });
    fireEvent.click(screen.getByRole("button", { name: "Deluxe" }));
    first.unmount();

    render(<LibraryPage />);
    openFilters();
    expect(screen.getByLabelText("Search books")).toHaveValue("Salt");
    expect(screen.getByRole("button", { name: "Deluxe" })).toHaveAttribute("aria-pressed", "true");
  });

  it("clicking a card saves an anchor keyed to the view and the series", async () => {
    const { takeScrollAnchor } = await import("@/lib/library-view");
    const { container } = render(<LibraryPage series="Saga" />);
    const link = container.querySelector('[data-book-id="a"]') as HTMLElement;
    link.getBoundingClientRect = () => ({ top: 42 }) as DOMRect;
    fireEvent.click(link.querySelector("p") ?? link);
    const anchor = takeScrollAnchor();
    expect(anchor).toMatchObject({ bookId: "a", top: 42, scrollY: 0 });
    expect(JSON.parse(anchor!.viewKey)).toMatchObject({ query: "", series: "Saga" });
  });
});

describe("LibraryPage pinned toolbar (Task 10)", () => {
  const original = window.matchMedia;
  function stubDesktop() {
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
  }
  const by = (b: BookWithCopies, authors: string[]): BookWithCopies => ({ ...b, authors });
  // Catalogue order is title order; the authors' surnames run another way.
  const authored = [
    by(book("p1", "Amber Gate"), ["Tobias Quillfeather"]),
    by(book("p2", "Brass Lantern"), ["Petra Wynnecombe Jr."]),
    by(book("p3", "Cinder Vale"), ["Ada Fenwick"]),
  ];
  const lantern = [
    by(book("l1", "Alder Night", "Lantern Cycle", 3), ["Ada Fenwick"]),
    by(book("l2", "Birch Morning", "Lantern Cycle", 1), ["Tobias Quillfeather"]),
    by(book("l3", "Cedar Noon", "Lantern Cycle", 2), ["Petra Wynnecombe"]),
  ];
  const order = (c: HTMLElement) =>
    Array.from(c.querySelectorAll("[data-book-id]")).map((e) => e.getAttribute("data-book-id"));
  const grid = (c: HTMLElement) => c.querySelector("[data-cover-size]") as HTMLElement;
  const count = () => document.querySelector("p[aria-live='polite']")?.textContent;

  beforeEach(() => {
    vi.clearAllMocks();
    window.location.hash = "";
    window.localStorage.clear();
  });
  afterEach(() => {
    window.matchMedia = original;
    vi.restoreAllMocks();
    window.localStorage.clear();
  });

  describe("sort (desktop)", () => {
    beforeEach(stubDesktop);

    it("lists D5's four labels", () => {
      setCatalog({ books: authored });
      render(<LibraryPage />);
      const select = screen.getByLabelText("Sort") as HTMLSelectElement;
      expect(Array.from(select.options).map((o) => o.textContent)).toEqual([
        "Title",
        "Author",
        "Recently added",
        "Published (newest first)",
      ]);
      expect(select).toHaveValue("title");
    });

    it("Author reorders the wall, is remembered, and a remount reads it back", () => {
      setCatalog({ books: authored });
      const first = render(<LibraryPage />);
      expect(order(first.container)).toEqual(["p1", "p2", "p3"]);
      fireEvent.change(screen.getByLabelText("Sort"), { target: { value: "author" } });
      expect(order(first.container)).toEqual(["p3", "p1", "p2"]);
      expect(window.localStorage.getItem("tpl_library_sort")).toBe("author");
      first.unmount();
      const second = render(<LibraryPage />);
      expect(screen.getByLabelText("Sort")).toHaveValue("author");
      expect(order(second.container)).toEqual(["p3", "p1", "p2"]);
    });

    it("Review Focus 5: a series is in volume order with Sort disabled on Series order, whatever is stored", () => {
      window.localStorage.setItem("tpl_library_sort", "author");
      window.location.hash = "#/series/Lantern Cycle";
      setCatalog({ books: lantern });
      const { container } = render(<LibraryPage series="Lantern Cycle" />);
      expect(order(container)).toEqual(["l2", "l3", "l1"]);
      const select = screen.getByLabelText("Sort") as HTMLSelectElement;
      expect(select).toBeDisabled();
      expect(Array.from(select.options).map((o) => o.textContent)).toEqual(["Series order"]);
    });
  });

  describe("cover size (desktop)", () => {
    beforeEach(stubDesktop);

    it("Smaller covers from 4 gives step 3, its grid vars, and is remembered", () => {
      setCatalog();
      const { container } = render(<LibraryPage />);
      expect(grid(container)).toHaveAttribute("data-cover-size", "4");
      expect(grid(container)).toHaveClass("cover-grid");
      fireEvent.click(screen.getByRole("button", { name: "Smaller covers" }));
      const g = grid(container);
      expect(g).toHaveAttribute("data-cover-size", "3");
      expect(g.style.getPropertyValue("--cover-cols")).toBe("3");
      expect(g.style.getPropertyValue("--cover-min")).toBe("120px");
      expect(g.style.getPropertyValue("--cover-gap")).toBe("12px");
      expect(window.localStorage.getItem("tpl_cover_size")).toBe("3");
    });

    it("at 1 Smaller is disabled and titles are sr-only but still name the link", () => {
      window.localStorage.setItem("tpl_cover_size", "1");
      setCatalog();
      const { container } = render(<LibraryPage />);
      expect(grid(container)).toHaveAttribute("data-cover-size", "1");
      expect(screen.getByRole("button", { name: "Smaller covers" })).toBeDisabled();
      const link = container.querySelector('[data-book-id="b"]') as HTMLElement;
      const title = within(link).getByText("Glass Orchard", { selector: "p" });
      expect(title.parentElement).toHaveClass("sr-only");
      expect(screen.getByRole("link", { name: /Glass Orchard/ })).toBe(link);
    });

    it("at 5 Larger is disabled, and a remount restores the stored size", () => {
      setCatalog();
      const first = render(<LibraryPage />);
      fireEvent.click(screen.getByRole("button", { name: "Larger covers" }));
      expect(screen.getByRole("button", { name: "Larger covers" })).toBeDisabled();
      expect(grid(first.container)).toHaveAttribute("data-cover-size", "5");
      first.unmount();
      const second = render(<LibraryPage />);
      expect(grid(second.container)).toHaveAttribute("data-cover-size", "5");
    });

    it("Review Focus 2: blocked storage renders at 4 and the buttons still work for the session", () => {
      vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
        throw new Error("blocked");
      });
      vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
        throw new Error("blocked");
      });
      setCatalog();
      const { container } = render(<LibraryPage />);
      expect(grid(container)).toHaveAttribute("data-cover-size", "4");
      fireEvent.click(screen.getByRole("button", { name: "Smaller covers" }));
      expect(grid(container)).toHaveAttribute("data-cover-size", "3");
    });

    it("Review Focus 2: an unknown stored size is 4", () => {
      window.localStorage.setItem("tpl_cover_size", "9");
      setCatalog();
      const { container } = render(<LibraryPage />);
      expect(grid(container)).toHaveAttribute("data-cover-size", "4");
    });
  });

  describe("filter chips", () => {
    beforeEach(() =>
      setCatalog({
        books: [
          bookFixture("The Salt Road", [copyFixture({ deluxe: true, signed: true })]),
          bookFixture("Glass Orchard", [copyFixture({ signed: true })]),
          bookFixture("Paper Tide", [copyFixture()]),
        ],
        tags: new Map(),
      }),
    );

    it("Deluxe on shows its chip and the count; removing it turns it off", () => {
      render(<LibraryPage />);
      expect(count()).toBe("3 books");
      openFilters();
      fireEvent.click(screen.getByRole("button", { name: "Deluxe" }));
      expect(screen.getByRole("button", { name: "Remove filter: Deluxe" })).toBeInTheDocument();
      expect(count()).toBe("1 book");
      fireEvent.click(screen.getByRole("button", { name: "Remove filter: Deluxe" }));
      expect(screen.queryByRole("button", { name: "Remove filter: Deluxe" })).toBeNull();
      expect(screen.getByRole("button", { name: "Deluxe" })).toHaveAttribute("aria-pressed", "false");
      expect(count()).toBe("3 books");
    });

    it("two chips name the Filters button and show Clear all, which keeps the search text", () => {
      render(<LibraryPage />);
      fireEvent.change(screen.getByLabelText("Search books"), { target: { value: "Road" } });
      openFilters();
      fireEvent.click(screen.getByRole("button", { name: "Deluxe" }));
      fireEvent.click(screen.getByRole("button", { name: "Signed" }));
      expect(screen.getByRole("button", { name: "Filters, 2 active" })).toBeInTheDocument();
      fireEvent.click(within(screen.getByRole("dialog", { name: "Filters" })).getByRole("button", { name: "Clear all" }));
      expect(screen.queryByRole("button", { name: /^Remove filter/ })).toBeNull();
      expect(screen.getByRole("button", { name: "Filters" })).toBeInTheDocument();
      expect(screen.getByLabelText("Search books")).toHaveValue("Road");
      expect(count()).toBe("1 book");
    });

    it("the series chip's remove goes to #/", () => {
      setCatalog();
      window.location.hash = "#/series/Saga";
      render(<LibraryPage series="Saga" />);
      fireEvent.click(screen.getByRole("button", { name: "Remove filter: Series: Saga" }));
      expect(window.location.hash).toBe("#/");
    });
  });

  it("the pinned block is sticky and holds the toolbar and the single count", () => {
    setCatalog();
    render(<LibraryPage />);
    const pinned = screen.getByLabelText("Search books").closest(".sticky") as HTMLElement;
    expect(pinned).not.toBeNull();
    expect(pinned).toHaveClass("sticky", "top-[var(--toolbar-top)]", "z-20", "bg-surface/95", "border-b", "border-line");
    expect(pinned.className).not.toMatch(/backdrop/);
    expect(pinned).toContainElement(document.querySelector("p[aria-live='polite']") as HTMLElement);
    expect(document.querySelectorAll("p[aria-live='polite']")).toHaveLength(1);
  });

  it("Filters opens and closes the panel; it starts closed", () => {
    setCatalog();
    render(<LibraryPage />);
    const button = screen.getByRole("button", { name: "Filters" });
    expect(button).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("button", { name: "Deluxe" })).toBeNull();
    fireEvent.click(button);
    expect(button).toHaveAttribute("aria-expanded", "true");
    const panel = document.getElementById(button.getAttribute("aria-controls") ?? "") as HTMLElement;
    expect(within(panel).getByRole("button", { name: "Deluxe" })).toBeInTheDocument();
    expect(screen.getAllByRole("searchbox")).toHaveLength(1);
    fireEvent.click(button);
    expect(screen.queryByRole("button", { name: "Deluxe" })).toBeNull();
  });
});
