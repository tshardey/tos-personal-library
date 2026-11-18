import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { mkSearch } from "@/lib/covers/fixtures.test-util";
import type { CoverMark } from "@/lib/covers/types";
import { budgetOf, finderState, fns, mkBook } from "./testkit";

const h = vi.hoisted(() => ({ state: {} as Record<string, unknown>, catalog: {} as Record<string, unknown> }));
vi.mock("@/contexts/CoverFinderContext", () => ({ useCoverFinder: () => h.state }));
vi.mock("@/hooks/useCatalog", () => ({ useCatalog: () => h.catalog }));
import CoverReviewPage from "./CoverReviewPage";

const mark = (bookId: string): [string, CoverMark] => [bookId, { bookId, reasons: [], note: null } as unknown as CoverMark];

/** Five shelf books without a cover (one unhauled), two marked books with covers. */
const books = [
  mkBook("n1", "Ash Lantern"),
  mkBook("n2", "Brine Atlas"),
  mkBook("n3", "Cinder Map"),
  mkBook("n4", "Dune Ledger"),
  mkBook("off", "Ember Quay", { onShelf: false }),
  mkBook("m1", "Fern Gate", { coverUrl: "https://example.com/m1.jpg" }),
  mkBook("m2", "Gull Spire", { coverUrl: "https://example.com/m2.jpg" }),
];

function setup(over: Record<string, unknown> = {}) {
  h.state = finderState({ searches: [], marks: new Map([mark("m1"), mark("m2"), mark("off")]), ...over });
  h.catalog = { books, reload: vi.fn() };
  return render(<CoverReviewPage />);
}

const line = (name: string) => screen.getByRole("group", { name });
const noCover = () => line("Books without a cover");
const marked = () => line("Marked for a new cover");

beforeEach(() => {
  vi.clearAllMocks();
  fns.requestBatch.mockResolvedValue({ queued: 2, alreadyOpen: 0, nothingFound: 0 });
});

describe("CoverReviewPage: find covers", () => {
  it("counts the No cover and Marked sets, leaving unhauled books out", () => {
    setup();
    expect(within(noCover()).getByText("Books without a cover: 4")).toBeInTheDocument();
    expect(within(noCover()).getByText("4 books · under $0.01")).toBeInTheDocument();
    expect(within(marked()).getByText("Marked for a new cover: 2")).toBeInTheDocument();
    expect(within(marked()).getByText("2 books · under $0.01")).toBeInTheDocument();
  });

  it("Find covers on the Marked line requests the marked books and says it's searching", async () => {
    setup();
    fireEvent.click(within(marked()).getByRole("button", { name: "Find covers" }));
    expect(fns.requestBatch).toHaveBeenCalledWith(["m1", "m2"]);
    expect(
      await within(marked()).findByText("Searching 2 books. It carries on whenever either of you has the app open."),
    ).toBeInTheDocument();
    expect(within(noCover()).queryByText(/^Searching/)).toBeNull();
  });

  it("Find covers on the No cover line requests the books without a cover", () => {
    setup();
    fireEvent.click(within(noCover()).getByRole("button", { name: "Find covers" }));
    expect(fns.requestBatch).toHaveBeenCalledWith(["n1", "n2", "n3", "n4"]);
  });

  it("leaves out open and nothing-found books, and says so", () => {
    setup({
      latest: new Map([
        ["n1", mkSearch("s1", "n1", "queued")],
        ["n2", mkSearch("s2", "n2", "nothing_found")],
      ]),
    });
    expect(within(noCover()).getByText("Books without a cover: 4")).toBeInTheDocument();
    expect(within(noCover()).getByText("2 books · under $0.01")).toBeInTheDocument();
    expect(within(noCover()).getByText("1 already being searched.")).toBeInTheDocument();
    expect(within(noCover()).getByText("1 tried before with nothing found is left out.")).toBeInTheDocument();
  });

  it("a line with no books shows 0 and a disabled button", () => {
    setup({ marks: new Map() });
    expect(within(marked()).getByText("Marked for a new cover: 0")).toBeInTheDocument();
    expect(within(marked()).getByText("Nothing to search here.")).toBeInTheDocument();
    expect(within(marked()).getByRole("button", { name: "Find covers" })).toBeDisabled();
    expect(within(noCover()).getByRole("button", { name: "Find covers" })).toBeEnabled();
  });

  it("disables both when the budget is used up", () => {
    setup({ budget: budgetOf(0, 1) });
    for (const g of [noCover(), marked()]) {
      expect(within(g).getByRole("button", { name: "Find covers" })).toBeDisabled();
      expect(within(g).getByText("This month's cover-finding budget is used up.")).toBeInTheDocument();
    }
  });

  it("says how many the budget covers when it falls short", () => {
    setup({ budget: budgetOf(1000) });
    expect(within(noCover()).getByText("This month's budget covers about 2 of these 4 books.")).toBeInTheDocument();
    expect(within(marked()).queryByText(/budget covers about/)).toBeNull();
  });

  it("shows the failure alert on its own line", async () => {
    fns.requestBatch.mockRejectedValueOnce(new Error("network"));
    setup();
    fireEvent.click(within(marked()).getByRole("button", { name: "Find covers" }));
    expect(await within(marked()).findByRole("alert")).toHaveTextContent("Couldn't start the search. Try again.");
  });

  it("with nothing to review, still offers both lines above the empty state", () => {
    setup();
    expect(screen.getByText("No covers to review.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to library" })).toBeInTheDocument();
    const find = screen.getByRole("heading", { name: "Find covers" });
    const review = screen.getByRole("heading", { name: "Covers to review" });
    expect(find.compareDocumentPosition(review) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("shows no lines when the finder isn't available", () => {
    setup({ available: false });
    expect(screen.queryByRole("group", { name: "Books without a cover" })).toBeNull();
    expect(screen.getByText("The cover finder isn't available yet.")).toBeInTheDocument();
  });
});
