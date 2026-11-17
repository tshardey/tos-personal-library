import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BookWithCopies } from "@/lib/types";

const h = vi.hoisted(() => ({
  catalog: {} as Record<string, unknown>,
  reload: vi.fn(),
  refresh: vi.fn(),
  tagging: {} as unknown,
  finder: { available: false } as Record<string, unknown>,
  reading: {} as Record<string, unknown>,
}));
vi.mock("@/contexts/CoverFinderContext", () => ({ useCoverFinder: () => h.finder }));
vi.mock("@/contexts/ReadingContext", () => ({ useReading: () => h.reading }));
vi.mock("@/contexts/TaggingContext", () => ({ useTagging: () => h.tagging }));

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
  setCopyFlags: vi.fn().mockResolvedValue(undefined),
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
import { addCopy, deleteBook, setCopyFlags, updateBook } from "@/lib/library-repo";
import BookDetail, { BOOK_TABS } from "./BookDetail";
import { mkTag, taggingState } from "@/components/tags/testkit";
import { copyFixture } from "@/lib/flag-fixtures.test-util";

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
    onShelf: true,
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
    refresh: h.refresh,
    ...extra,
  };
}

const tab = (name: string | RegExp) => screen.getByRole("tab", { name });
const selectTab = (name: string | RegExp) => fireEvent.click(tab(name));

beforeEach(() => {
  window.localStorage.clear();
  h.finder = { available: false };
  h.reading = { available: false, loading: false, rows: [], byBook: new Map(), userId: null, setStatus: vi.fn(), reload: vi.fn() };
});

describe("BookDetail series and tags", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.reload.mockResolvedValue(undefined);
    h.refresh.mockResolvedValue(true);
    h.tagging = taggingState({ available: false });
    window.location.hash = "";
  });

  it("hides Library tags when tagging is unavailable", () => {
    setCatalog([book()]);
    render(<BookDetail id="b1" />);
    expect(screen.queryByText("Library tags")).not.toBeInTheDocument();
  });

  it("Library tags are on the Tags tab", () => {
    h.tagging = taggingState({ vocabulary: [mkTag("dragons", "Dragons", "creature")] });
    setCatalog([book()]);
    render(<BookDetail id="b1" />);
    selectTab("Tags");
    expect(screen.getByText("Library tags")).toBeInTheDocument();
    expect(h.refresh).not.toHaveBeenCalled();
  });

  it("refreshes the catalogue when tagsVersion bumps", () => {
    h.tagging = taggingState({ tagsVersion: 0 });
    setCatalog([book()]);
    const { rerender } = render(<BookDetail id="b1" />);
    h.tagging = taggingState({ tagsVersion: 1 });
    rerender(<BookDetail id="b1" />);
    expect(h.refresh).toHaveBeenCalledTimes(1);
  });

  it("shows the tags section with the loaded labels", async () => {
    setCatalog([book()]);
    render(<BookDetail id="b1" />);
    selectTab("Tome of Secrets");
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
    selectTab("Tome of Secrets");
    expect(screen.getByText("Tome of Secrets tags unavailable.")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "The Salt Road" })).toBeInTheDocument();
  });
});

describe("BookDetail cover finder", () => {
  it("shows no cover finder outside a provider", () => {
    setCatalog([book()]);
    render(<BookDetail id="b1" />);
    expect(screen.queryByRole("button", { name: "Find cover" })).toBeNull();
  });
});

