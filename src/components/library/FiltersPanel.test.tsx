import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TaggingState } from "@/contexts/TaggingContext";
import type { ReadingState } from "@/contexts/ReadingContext";
import type { BookWithCopies, HouseholdMember } from "@/lib/types";
import { bookFixture, copyFixture } from "@/lib/flag-fixtures.test-util";
import { mkTag, taggingState } from "@/components/tags/testkit";

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
  loadTosTags: vi.fn().mockResolvedValue({ tags: [{ id: "fantasy", label: "Fantasy", category: "genre" }], stale: false }),
}));
import LibraryPage from "./LibraryPage";
import { UNAVAILABLE_READING } from "@/contexts/ReadingContext";

const member = (userId: string, displayName: string): HouseholdMember => ({ householdId: "h1", userId, displayName, createdAt: "" });
const MEMBER_A = member("00000000-0000-4000-8000-00000000000a", "Member A");
const MEMBER_B = member("00000000-0000-4000-8000-00000000000b", "Member B");

const books: BookWithCopies[] = [
  bookFixture("The Salt Road", [copyFixture({ deluxe: true })], { seriesName: "Saga", seriesVolume: 1 }),
  bookFixture("Glass Orchard", [copyFixture()]),
  bookFixture("Paper Tide", [copyFixture({ signed: true })]),
];
const readBy = new Map([
  ["Glass Orchard", new Map([[MEMBER_A.userId, { state: "read" as const, finishedOn: null }]])],
  ["Paper Tide", new Map([[MEMBER_B.userId, { state: "read" as const, finishedOn: null }]])],
]);
const vocabulary = [mkTag("vampires", "Vampires", "creature")];

function setup({ reading = true, tagging = {} as Partial<TaggingState>, members = [MEMBER_A, MEMBER_B] } = {}) {
  h.catalog = { books, tags: new Map(), loading: false, error: null, tagsError: null, reload: vi.fn(), refresh: vi.fn() };
  h.tagging = taggingState({ vocabulary, libraryTagsByBook: new Map([["Glass Orchard", ["vampires"]]]), ...tagging });
  h.members = members;
  h.reading = reading
    ? { ...UNAVAILABLE_READING, available: true, userId: MEMBER_A.userId, byBook: readBy }
    : UNAVAILABLE_READING;
}

const filtersButton = () => screen.getByRole("button", { name: /^Filters/ });
const openFilters = () => fireEvent.click(filtersButton());
const count = () => document.querySelector("p[aria-live='polite']")?.textContent;
const titles = () => screen.queryAllByRole("link").map((l) => l.getAttribute("data-book-id"));
const headings = (el: HTMLElement) => within(el).getAllByRole("heading").map((x) => x.textContent);

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

beforeEach(() => {
  vi.clearAllMocks();
  window.location.hash = "";
  window.localStorage.clear();
});

describe("FiltersPanel on the computer", () => {
  const original = window.matchMedia;
  beforeEach(stubDesktop);
  afterEach(() => {
    window.matchMedia = original;
  });

  it("Filters toggles a non-modal region with the D6 groups in order", async () => {
    setup();
    render(<LibraryPage />);
    expect(filtersButton()).toHaveAttribute("aria-expanded", "false");
    expect(filtersButton()).not.toHaveAttribute("aria-controls");
    openFilters();
    const region = screen.getByRole("region", { name: "Filters" });
    expect(filtersButton()).toHaveAttribute("aria-expanded", "true");
    expect(filtersButton()).toHaveAttribute("aria-controls", region.id);
    await screen.findByRole("button", { name: "ToS tags" });
    expect(headings(region)).toEqual(["Reading", "Owner & Copy", "Tags & Series", "Edition, Covers & Dates"]);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByLabelText("Search books").closest(".sticky")).toContainElement(region);
  });

  it("Deluxe narrows the count live while the panel stays open", () => {
    setup();
    render(<LibraryPage />);
    openFilters();
    expect(count()).toBe("3 books");
    fireEvent.click(within(screen.getByRole("region", { name: "Filters" })).getByRole("button", { name: "Deluxe" }));
    expect(count()).toBe("1 book");
    expect(screen.getByRole("region", { name: "Filters" })).toBeInTheDocument();
  });

  it("Escape inside closes it and focuses Filters", () => {
    setup();
    render(<LibraryPage />);
    openFilters();
    const region = screen.getByRole("region", { name: "Filters" });
    fireEvent.keyDown(within(region).getByRole("button", { name: "Deluxe" }), { key: "Escape" });
    expect(screen.queryByRole("region", { name: "Filters" })).toBeNull();
    expect(document.activeElement).toBe(filtersButton());
    expect(filtersButton()).toHaveAttribute("aria-expanded", "false");
  });

  it("Clear all resets the filters and keeps the search", () => {
    setup();
    render(<LibraryPage />);
    fireEvent.change(screen.getByLabelText("Search books"), { target: { value: "Road" } });
    openFilters();
    const region = screen.getByRole("region", { name: "Filters" });
    fireEvent.click(within(region).getByRole("button", { name: "Deluxe" }));
    expect(filtersButton()).toHaveAccessibleName("Filters, 1 active");
    fireEvent.click(within(region).getByRole("button", { name: "Clear all" }));
    expect(filtersButton()).toHaveAccessibleName("Filters");
    expect(within(region).getByRole("button", { name: "Deluxe" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByLabelText("Search books")).toHaveValue("Road");
  });
});

describe("FiltersPanel on the phone", () => {
  it("Filters opens a sheet whose first group View holds Sort and Cover size, and Done closes it", () => {
    setup();
    render(<LibraryPage />);
    openFilters();
    const sheet = screen.getByRole("dialog", { name: "Filters" });
    expect(headings(sheet)[0]).toBe("Filters");
    expect(headings(sheet)[1]).toBe("View");
    const view = within(sheet).getByRole("group", { name: "View" });
    expect(within(view).getByLabelText("Sort")).toBeInTheDocument();
    expect(within(view).getByRole("group", { name: "Cover size" })).toBeInTheDocument();
    expect(headings(sheet).slice(2)).toEqual(["Reading", "Owner & Copy", "Tags & Series", "Edition, Covers & Dates"]);
    expect(screen.queryByRole("region", { name: "Filters" })).toBeNull();
    fireEvent.click(within(sheet).getByRole("button", { name: "Done" }));
    expect(screen.queryByRole("dialog", { name: "Filters" })).toBeNull();
    expect(filtersButton()).toHaveAttribute("aria-expanded", "false");
  });

  it("Review Focus 4: one Escape in the ToS tags sheet closes only it, and focus returns to its button", async () => {
    setup();
    render(<LibraryPage />);
    openFilters();
    const sheet = screen.getByRole("dialog", { name: "Filters" });
    const trigger = await within(sheet).findByRole("button", { name: "ToS tags" });
    fireEvent.click(trigger);
    const tags = screen.getByRole("dialog", { name: "ToS tags" });
    fireEvent.keyDown(tags, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "ToS tags" })).toBeNull();
    expect(screen.getByRole("dialog", { name: "Filters" })).toBeInTheDocument();
    expect(document.activeElement).toBe(trigger);
  });
});

