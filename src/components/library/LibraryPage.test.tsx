import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BookWithCopies } from "@/lib/types";

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