describe("BookDetail unhauled copies", () => {
  const cp = (id: string, unhauledAt: string | null) => copyFixture({ id, bookId: "b1", unhauledAt });
  beforeEach(() => {
    vi.clearAllMocks();
    h.reload.mockResolvedValue(undefined);
  });

  it("lists both copies with counts and no book note when one is still on the shelf", () => {
    setCatalog([book({ copies: [cp("c1", "2026-11-12T09:00:00"), cp("c2", null)] })]);
    render(<BookDetail id="b1" />);
    selectTab(/^Copies/);
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    expect(screen.getByText("1 on the shelf · 1 unhauled")).toBeInTheDocument();
    expect(screen.queryByText(/This book is hidden from the library/)).toBeNull();
  });

  it("keeps a book open with a note when its only copy is unhauled, and undo reloads", async () => {
    setCatalog([book({ onShelf: false, copies: [cp("c1", "2026-11-12T09:00:00")] })]);
    render(<BookDetail id="b1" />);
    selectTab(/^Copies/);
    expect(
      screen.getByText(
        "Unhauled. This book is hidden from the library unless you search for it or use the Unhauled filter.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("0 on the shelf · 1 unhauled")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Undo unhaul" }));
    await waitFor(() => expect(h.reload).toHaveBeenCalled());
    expect(setCopyFlags).toHaveBeenCalledWith(expect.objectContaining({ id: "c1" }), { unhauledAt: null });
  });
});

describe("BookDetail tabs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.reload.mockResolvedValue(undefined);
    h.refresh.mockResolvedValue(true);
    h.tagging = taggingState({ available: false });
    window.location.hash = "";
  });
  const twoCopies = () => [copyFixture({ id: "c1", bookId: "b1" }), copyFixture({ id: "c2", bookId: "b1" })];

  it("names the tabs and selects Overview by default", () => {
    setCatalog([book({ synopsis: "A salt caravan.", copies: twoCopies() })]);
    render(<BookDetail id="b1" />);
    expect(screen.getByRole("tablist", { name: "Book sections" })).toBeInTheDocument();
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual([
      "Overview",
      "Copies (2)",
      "Tags",
      "Tome of Secrets",
    ]);
    expect(tab("Overview")).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("A salt caravan.")).toBeInTheDocument();
  });

  it("holds the Your reading group on Overview", () => {
    h.reading = { ...h.reading, available: true, userId: "u1" };
    setCatalog([book()]);
    render(<BookDetail id="b1" />);
    expect(screen.getByRole("group", { name: "Your reading" })).toBeInTheDocument();
  });

  it("shows the copies and Add copy on the Copies tab", () => {
    setCatalog([book({ copies: twoCopies() })]);
    render(<BookDetail id="b1" />);
    selectTab("Copies (2)");
    const panel = screen.getByRole("tabpanel");
    expect(within(panel).getAllByRole("listitem")).toHaveLength(2);
    expect(within(panel).getByRole("button", { name: "Add copy" })).toBeInTheDocument();
  });

  it("says Library tags aren't available yet while tagging is off", () => {
    setCatalog([book()]);
    render(<BookDetail id="b1" />);
    selectTab("Tags");
    expect(screen.getByText("Library tags aren't available yet.")).toBeInTheDocument();
  });

  it("shows Tome of Secrets tags unavailable when the tags failed", () => {
    setCatalog([book()], { tags: new Map(), tagsError: "failed" });
    render(<BookDetail id="b1" />);
    selectTab("Tome of Secrets");
    expect(screen.getByText("Tome of Secrets tags unavailable.")).toBeInTheDocument();
  });

  it("lists the four tabs in BOOK_TABS", () => {
    expect([...BOOK_TABS]).toEqual(["overview", "copies", "tags", "tos"]);
  });
});

describe("BookDetail remembered tab", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.tagging = taggingState({ available: false });
  });

  it("writes the chosen tab and opens the next book on it", () => {
    setCatalog([book(), book({ id: "b2", title: "Glass Orchard" })]);
    const { unmount } = render(<BookDetail id="b1" />);
    selectTab("Tags");
    expect(window.localStorage.getItem("tpl_book_tab")).toBe("tags");
    unmount();
    render(<BookDetail id="b2" />);
    expect(tab("Tags")).toHaveAttribute("aria-selected", "true");
  });

  it("opens on Overview for an unknown stored tab", () => {
    window.localStorage.setItem("tpl_book_tab", "reading");
    setCatalog([book()]);
    render(<BookDetail id="b1" />);
    expect(tab("Overview")).toHaveAttribute("aria-selected", "true");
  });

  it("opens on Overview when storage throws", () => {
    const spy = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    setCatalog([book()]);
    render(<BookDetail id="b1" />);
    expect(tab("Overview")).toHaveAttribute("aria-selected", "true");
    spy.mockRestore();
  });
});

