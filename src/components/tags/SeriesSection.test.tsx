import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { bookFixture, copyFixture } from "@/lib/flag-fixtures.test-util";
import type { TaggingState } from "@/contexts/TaggingContext";
import type { AiBudget, BookCardMeta, SeriesSuggestion, TagJob } from "@/lib/tagging/types";
import type { BookWithCopies } from "@/lib/types";

const h = vi.hoisted(() => ({ state: {} as unknown, catalog: {} as unknown }));
vi.mock("@/contexts/TaggingContext", () => ({ useTagging: () => h.state }));
vi.mock("@/hooks/useCatalog", () => ({ useCatalog: () => h.catalog }));
import SeriesSection from "./SeriesSection";
import { mkJob, taggingState } from "./testkit";

const budget = (spentMicro: number, budgetMicro: number, reserveMicro = 80_000): AiBudget => ({
  month: "2026-11",
  spentMicro,
  budgetMicro,
  reserveMicro,
  globalSpentMicro: 0,
  globalBudgetMicro: 1_000_000_000,
});
const card = (bookId: string): BookCardMeta => ({ bookId, vocabVersion: 1, writtenAt: "" });
const mk = (id: string, over: Partial<BookWithCopies> = {}) =>
  bookFixture(id, [copyFixture({ id: id + "c", bookId: id })], { title: `Title ${id}`, ...over });

const suggestion: SeriesSuggestion = {
  id: "s1",
  name: "Saltglass Archive",
  books: [
    { bookId: "b1", volume: 1, why: "Volume one of the arc" },
    { bookId: "b2", volume: 2, why: null },
    { bookId: "b3", volume: 3, why: "hand set" },
  ],
};

let state: TaggingState;
const refresh = vi.fn();
function setup(
  over: Partial<TaggingState> = {},
  books: BookWithCopies[] = [mk("b1"), mk("b2"), mk("b3", { userEditedFields: ["seriesName"] })],
) {
  state = taggingState({
    seriesAvailable: true,
    budgets: { tagging: budget(0, 5_000_000), ask: null },
    ...over,
  });
  h.state = state;
  h.catalog = { books, loading: false, error: null, reload: vi.fn(), refresh };
  return render(<SeriesSection />);
}
const fn = (k: keyof TaggingState) => state[k] as unknown as ReturnType<typeof vi.fn>;
const item = () => screen.getByRole("listitem", { name: "Saltglass Archive" });
const withItem = () => setup({ seriesSuggestions: [suggestion] });

beforeEach(() => {
  vi.clearAllMocks();
  refresh.mockResolvedValue(true);
});

