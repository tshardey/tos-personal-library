import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BookWithCopies, Copy } from "@/lib/types";
import { finderState, fns, mkBook, mkSearch } from "@/components/covers/testkit";

const h = vi.hoisted(() => ({ catalog: {} as Record<string, unknown>, finder: {} as Record<string, unknown> }));
vi.mock("@/contexts/HouseholdContext", () => ({
  useHousehold: () => ({
    members: [
      { userId: "ua", displayName: "Member A" },
      { userId: "ub", displayName: "Member B" },
    ],
  }),
}));
vi.mock("@/contexts/CoverFinderContext", () => ({ useCoverFinder: () => h.finder }));
vi.mock("@/hooks/useCatalog", () => ({ useCatalog: () => h.catalog }));
vi.mock("@/hooks/useCopyPhotoUrls", () => ({ useCopyPhotoUrls: () => new Map() }));
vi.mock("@/lib/tos-tags", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tos-tags")>()),
  loadTosTags: vi.fn().mockResolvedValue({ tags: [], stale: false }),
}));
import LibraryPage from "./LibraryPage";

const copy = (owner: string | null) => ({ ownerUserId: owner, unhauledAt: null }) as Copy;
const withCover = (id: string, title: string) => mkBook(id, title, { coverUrl: "https://example.test/c.jpg" });

function setCatalog(books: BookWithCopies[]) {
  h.catalog = { books, tags: new Map(), loading: false, error: null, tagsError: null, reload: vi.fn() };
}

async function renderPage() {
  render(<LibraryPage />);
  await act(async () => {});
}

const pick = (value: string) => fireEvent.change(screen.getByLabelText("Covers"), { target: { value } });

beforeEach(() => {
  vi.clearAllMocks();
  window.location.hash = "";
  fns.requestBatch.mockResolvedValue({ queued: 1, alreadyOpen: 0, nothingFound: 0 });
  fns.retry.mockResolvedValue("queued");
  h.finder = finderState();
});

describe("LibraryPage cover filters", () => {
  it("No cover lists coverless books, including one with only a copy photo", async () => {
    setCatalog([
      mkBook("a", "Glass Orchard", { copies: [{ ownerUserId: null, photoPath: "p.jpg" } as unknown as Copy] }),
      mkBook("b", "Paper Tide"),
      mkBook("c", "Salt Road"),
      withCover("d", "Has Cover"),
    ]);
    await renderPage();
    expect(screen.getAllByText("Has Cover").length).toBeGreaterThan(0);
    pick("no_cover");
    expect(screen.queryAllByText("Has Cover")).toHaveLength(0);
    expect(screen.getAllByText("Glass Orchard").length).toBeGreaterThan(0);
    expect(screen.getByText("3 books · under $0.01")).toBeInTheDocument();
  });

  it("combines with the owner filter", async () => {
    setCatalog([
      mkBook("a", "Glass Orchard", { copies: [copy("ua")] }),
      mkBook("b", "Paper Tide", { copies: [copy("ub")] }),
      mkBook("c", "Salt Road", { copies: [copy("ub")] }),
    ]);
    await renderPage();
    pick("no_cover");
    fireEvent.click(screen.getByRole("button", { name: "Member B" }));
    expect(screen.getByText("2 books · under $0.01")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Find covers" }));
    expect(fns.requestBatch).toHaveBeenCalledWith(["b", "c"]);
    await screen.findByText(/^Searching/);
  });

  it("Marked lists only marked books and counts them", async () => {
    setCatalog([withCover("a", "Glass Orchard"), withCover("b", "Paper Tide"), withCover("c", "Salt Road")]);
    h.finder = finderState({ marks: new Map([["b", { bookId: "b" }]]) });
    await renderPage();
    pick("marked");
    expect(screen.queryAllByText("Glass Orchard")).toHaveLength(0);
    expect(screen.getAllByText("Paper Tide").length).toBeGreaterThan(0);
    expect(screen.getByText("1 book · under $0.01")).toBeInTheDocument();
  });

  it("Nothing found shows the list with Try again", async () => {
    setCatalog([withCover("a", "Glass Orchard"), withCover("b", "Paper Tide"), withCover("c", "Salt Road")]);
    h.finder = finderState({
      latest: new Map([
        ["a", mkSearch("a", "nothing_found")],
        ["b", mkSearch("b", "failed")],
      ]),
    });
    await renderPage();
    pick("nothing_found");
    expect(screen.queryAllByText("Salt Road")).toHaveLength(0);
    expect(screen.getByText("Search failed")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Find covers" })).toBeNull();
    const row = screen.getByText("Paper Tide").closest("li") as HTMLElement;
    fireEvent.click(within(row).getByRole("button", { name: "Try again" }));
    expect(fns.retry).toHaveBeenCalledWith("b");
  });

  it("has no Covers select when covers are unavailable", async () => {
    setCatalog([mkBook("a", "Glass Orchard")]);
    h.finder = finderState({ available: false });
    await renderPage();
    expect(screen.queryByLabelText("Covers")).toBeNull();
    expect(screen.queryByRole("button", { name: "Find covers" })).toBeNull();
  });
});