describe("BookDetail left column and menu", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.reload.mockResolvedValue(undefined);
    h.tagging = taggingState({ available: false });
  });

  it("swaps in the book form for Edit book and Cancel restores the tabs", () => {
    setCatalog([book()]);
    render(<BookDetail id="b1" />);
    fireEvent.click(screen.getByRole("button", { name: "Edit book" }));
    expect(screen.getByRole("button", { name: "Save book" })).toBeInTheDocument();
    expect(screen.queryByRole("tablist")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByRole("tablist", { name: "Book sections" })).toBeInTheDocument();
  });

  it("shows Find cover when the finder is available", () => {
    h.finder = {
      available: true,
      marks: new Map(),
      latest: new Map(),
      budget: null,
      mark: vi.fn(),
      unmark: vi.fn(),
      findNow: vi.fn(),
      retry: vi.fn(),
    };
    setCatalog([book()]);
    render(<BookDetail id="b1" />);
    expect(screen.getByRole("button", { name: "Find cover" })).toBeInTheDocument();
  });

  it("shows Mark read only when reading is available", () => {
    setCatalog([book()]);
    const { unmount } = render(<BookDetail id="b1" />);
    expect(screen.queryByRole("button", { name: "Mark read" })).toBeNull();
    unmount();
    h.reading = { ...h.reading, available: true, userId: "u1" };
    render(<BookDetail id="b1" />);
    expect(screen.getByRole("button", { name: "Mark read" })).toBeInTheDocument();
  });

  it("More actions > Add copy selects Copies and opens the copy form", () => {
    setCatalog([book({ copies: [copyFixture({ id: "c1", bookId: "b1" })] })]);
    render(<BookDetail id="b1" />);
    fireEvent.click(screen.getByRole("button", { name: "More actions" }));
    fireEvent.click(screen.getByRole("button", { name: "Add copy" }));
    expect(tab(/^Copies/)).toHaveAttribute("aria-selected", "true");
    expect(window.localStorage.getItem("tpl_book_tab")).toBe("copies");
    const panel = screen.getByRole("tabpanel");
    expect(within(panel).getByRole("button", { name: "Cancel" })).toBeInTheDocument();
    expect(vi.mocked(addCopy)).not.toHaveBeenCalled();
  });

  it("More actions > Delete book asks to confirm", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    vi.mocked(deleteBook).mockResolvedValue(undefined);
    setCatalog([book()]);
    render(<BookDetail id="b1" />);
    fireEvent.click(screen.getByRole("button", { name: "More actions" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete book" }));
    expect(confirm).toHaveBeenCalledWith("Delete this book and all its copies?");
    await waitFor(() => expect(deleteBook).toHaveBeenCalledWith("b1"));
    confirm.mockRestore();
  });

  it("Your reading: Read from another tab selects Overview and focuses the group", async () => {
    h.reading = {
      ...h.reading,
      available: true,
      userId: "u1",
      byBook: new Map([["b1", new Map([["u1", { state: "read", finishedOn: "2026-11-01" }]])]]),
    };
    setCatalog([book()]);
    render(<BookDetail id="b1" />);
    selectTab("Tags");
    fireEvent.click(screen.getByRole("button", { name: "Your reading: Read" }));
    expect(tab("Overview")).toHaveAttribute("aria-selected", "true");
    await waitFor(() => expect(screen.getByRole("group", { name: "Your reading" })).toHaveFocus());
  });
});