describe("SeriesSection Find series", () => {
  const books = [mk("b1"), mk("b2"), mk("b3")];
  const cards = new Map(books.map((b) => [b.id, card(b.id)]));

  it("shows the intro and queues exactly the eligible ids on Confirm", async () => {
    setup({ cards, seriesChecked: new Set(["b3"]) }, books);
    expect(screen.getByText(/New series names wait here for you\./)).toBeInTheDocument();
    fn("findSeries").mockResolvedValue(2);
    fireEvent.click(screen.getByRole("button", { name: "Find series" }));
    const g = screen.getByRole("group", { name: "Confirm series check" });
    expect(within(g).getByText(/^Check 2 books · under /)).toBeInTheDocument();
    fireEvent.click(within(g).getByRole("button", { name: "Confirm" }));
    expect(await screen.findByText("Queued 2 books for a series check.")).toBeInTheDocument();
    expect(fn("findSeries")).toHaveBeenCalledWith(["b1", "b2"]);
  });

  it("Cancel calls nothing", () => {
    setup({ cards }, books);
    fireEvent.click(screen.getByRole("button", { name: "Find series" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(fn("findSeries")).not.toHaveBeenCalled();
  });

  it("says so when every tagged book has been checked", () => {
    setup({ cards, seriesChecked: new Set(["b1", "b2", "b3"]) }, books);
    expect(screen.getByText("Every tagged book has been checked for a series.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Find series" })).toBeDisabled();
  });

  it("is disabled with the used-up copy at the budget cap", () => {
    setup({ cards, budgets: { tagging: budget(5_000_000, 5_000_000), ask: null } }, books);
    expect(screen.getByRole("button", { name: "Find series" })).toBeDisabled();
    expect(screen.getByText("This month's tagging budget is used up.")).toBeInTheDocument();
  });

  it("shows the progress of an open run", () => {
    const jobs: TagJob[] = [
      { ...mkJob("b1", "done"), kind: "series", runId: "r1" },
      { ...mkJob("b2", "queued"), kind: "series", runId: "r1" },
      { ...mkJob("b3", "queued"), kind: "series", runId: "r1" },
    ];
    setup({ cards, jobs }, books);
    expect(
      screen.getByText(/Checked 1 of 3\. It carries on whenever either of you has the app open\./),
    ).toBeInTheDocument();
  });

  it("shows a failure to queue", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    setup({ cards }, books);
    fn("findSeries").mockRejectedValue(new Error("x"));
    fireEvent.click(screen.getByRole("button", { name: "Find series" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't queue the series check. Try again.");
  });
});

describe("SeriesSection items", () => {
  it("shows the empty line", () => {
    setup();
    expect(screen.getByText("No series suggestions right now.")).toBeInTheDocument();
  });

  it("shows the prefilled name and the fill targets, not hand-set books", () => {
    withItem();
    const li = within(item());
    expect(li.getByLabelText("Series name")).toHaveValue("Saltglass Archive");
    expect(li.getByRole("link", { name: "Title b1" })).toHaveAttribute("href", "#/book/b1");
    expect(li.getByLabelText("Number for Title b1")).toHaveValue("1");
    expect(li.getByLabelText("Number for Title b2")).toHaveValue("2");
    expect(li.getByText("Volume one of the arc")).toBeInTheDocument();
    expect(li.queryByText("Title b3")).toBeNull();
  });

  it("says when the typed name joins an existing series spelled differently", () => {
    setup({ seriesSuggestions: [suggestion] }, [mk("b1"), mk("b2"), mk("b9", { seriesName: "Thornmere Cycle" })]);
    fireEvent.change(within(item()).getByLabelText("Series name"), { target: { value: "THORNMERE CYCLE" } });
    expect(within(item()).getByText('Joins your series "Thornmere Cycle".')).toBeInTheDocument();
  });

  it("flags an invalid number and disables Approve", () => {
    withItem();
    fireEvent.change(within(item()).getByLabelText("Number for Title b1"), { target: { value: "x" } });
    expect(within(item()).getByRole("alert")).toHaveTextContent("Use a number from 0 to 9999, or leave it blank.");
    expect(within(item()).getByRole("button", { name: "Approve" })).toBeDisabled();
  });

  it("approves the trimmed name and the edited numbers, then moves focus to the heading", async () => {
    withItem();
    fn("approveSeries").mockResolvedValue(2);
    const li = within(item());
    fireEvent.change(li.getByLabelText("Series name"), { target: { value: "  Saltglass Archive  " } });
    fireEvent.change(li.getByLabelText("Number for Title b1"), { target: { value: "4" } });
    fireEvent.change(li.getByLabelText("Number for Title b2"), { target: { value: "" } });
    fireEvent.click(li.getByRole("button", { name: "Approve" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Added 2 books to Saltglass Archive.");
    expect(fn("approveSeries")).toHaveBeenCalledWith("s1", "Saltglass Archive", { b1: 4, b2: null });
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(screen.getByRole("heading", { name: "Series" })).toHaveFocus();
  });

  it("sends a double tap once", async () => {
    withItem();
    let release: (n: number) => void = () => {};
    fn("approveSeries").mockReturnValue(new Promise<number>((r) => (release = r)));
    const approve = within(item()).getByRole("button", { name: "Approve" });
    fireEvent.click(approve);
    fireEvent.click(approve);
    expect(fn("approveSeries")).toHaveBeenCalledTimes(1);
    release(2);
    await screen.findByRole("status");
  });

  it("dismisses and reports it", async () => {
    withItem();
    fn("dismissSeries").mockResolvedValue(undefined);
    fireEvent.click(within(item()).getByRole("button", { name: "Dismiss" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Dismissed Saltglass Archive.");
    expect(fn("dismissSeries")).toHaveBeenCalledWith("s1");
    expect(screen.getByRole("heading", { name: "Series" })).toHaveFocus();
  });

  it("shows an error when approve or dismiss fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    withItem();
    fn("approveSeries").mockRejectedValue(new Error("x"));
    fn("dismissSeries").mockRejectedValue(new Error("x"));
    fireEvent.click(within(item()).getByRole("button", { name: "Approve" }));
    expect(await screen.findByText("Couldn't approve the series.")).toBeInTheDocument();
    fireEvent.click(within(item()).getByRole("button", { name: "Dismiss" }));
    expect(await screen.findByText("Couldn't dismiss the series.")).toBeInTheDocument();
  });

  it("says when the books have a series now", () => {
    setup({ seriesSuggestions: [suggestion] }, [
      mk("b1", { seriesName: "Wrenfold Tales" }),
      mk("b2", { seriesName: "Wrenfold Tales" }),
    ]);
    expect(within(item()).getByText("These books have a series now.")).toBeInTheDocument();
    expect(within(item()).getByRole("button", { name: "Approve" })).toBeEnabled();
  });

  it("still approves when no book is left to fill, so the name maps from now on", async () => {
    setup({ seriesSuggestions: [suggestion] }, [
      mk("b1", { seriesName: "Wrenfold Tales" }),
      mk("b2", { seriesName: "Wrenfold Tales" }),
    ]);
    fn("approveSeries").mockResolvedValue(0);
    fireEvent.click(within(item()).getByRole("button", { name: "Approve" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Approved Saltglass Archive. No books were left to fill.");
    expect(fn("approveSeries")).toHaveBeenCalledWith("s1", "Saltglass Archive", {});
  });

  it("disables Approve for a blank name", () => {
    withItem();
    fireEvent.change(within(item()).getByLabelText("Series name"), { target: { value: "   " } });
    expect(within(item()).getByRole("button", { name: "Approve" })).toBeDisabled();
  });
});
