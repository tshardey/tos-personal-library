import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BookWithCopies } from "@/lib/types";
import { bookFixture, copyFixture } from "@/lib/flag-fixtures";

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
    expect(screen.getByLabelText("Series")).toHaveValue("Saga");
    expect(screen.queryAllByText("The Salt Road").length).toBeGreaterThan(0);
    expect(screen.queryAllByText("Paper Tide").length).toBeGreaterThan(0);
    expect(screen.queryAllByText("Glass Orchard")).toHaveLength(0);
  });

  it("shows only books carrying every chosen tag", async () => {
    setCatalog();
    render(<LibraryPage />);
    fireEvent.click(await screen.findByRole("button", { name: "ToS tags" }));
    const dialog = await screen.findByRole("dialog");
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
    fireEvent.change(screen.getByLabelText("Series"), { target: { value: "" } });
    expect(window.location.hash).toBe("#/");
    fireEvent.change(screen.getByLabelText("Series"), { target: { value: "Saga" } });
    expect(window.location.hash).toBe("#/series/Saga");
  });

  it("the ToS tags sheet takes focus, closes on Escape and returns focus", async () => {
    setCatalog();
    render(<LibraryPage />);
    const trigger = await screen.findByRole("button", { name: "ToS tags" });
    fireEvent.click(trigger);
    const dialog = await screen.findByRole("dialog");
    expect(dialog.contains(document.activeElement)).toBe(true);
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
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
    fireEvent.click(screen.getByRole("button", { name: "Unhauled" }));
    expect(card(container, "The Salt Road")).not.toBeNull();
    expect(card(container, "Glass Orchard")).not.toBeNull();
    expect(count()).toBe("2 books");
  });

  it("the Deluxe chip shows books with an on-shelf deluxe copy and their badge", () => {
    const { container } = render(<LibraryPage />);
    fireEvent.click(screen.getByRole("button", { name: "Deluxe" }));
    expect(count()).toBe("1 book");
    expect(within(card(container, "The Salt Road")!).getByText("Deluxe")).toBeInTheDocument();
  });

  it("the Signed chip shows signed books", () => {
    const { container } = render(<LibraryPage />);
    fireEvent.click(screen.getByRole("button", { name: "Signed" }));
    expect(count()).toBe("1 book");
    expect(within(card(container, "Paper Tide")!).getByText("Signed")).toBeInTheDocument();
  });

  it("Date added lists the newest day first and filters by it", () => {
    const { container } = render(<LibraryPage />);
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

  it("combines the Unhauled chip with a day", () => {
    const { container } = render(<LibraryPage />);
    fireEvent.click(screen.getByRole("button", { name: "Unhauled" }));
    fireEvent.change(screen.getByLabelText("Date added"), { target: { value: D12 } });
    expect(count()).toBe("2 books");
    expect(card(container, "Paper Tide")).toBeNull();
    expect(card(container, "Glass Orchard")).not.toBeNull();
  });
});
