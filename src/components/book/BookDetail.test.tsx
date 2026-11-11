import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BookWithCopies } from "@/lib/types";

const h = vi.hoisted(() => ({
  catalog: {} as Record<string, unknown>,
  reload: vi.fn(),
}));

vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "u1" } }) }));
vi.mock("@/contexts/HouseholdContext", () => ({
  useHousehold: () => ({ household: { id: "h1" }, members: [] }),
}));
vi.mock("@/hooks/useCatalog", () => ({ useCatalog: () => h.catalog }));
vi.mock("@/hooks/useCopyPhotoUrls", () => ({ useCopyPhotoUrls: () => new Map() }));
vi.mock("@/lib/photo/intake-repo", () => ({ listOpenEditionLabels: vi.fn().mockResolvedValue([]) }));
vi.mock("@/lib/library-repo", () => ({
  addCopy: vi.fn(),
  deleteBook: vi.fn(),
  updateBook: vi.fn().mockResolvedValue(undefined),
  addBookTag: vi.fn().mockResolvedValue(undefined),
  removeBookTag: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/tos-tags", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tos-tags")>()),
  loadTosTags: vi.fn().mockResolvedValue({
    tags: [{ id: "fantasy", label: "Fantasy", category: "genre" }],
    stale: false,
  }),
}));
import { updateBook } from "@/lib/library-repo";
import BookDetail from "./BookDetail";

function book(over: Partial<BookWithCopies> = {}): BookWithCopies {
  return {
    id: "b1",
    householdId: "h1",
    title: "The Salt Road",
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
    seriesName: null,
    seriesVolume: null,
    userEditedFields: ["title"],
    createdAt: "",
    updatedAt: "",
    copies: [],
    ...over,
  };
}

function setCatalog(books: BookWithCopies[], extra: Record<string, unknown> = {}) {
  h.catalog = {
    books,
    tags: new Map([["b1", ["fantasy"]]]),
    loading: false,
    error: null,
    tagsError: null,
    reload: h.reload,
    ...extra,
  };
}

describe("BookDetail series and tags", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.reload.mockResolvedValue(undefined);
    window.location.hash = "";
  });

  it("shows the tags section with the loaded labels", async () => {
    setCatalog([book()]);
    render(<BookDetail id="b1" />);
    expect(await screen.findByText(/Fantasy/)).toBeInTheDocument();
  });

  it("saves a series with its volume and marks both fields edited", async () => {
    setCatalog([book()]);
    render(<BookDetail id="b1" />);
    fireEvent.click(screen.getByRole("button", { name: "Series: none" }));
    fireEvent.change(screen.getByLabelText("Volume"), { target: { value: "2" } });
    fireEvent.change(screen.getByLabelText("Filter series"), { target: { value: "Saga" } });
    fireEvent.click(screen.getByRole("button", { name: 'Add "Saga"' }));
    await waitFor(() =>
      expect(updateBook).toHaveBeenCalledWith(
        "b1",
        { seriesName: "Saga", seriesVolume: 2 },
        ["seriesName", "seriesVolume", "title"],
      ),
    );
  });

  it("shows an error when saving the series fails", async () => {
    vi.mocked(updateBook).mockRejectedValueOnce(new Error("no column"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    setCatalog([book()]);
    render(<BookDetail id="b1" />);
    fireEvent.click(screen.getByRole("button", { name: "Series: none" }));
    fireEvent.change(screen.getByLabelText("Filter series"), { target: { value: "Saga" } });
    fireEvent.click(screen.getByRole("button", { name: 'Add "Saga"' }));
    expect(await screen.findByText("Couldn't save the series.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Series: none" })).toBeInTheDocument();
  });

  it("navigates to the rest of the series", () => {
    setCatalog([book({ seriesName: "Saga", seriesVolume: 1 })]);
    render(<BookDetail id="b1" />);
    fireEvent.click(screen.getByRole("button", { name: "Show the rest of this series" }));
    expect(window.location.hash).toBe("#/series/Saga");
  });

  it("shows tags unavailable and still renders the book", () => {
    setCatalog([book()], { tags: new Map(), tagsError: "Tome of Secrets tags unavailable" });
    render(<BookDetail id="b1" />);
    expect(screen.getByText("Tome of Secrets tags unavailable.")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "The Salt Road" })).toBeInTheDocument();
  });
});
