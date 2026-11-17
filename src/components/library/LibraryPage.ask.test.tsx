import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TaggingState } from "@/contexts/TaggingContext";
import type { ReadingState } from "@/contexts/ReadingContext";
import type { BookWithCopies, HouseholdMember } from "@/lib/types";
import type { AskResponse } from "@/lib/tagging/types";
import { bookFixture, copyFixture } from "@/lib/flag-fixtures.test-util";
import { aiBudget, mkTag, taggingState } from "@/components/tags/testkit";

const h = vi.hoisted(() => ({
  catalog: {} as Record<string, unknown>,
  tagging: null as unknown as TaggingState,
  members: [] as HouseholdMember[],
  reading: null as unknown as ReadingState,
}));

vi.mock("@/contexts/HouseholdContext", () => ({ useHousehold: () => ({ household: { id: "h1" }, members: h.members }) }));
vi.mock("@/contexts/ReadingContext", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/contexts/ReadingContext")>()),
  useReading: () => h.reading,
}));
vi.mock("@/hooks/useCatalog", () => ({ useCatalog: () => h.catalog }));
vi.mock("@/hooks/useCopyPhotoUrls", () => ({ useCopyPhotoUrls: () => new Map() }));
vi.mock("@/contexts/TaggingContext", () => ({ useTagging: () => h.tagging }));
vi.mock("@/lib/tos-tags", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tos-tags")>()),
  loadTosTags: vi.fn().mockResolvedValue({ tags: [], stale: false }),
}));
import LibraryPage from "./LibraryPage";

const openFilters = () => fireEvent.click(screen.getByRole("button", { name: /^Filters/ }));
import { askBookIds } from "@/lib/ask";
import { DEFAULT_VIEW, takeScrollAnchor } from "@/lib/library-view";
import { UNAVAILABLE_READING } from "@/contexts/ReadingContext";

const shelved = (title: string, over: Partial<BookWithCopies> = {}) => bookFixture(title, [copyFixture()], over);
const salt = shelved("The Salt Road", { coverUrl: "https://example.test/salt.jpg" });
const glass = shelved("Glass Orchard");
const paper = shelved("Paper Tide");
const unhauled = bookFixture("Hollow Tide", [copyFixture({ unhauledAt: "2026-11-01T00:00:00" })]);
const books = [salt, glass, paper, unhauled];

const vocabulary = [
  mkTag("vampires", "Vampires", "creature"),
  mkTag("found-family", "Found family", "trope"),
  mkTag("cozy", "Cozy", "mood"),
  mkTag("retired", "Retired tag", "mood", false),
];
const libraryTagsByBook = new Map([
  ["The Salt Road", ["vampires", "found-family"]],
  ["Glass Orchard", ["vampires"]],
  ["Paper Tide", ["found-family"]],
]);

function setup(over: Partial<TaggingState> = {}, catalogBooks: BookWithCopies[] = books) {
  h.catalog = {
    books: catalogBooks,
    tags: new Map(),
    loading: false,
    error: null,
    tagsError: null,
    reload: vi.fn(),
    refresh: vi.fn(),
  };
  h.tagging = taggingState({ vocabulary, libraryTagsByBook, ...over });
  h.members = [];
  h.reading = UNAVAILABLE_READING;
}

const okResponse: AskResponse = {
  outcome: "ok",
  answerable: true,
  note: null,
  matches: [
    { bookId: "Paper Tide", confidence: 91, reason: "Letters across a flooded city." },
    { bookId: "Gone Book", confidence: 80, reason: "Should be skipped." },
    { bookId: "The Salt Road", confidence: 62, reason: "A long walk with strangers." },
  ],
};

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const search = () => screen.getByLabelText("Search books");
const askButton = () => screen.getByRole("button", { name: "Ask ✨" });
const titles = () => screen.queryAllByRole("link").map((l) => l.getAttribute("data-book-id"));

