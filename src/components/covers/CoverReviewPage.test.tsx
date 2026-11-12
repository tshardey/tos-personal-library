import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { mkSearch } from "@/lib/covers/fixtures.test-util";
import { budgetOf, finderState, fns, mkBook } from "./testkit";

const h = vi.hoisted(() => ({ state: {} as Record<string, unknown>, catalog: {} as Record<string, unknown> }));
vi.mock("@/contexts/CoverFinderContext", () => ({ useCoverFinder: () => h.state }));
vi.mock("@/hooks/useCatalog", () => ({ useCatalog: () => h.catalog }));
import CoverReviewPage from "./CoverReviewPage";

const U = (n: number) => `https://covers.openlibrary.org/b/id/${1000000 + n}-L.jpg`;
const res = (n: number) => ({ url: U(n), source: "openlibrary" as const, width: 400, height: 600 });
const runReview = vi.fn();
const reloadCatalog = vi.fn();

function setup(
  over: { books?: ReturnType<typeof mkBook>[]; searches?: ReturnType<typeof mkSearch>[]; budget?: unknown } = {},
) {
  const books = over.books ?? [
    mkBook("a", "Glass Orchard", { coverUrl: "https://example.com/cur-a.jpg" }),
    mkBook("b", "Paper Tide", { coverUrl: null }),
    mkBook("c", "Quiet Harbour"),
  ];
  const searches = over.searches ?? [
    mkSearch("s1", "a", "ready", {
      results: [res(1), res(2)],
      coverAtRequest: "https://example.com/cur-a.jpg",
      reasons: ["low_quality", "placeholder"],
      note: "too blurry",
    }),
    mkSearch("s2", "b", "ready", { results: [res(3)], createdAt: "2026-11-02T00:00:00Z" }),
  ];
  h.state = finderState({ searches, runReview, ...(over.budget !== undefined ? { budget: over.budget } : {}) });
  h.catalog = { books, reload: reloadCatalog };
  return render(<CoverReviewPage />);
}

const row = (title: string) => screen.getByRole("listitem", { name: title });

beforeEach(() => {
  vi.clearAllMocks();
  runReview.mockResolvedValue({ applied: 0, changed: 0, gone: 0 });
  reloadCatalog.mockResolvedValue(undefined);
  fns.retry.mockResolvedValue("queued");
});