describe("FiltersPanel Reading group", () => {
  const readGroup = () => screen.getByRole("group", { name: "Read status" });
  const press = (name: string) => fireEvent.click(within(readGroup()).getByRole("button", { name }));

  it("has the four pressed buttons, Any pressed", () => {
    setup();
    render(<LibraryPage />);
    openFilters();
    const buttons = within(readGroup()).getAllByRole("button");
    expect(buttons.map((b) => b.textContent)).toEqual(["Any", "Unread", "Read", "Did not finish"]);
    expect(buttons.map((b) => b.getAttribute("aria-pressed"))).toEqual(["true", "false", "false", "false"]);
    const forSelect = screen.getByLabelText("For") as HTMLSelectElement;
    expect(Array.from(forSelect.options).map((o) => o.textContent)).toEqual(["Me", "Member B"]);
    expect(forSelect).toHaveValue(MEMBER_A.userId);
  });

  it("Unread for me filters like Unread by me and shows its chip", () => {
    setup();
    render(<LibraryPage />);
    openFilters();
    press("Unread");
    expect(titles()).toEqual(["The Salt Road", "Paper Tide"]);
    expect(within(readGroup()).getByRole("button", { name: "Unread" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Remove filter: Unread by me" })).toBeInTheDocument();
  });

  it("For Member B then Read gives the Read by Member B chip; changing For re-patches", () => {
    setup();
    render(<LibraryPage />);
    openFilters();
    fireEvent.change(screen.getByLabelText("For"), { target: { value: MEMBER_B.userId } });
    expect(screen.queryByRole("button", { name: /^Remove filter/ })).toBeNull();
    press("Read");
    expect(screen.getByRole("button", { name: "Remove filter: Read by Member B" })).toBeInTheDocument();
    expect(titles()).toEqual(["Paper Tide"]);
    fireEvent.change(screen.getByLabelText("For"), { target: { value: MEMBER_A.userId } });
    expect(screen.getByRole("button", { name: "Remove filter: Read by me" })).toBeInTheDocument();
    expect(titles()).toEqual(["Glass Orchard"]);
    press("Any");
    expect(screen.queryByRole("button", { name: /^Remove filter/ })).toBeNull();
    expect(titles()).toEqual(["The Salt Road", "Glass Orchard", "Paper Tide"]);
  });

  it("hides For with a single member", () => {
    setup({ members: [MEMBER_A] });
    render(<LibraryPage />);
    openFilters();
    expect(readGroup()).toBeInTheDocument();
    expect(screen.queryByLabelText("For")).toBeNull();
  });

  it("is absent while reading is unavailable", () => {
    setup({ reading: false });
    render(<LibraryPage />);
    openFilters();
    expect(screen.queryByRole("group", { name: "Read status" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "Reading" })).toBeNull();
  });
});

describe("FiltersPanel hidden filters", () => {
  it("Review Focus 3: stored library tags with tagging unavailable show no chip, and Filters reads Filters", async () => {
    setup();
    render(<LibraryPage />);
    openFilters();
    fireEvent.click(screen.getByRole("button", { name: "Library tags" }));
    fireEvent.click(within(screen.getByRole("dialog", { name: "Library tags" })).getByLabelText("Vampires"));
    expect(screen.getByRole("button", { name: "Remove filter: Vampires" })).toBeInTheDocument();
    expect(filtersButton()).toHaveAccessibleName("Filters, 1 active");
    cleanup();
    setup({ tagging: { available: false } });
    render(<LibraryPage />);
    await waitFor(() => expect(titles()).toEqual(["The Salt Road", "Glass Orchard", "Paper Tide"]));
    expect(screen.queryByRole("button", { name: /^Remove filter/ })).toBeNull();
    expect(filtersButton()).toHaveAccessibleName("Filters");
  });
});