describe("LibraryPage library tag filter", () => {
  beforeEach(() => vi.clearAllMocks());

  it("groups active tags by category in D3 order and filters with all-of matching", () => {
    setup();
    render(<LibraryPage />);
    openFilters();
    fireEvent.click(screen.getByRole("button", { name: "Library tags" }));
    const dialog = screen.getByRole("dialog", { name: "Library tags" });
    const legends = within(dialog)
      .getAllByRole("group")
      .map((g) => g.querySelector("legend")?.textContent);
    expect(legends).toEqual(["Tropes", "Creatures and beings", "Mood and pace"]);
    expect(within(dialog).queryByLabelText("Retired tag")).not.toBeInTheDocument();
    fireEvent.click(within(dialog).getByLabelText("Vampires"));
    fireEvent.click(within(dialog).getByLabelText("Found family"));
    fireEvent.click(within(dialog).getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(titles()).toEqual(["The Salt Road"]);
    // Scoped to the panel: the chips row shows the same labels as Chip spans.
    const filtersButton = screen.getByRole("button", { name: /^Filters/ });
    const panel = document.getElementById(filtersButton.getAttribute("aria-controls") ?? "") as HTMLElement;
    expect(within(panel).getByText("Vampires", { selector: "span" })).toBeInTheDocument();
    expect(within(panel).getByText("Found family", { selector: "span" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    expect(titles()).toEqual(["The Salt Road", "Glass Orchard", "Paper Tide"]);
  });
});

describe("LibraryPage Ask", () => {
  beforeEach(() => vi.clearAllMocks());

  it("is disabled while the box is blank", () => {
    setup();
    render(<LibraryPage />);
    expect(askButton()).toBeDisabled();
    fireEvent.change(search(), { target: { value: "   " } });
    expect(askButton()).toBeDisabled();
    fireEvent.change(search(), { target: { value: "a quiet book" } });
    expect(askButton()).toBeEnabled();
  });

  it("is disabled at the Ask budget cap, with the copy", () => {
    setup({ budgets: { tagging: null, ask: { ...aiBudget(500_000, 0), spentMicro: 500_000 } } });
    render(<LibraryPage />);
    fireEvent.change(search(), { target: { value: "a quiet book" } });
    expect(askButton()).toBeDisabled();
    expect(screen.getByText("This month's Ask budget is used up.")).toBeInTheDocument();
  });

  it("is enabled while some Ask budget is left, with a zero reserve", () => {
    setup({ budgets: { tagging: null, ask: { ...aiBudget(500_000, 0), spentMicro: 499_999 } } });
    render(<LibraryPage />);
    fireEvent.change(search(), { target: { value: "a quiet book" } });
    expect(askButton()).toBeEnabled();
    expect(screen.queryByText("This month's Ask budget is used up.")).not.toBeInTheDocument();
  });

  it("is disabled over 2,000 books, with the copy", () => {
    const many = Array.from({ length: 2001 }, (_, i) => shelved(`Book ${i}`));
    setup({}, many);
    render(<LibraryPage />);
    fireEvent.change(search(), { target: { value: "a quiet book" } });
    expect(askButton()).toBeDisabled();
    expect(screen.getByText("Too many books to ask about at once. Narrow the filters.")).toBeInTheDocument();
  });

  it("sends the trimmed prompt and exactly askBookIds' ids, then shows the rows in order", async () => {
    const d = deferred<AskResponse>();
    const ask = vi.fn().mockReturnValue(d.promise);
    setup({ ask });
    render(<LibraryPage />);
    openFilters();
    fireEvent.click(screen.getByRole("button", { name: "Library tags" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByLabelText("Found family"));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Close" }));
    // Review Focus 1: "Paper" in the box would title-match, but the Ask set ignores the box text.
    fireEvent.change(search(), { target: { value: "  Paper  " } });
    fireEvent.click(askButton());
    const expected = askBookIds(
      books,
      { ...DEFAULT_VIEW, query: "  Paper  ", libraryTags: ["found-family"] },
      {
        tagsByBook: new Map(),
        libraryTagsByBook,
        series: null,
        cover: { available: false, marks: new Map(), latest: new Map() },
        readStatusByBook: new Map(),
      },
    );
    expect(expected).toEqual(["The Salt Road", "Paper Tide"]);
    expect(ask).toHaveBeenCalledWith("Paper", expected);
    expect(screen.getByText("Asking…")).toBeInTheDocument();
    expect(askButton()).toBeDisabled();
    await act(async () => d.resolve(okResponse));
    expect(screen.getByRole("heading", { name: 'Books for "Paper"' })).toBeInTheDocument();
    const rows = screen.getAllByRole("listitem");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent("Paper Tide");
    expect(rows[0]).toHaveTextContent("91%");
    expect(rows[0]).toHaveTextContent("Letters across a flooded city.");
    expect(rows[1]).toHaveTextContent("The Salt Road");
    expect(rows[1]).toHaveTextContent("62%");
    expect(within(rows[0]).getByRole("link")).toHaveAttribute("href", "#/book/Paper%20Tide");
    expect(screen.getByText("2 matches")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Select" })).not.toBeInTheDocument();
    fireEvent.click(within(rows[1]).getByRole("link"));
    expect(takeScrollAnchor()).toMatchObject({ bookId: "The Salt Road" });
  });

  it("keeps the pinned toolbar while results show, hides Select, and keeps one live count", async () => {
    setup({ ask: vi.fn().mockResolvedValue(okResponse) });
    render(<LibraryPage />);
    expect(screen.getByRole("button", { name: "Select" })).toBeInTheDocument();
    fireEvent.change(search(), { target: { value: "a long walk" } });
    fireEvent.click(askButton());
    await screen.findByRole("heading", { name: 'Books for "a long walk"' });
    const pinned = search().closest(".sticky") as HTMLElement;
    expect(pinned).toContainElement(askButton());
    expect(within(pinned).getByRole("button", { name: "Filters" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Select" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Select all" })).not.toBeInTheDocument();
    const live = document.querySelectorAll("p[aria-live='polite']");
    expect(live).toHaveLength(1);
    expect(live[0]).toHaveTextContent("2 matches");
  });

  it("clips the prompt to 300 characters", async () => {
    const ask = vi.fn().mockResolvedValue(okResponse);
    setup({ ask });
    render(<LibraryPage />);
    fireEvent.change(search(), { target: { value: "x".repeat(400) } });
    fireEvent.click(askButton());
    await waitFor(() => expect(ask).toHaveBeenCalled());
    expect(ask.mock.calls[0][0]).toHaveLength(300);
  });

  it("Clear brings the wall back", async () => {
    setup({ ask: vi.fn().mockResolvedValue(okResponse) });
    render(<LibraryPage />);
    fireEvent.change(search(), { target: { value: "Glass" } });
    fireEvent.click(askButton());
    await screen.findByRole("heading", { name: 'Books for "Glass"' });
    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    expect(screen.queryByRole("heading", { name: /Books for/ })).not.toBeInTheDocument();
    expect(search()).toHaveValue("Glass");
    expect(titles()).toEqual(["Glass Orchard"]);
    expect(screen.getByRole("button", { name: "Select" })).toBeInTheDocument();
  });

  it("an unanswerable prompt shows the note and no rows", async () => {
    setup({
      ask: vi.fn().mockResolvedValue({ outcome: "ok", answerable: false, note: "That needs the full text.", matches: [] }),
    });
    render(<LibraryPage />);
    fireEvent.change(search(), { target: { value: "the third word on page 9" } });
    fireEvent.click(askButton());
    expect(await screen.findByText("That needs the full text.")).toBeInTheDocument();
    expect(screen.queryAllByRole("listitem")).toHaveLength(0);
  });

  it("no matches shows the empty copy", async () => {
    setup({ ask: vi.fn().mockResolvedValue({ outcome: "ok", answerable: true, note: null, matches: [] }) });
    render(<LibraryPage />);
    fireEvent.change(search(), { target: { value: "dragons" } });
    fireEvent.click(askButton());
    expect(await screen.findByText("No books on your shelf fit this prompt.")).toBeInTheDocument();
  });

  it.each([
    ["budget", "This month's Ask budget is used up."],
    ["misconfigured", "Ask isn't set up yet."],
    ["billing", "Ask stopped: the Claude account's spending limit is reached."],
    ["too_large", "Too many books to ask about at once. Narrow the filters."],
    ["retry_later", "Ask couldn't answer. Try again."],
    ["rejected", "Ask couldn't answer. Try again."],
    ["failed", "Ask couldn't answer. Try again."],
    ["empty", "Ask couldn't answer. Try again."],
  ])("the %s outcome shows its copy", async (outcome, copy) => {
    setup({ ask: vi.fn().mockResolvedValue({ outcome }) });
    render(<LibraryPage />);
    fireEvent.change(search(), { target: { value: "dragons" } });
    fireEvent.click(askButton());
    expect(await screen.findByText(copy)).toBeInTheDocument();
    expect(screen.queryAllByRole("listitem")).toHaveLength(0);
  });

  it("a thrown ask shows the generic copy", async () => {
    setup({ ask: vi.fn().mockRejectedValue(new Error("network")) });
    render(<LibraryPage />);
    fireEvent.change(search(), { target: { value: "dragons" } });
    fireEvent.click(askButton());
    expect(await screen.findByText("Ask couldn't answer. Try again.")).toBeInTheDocument();
  });

  it("a double tap sends one Ask", async () => {
    const ask = vi.fn().mockResolvedValue(okResponse);
    setup({ ask });
    render(<LibraryPage />);
    fireEvent.change(search(), { target: { value: "dragons" } });
    const button = askButton();
    fireEvent.click(button);
    fireEvent.click(button);
    await screen.findByRole("heading", { name: 'Books for "dragons"' });
    expect(ask).toHaveBeenCalledTimes(1);
  });

  it("drops a response that arrives after the view changed", async () => {
    const d = deferred<AskResponse>();
    setup({ ask: vi.fn().mockReturnValue(d.promise) });
    render(<LibraryPage />);
    openFilters();
    fireEvent.change(search(), { target: { value: "dragons" } });
    fireEvent.click(askButton());
    fireEvent.click(screen.getByRole("button", { name: "Shared" }));
    await act(async () => d.resolve(okResponse));
    expect(screen.queryByRole("heading", { name: /Books for/ })).not.toBeInTheDocument();
    expect(screen.queryAllByRole("listitem")).toHaveLength(0);
  });

  it("Review Focus 5: results survive a remount without a second Ask, and typing clears them", async () => {
    const ask = vi.fn().mockResolvedValue(okResponse);
    setup({ ask });
    const first = render(<LibraryPage />);
    fireEvent.change(search(), { target: { value: "a long walk" } });
    fireEvent.click(askButton());
    await screen.findByRole("heading", { name: 'Books for "a long walk"' });
    fireEvent.click(within(screen.getAllByRole("listitem")[0]).getByRole("link"));
    first.unmount();
    render(<LibraryPage />);
    expect(screen.getByRole("heading", { name: 'Books for "a long walk"' })).toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    expect(ask).toHaveBeenCalledTimes(1);
    fireEvent.change(search(), { target: { value: "a long walk!" } });
    expect(screen.queryByRole("heading", { name: /Books for/ })).not.toBeInTheDocument();
    expect(ask).toHaveBeenCalledTimes(1);
  });
});

describe("LibraryPage with tagging unavailable", () => {
  it("renders no Ask button and no Library tags button", () => {
    setup({ available: false });
    render(<LibraryPage />);
    openFilters();
    expect(screen.queryByRole("button", { name: "Ask ✨" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Library tags" })).not.toBeInTheDocument();
    expect(titles()).toEqual(["The Salt Road", "Glass Orchard", "Paper Tide"]);
  });
});

describe("LibraryPage Ask and the series", () => {
  beforeEach(() => vi.clearAllMocks());
  const saga = [shelved("The Salt Road", { seriesName: "Saga", seriesVolume: 1 }), glass, shelved("Paper Tide", { seriesName: "Saga", seriesVolume: 2 })];

  it("a series change clears the results", async () => {
    setup({ ask: vi.fn().mockResolvedValue(okResponse) }, saga);
    render(<LibraryPage />);
    openFilters();
    fireEvent.change(search(), { target: { value: "dragons" } });
    fireEvent.click(askButton());
    await screen.findByRole("heading", { name: 'Books for "dragons"' });
    fireEvent.change(screen.getByLabelText("Series"), { target: { value: "Saga" } });
    expect(screen.queryByRole("heading", { name: /Books for/ })).not.toBeInTheDocument();
  });

  it("a series change during an Ask drops its answer", async () => {
    const d = deferred<AskResponse>();
    setup({ ask: vi.fn().mockReturnValue(d.promise) }, saga);
    render(<LibraryPage />);
    openFilters();
    fireEvent.change(search(), { target: { value: "dragons" } });
    fireEvent.click(askButton());
    fireEvent.change(screen.getByLabelText("Series"), { target: { value: "Saga" } });
    await act(async () => d.resolve(okResponse));
    expect(screen.queryByRole("heading", { name: /Books for/ })).not.toBeInTheDocument();
  });

  it("a series change from the route clears the results, but a remount on the same series keeps them", async () => {
    const ask = vi.fn().mockResolvedValue(okResponse);
    setup({ ask }, saga);
    const first = render(<LibraryPage series="Saga" />);
    fireEvent.change(search(), { target: { value: "dragons" } });
    fireEvent.click(askButton());
    await screen.findByRole("heading", { name: 'Books for "dragons"' });
    first.unmount();
    const second = render(<LibraryPage series="Saga" />);
    expect(screen.getByRole("heading", { name: 'Books for "dragons"' })).toBeInTheDocument();
    second.rerender(<LibraryPage />);
    expect(screen.queryByRole("heading", { name: /Books for/ })).not.toBeInTheDocument();
    expect(ask).toHaveBeenCalledTimes(1);
  });
});

describe("LibraryPage read status filter", () => {
  beforeEach(() => vi.clearAllMocks());
  const member = (userId: string, displayName: string): HouseholdMember => ({
    householdId: "h1",
    userId,
    displayName,
    createdAt: "",
  });
  const readByMe = new Map([["Glass Orchard", new Map([["u-a", { state: "read" as const, finishedOn: null }]])]]);
  function setupReading(ask = vi.fn().mockResolvedValue(okResponse)) {
    setup({ ask });
    h.members = [member("u-a", "Member A"), member("u-b", "Member B")];
    h.reading = { ...UNAVAILABLE_READING, available: true, userId: "u-a", byBook: readByMe };
    return ask;
  }
  const statusSelect = () => screen.getByLabelText("Read status");

  it("offers D10's options in order", () => {
    setupReading();
    render(<LibraryPage />);
    openFilters();
    const labels = within(statusSelect()).getAllByRole("option").map((o) => o.textContent);
    expect(labels).toEqual([
      "Any read status",
      "Unread by me",
      "Read by me",
      "Did not finish (me)",
      "Unread by Member B",
      "Read by Member B",
      "Did not finish (Member B)",
    ]);
  });

  it("Unread by me narrows the wall and the count", () => {
    setupReading();
    render(<LibraryPage />);
    openFilters();
    fireEvent.change(statusSelect(), { target: { value: "u-a:unread" } });
    expect(titles()).toEqual(["The Salt Road", "Paper Tide"]);
    expect(screen.getByText("2 books")).toBeInTheDocument();
  });

  it("Ask sends only the ids that pass the read status filter", async () => {
    const ask = setupReading();
    render(<LibraryPage />);
    openFilters();
    fireEvent.change(statusSelect(), { target: { value: "u-a:unread" } });
    fireEvent.change(search(), { target: { value: "a quiet book" } });
    fireEvent.click(askButton());
    await waitFor(() => expect(ask).toHaveBeenCalled());
    expect(ask).toHaveBeenCalledWith("a quiet book", ["The Salt Road", "Paper Tide"]);
  });

  it("choosing a read status clears shown Ask results", async () => {
    setupReading();
    render(<LibraryPage />);
    openFilters();
    fireEvent.change(search(), { target: { value: "a quiet book" } });
    fireEvent.click(askButton());
    await screen.findByRole("heading", { name: 'Books for "a quiet book"' });
    fireEvent.change(statusSelect(), { target: { value: "u-a:read" } });
    expect(screen.queryByRole("heading", { name: 'Books for "a quiet book"' })).not.toBeInTheDocument();
    expect(askButton()).toBeEnabled();
  });

  it("renders no select and filters nothing while reading is unavailable", () => {
    setup();
    render(<LibraryPage />);
    openFilters();
    expect(screen.queryByLabelText("Read status")).not.toBeInTheDocument();
    expect(titles()).toEqual(["The Salt Road", "Glass Orchard", "Paper Tide"]);
  });

  it("treats a filter naming a user who left the household as no filter", () => {
    setupReading();
    render(<LibraryPage />);
    openFilters();
    fireEvent.change(statusSelect(), { target: { value: "u-b:unread" } });
    h.members = [member("u-a", "Member A")];
    cleanup();
    render(<LibraryPage />);
    openFilters();
    expect(statusSelect()).toHaveValue("any");
    expect(titles()).toEqual(["The Salt Road", "Glass Orchard", "Paper Tide"]);
  });
});