describe("CoverReviewPage", () => {
  it("shows the heading, the month line, reasons and note", () => {
    setup({ budget: { ...budgetOf(5_000_000), spentMicro: 1_230_000 } });
    expect(screen.getByRole("heading", { name: "Covers to review" })).toBeInTheDocument();
    expect(screen.getByText(/This month: .* of .* used\./)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Glass Orchard" })).toHaveAttribute("href", "#/book/a");
    expect(screen.getByText(/Low quality · Placeholder/)).toBeInTheDocument();
    expect(screen.getByText(/“too blurry”/)).toBeInTheDocument();
  });

  it("omits the month line without a budget", () => {
    setup();
    expect(screen.queryByText(/This month:/)).not.toBeInTheDocument();
  });

  it("preselects the first result and counts picks", () => {
    setup();
    expect(within(row("Glass Orchard")).getByRole("button", { name: "Option 1" })).toHaveAttribute("aria-pressed", "true");
    expect(within(row("Paper Tide")).getByRole("button", { name: "Option 1" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("2 picked")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Apply 2" })).toBeEnabled();
    expect(within(row("Paper Tide")).getByText("none")).toBeInTheDocument();
  });

  it("changes picks, and Current means keep", () => {
    setup();
    fireEvent.click(within(row("Glass Orchard")).getByRole("button", { name: "Option 2" }));
    expect(within(row("Glass Orchard")).getByRole("button", { name: "Option 2" })).toHaveAttribute("aria-pressed", "true");
    expect(within(row("Glass Orchard")).getByRole("button", { name: "Option 1" })).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(within(row("Paper Tide")).getByRole("button", { name: "Current" }));
    expect(screen.getByText("1 picked")).toBeInTheDocument();
  });

  it("applies once, reloads the catalogue and summarises", async () => {
    runReview.mockResolvedValue({ applied: 1, changed: 0, gone: 0 });
    setup();
    fireEvent.click(within(row("Glass Orchard")).getByRole("button", { name: "Option 2" }));
    fireEvent.click(within(row("Paper Tide")).getByRole("button", { name: "Current" }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Apply 1" }));
    });
    expect(runReview).toHaveBeenCalledTimes(1);
    expect(runReview).toHaveBeenCalledWith([
      { kind: "apply", searchId: "s1", url: U(2), expectedCover: "https://example.com/cur-a.jpg" },
      { kind: "keep", searchId: "s2" },
    ]);
    expect(reloadCatalog).toHaveBeenCalled();
    expect(screen.getByText("Applied 1.")).toBeInTheDocument();
  });

  it("a catalogue reload failure after the apply doesn't claim the apply failed", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    runReview.mockResolvedValue({ applied: 2, changed: 0, gone: 0 });
    reloadCatalog.mockRejectedValue(new Error("network"));
    setup();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Apply 2" }));
    });
    expect(screen.getByText("Applied 2.")).toBeInTheDocument();
    expect(screen.queryByText("Couldn't apply those. Try again.")).not.toBeInTheDocument();
    warn.mockRestore();
  });

  it("an apply that throws says so and doesn't reload", async () => {
    runReview.mockRejectedValue(new Error("network"));
    setup();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Apply 2" }));
    });
    expect(screen.getByText("Couldn't apply those. Try again.")).toBeInTheDocument();
    expect(reloadCatalog).not.toHaveBeenCalled();
  });

  it("preselects Current when the cover changed after the search, and sends keep", async () => {
    setup({
      books: [mkBook("a", "Glass Orchard", { coverUrl: "https://example.com/hand.jpg" })],
      searches: [mkSearch("s1", "a", "ready", { results: [res(1)], coverAtRequest: null })],
    });
    expect(screen.getByText("This cover was changed after the search.")).toBeInTheDocument();
    expect(within(row("Glass Orchard")).getByRole("button", { name: "Current" })).toHaveAttribute("aria-pressed", "true");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Done" }));
    });
    expect(runReview).toHaveBeenCalledWith([{ kind: "keep", searchId: "s1" }]);
  });

  it("shows both sentences when someone else got there first", async () => {
    runReview.mockResolvedValue({ applied: 0, changed: 1, gone: 1 });
    setup();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Apply 2" }));
    });
    expect(screen.getByText("1 covers were changed by someone else; check them again.")).toBeInTheDocument();
    expect(screen.getByText("1 were already reviewed by someone else.")).toBeInTheDocument();
  });

  it("drops a tile that fails to load and moves the pick on", () => {
    setup();
    const r = row("Glass Orchard");
    fireEvent.error(within(r).getByRole("button", { name: "Option 1" }).querySelector("img")!);
    expect(within(r).queryByRole("button", { name: "Option 1" })).not.toBeInTheDocument();
    expect(within(r).getByRole("button", { name: "Option 2" })).toHaveAttribute("aria-pressed", "true");
  });

  it("when every tile fails, offers Search again, and Done leaves that row alone", async () => {
    setup({
      books: [mkBook("a", "Glass Orchard"), mkBook("b", "Paper Tide", { coverUrl: null })],
      searches: [
        mkSearch("s1", "a", "ready", { results: [res(1), res(2)] }),
        mkSearch("s2", "b", "ready", { results: [res(3)], createdAt: "2026-11-02T00:00:00Z" }),
      ],
    });
    const r = row("Glass Orchard");
    for (const img of Array.from(r.querySelectorAll("img"))) fireEvent.error(img);
    expect(screen.getByText("These covers no longer load.")).toBeInTheDocument();
    expect(screen.getByText("1 picked")).toBeInTheDocument();
    expect(within(r).getByRole("button", { name: "Current" })).toHaveAttribute("aria-pressed", "false");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Search again" }));
    });
    expect(fns.retry).toHaveBeenCalledWith("a");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Apply 1" }));
    });
    // No keep for s1: its search and mark survive.
    expect(runReview).toHaveBeenCalledWith([{ kind: "apply", searchId: "s2", url: U(3), expectedCover: null }]);
  });

  it("a dead row is still kept when the person presses Current", async () => {
    setup({ books: [mkBook("a", "Glass Orchard")], searches: [mkSearch("s1", "a", "ready", { results: [res(1)] })] });
    const r = row("Glass Orchard");
    fireEvent.error(r.querySelector("img")!);
    expect(screen.getByText("0 picked")).toBeInTheDocument();
    fireEvent.click(within(r).getByRole("button", { name: "Current" }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Done" }));
    });
    expect(runReview).toHaveBeenCalledWith([{ kind: "keep", searchId: "s1" }]);
  });

  it("says so when Search again fails, and clears it on the next try", async () => {
    fns.retry.mockRejectedValueOnce(new Error("network"));
    setup({ books: [mkBook("a", "Glass Orchard")], searches: [mkSearch("s1", "a", "ready", { results: [res(1)] })] });
    const r = row("Glass Orchard");
    fireEvent.error(r.querySelector("img")!);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Search again" }));
    });
    expect(within(r).getByRole("alert")).toHaveTextContent("Couldn't search again. Try again.");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Search again" }));
    });
    expect(fns.retry).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("lists an unseen nothing-found row and Done marks it seen", async () => {
    setup({
      books: [mkBook("c", "Quiet Harbour")],
      searches: [mkSearch("s3", "c", "nothing_found")],
    });
    expect(screen.getByText("Nothing good found.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Current" })).not.toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Done" }));
    });
    expect(runReview).toHaveBeenCalledWith([{ kind: "seen", searchId: "s3" }]);
  });

  it("says a failed search failed", () => {
    setup({ books: [mkBook("c", "Quiet Harbour")], searches: [mkSearch("s3", "c", "failed")] });
    expect(screen.getByText("The search failed.")).toBeInTheDocument();
  });

  it("ignores a double tap", async () => {
    let finish!: (v: { applied: number; changed: number; gone: number }) => void;
    runReview.mockReturnValue(new Promise((r) => (finish = r)));
    setup();
    const btn = screen.getByRole("button", { name: "Apply 2" });
    fireEvent.click(btn);
    fireEvent.click(btn);
    expect(runReview).toHaveBeenCalledTimes(1);
    await act(async () => finish({ applied: 2, changed: 0, gone: 0 }));
  });

  it("renders no row for a deleted book", () => {
    setup({ books: [mkBook("b", "Paper Tide")] });
    expect(screen.queryByText("Glass Orchard")).not.toBeInTheDocument();
    expect(screen.getByText("Paper Tide")).toBeInTheDocument();
  });

  it("writes nothing on render", () => {
    setup();
    expect(runReview).not.toHaveBeenCalled();
    expect(fns.retry).not.toHaveBeenCalled();
  });

  it("shows the empty state with a way back", () => {
    setup({ searches: [] });
    expect(screen.getByText("No covers to review.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to library" })).toHaveAttribute("href", "#/");
  });
});
