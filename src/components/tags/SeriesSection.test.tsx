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
import { auditFlag, dismissal, existingSuggestion, mkJob, taggingState } from "./testkit";
import { AUDIT_PER_BOOK_ESTIMATE_MICRO, SERIES_PER_BOOK_ESTIMATE_MICRO } from "@/lib/tagging/cost";
import { formatUsd } from "@/lib/covers/cost";

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
  kind: "new",
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
    // Find series keeps the series estimate, not the full-tag one: 2 x 5,000 is about $0.01.
    expect(SERIES_PER_BOOK_ESTIMATE_MICRO).toBe(5000);
    expect(within(g).getByText("Check 2 books · about $0.01")).toBeInTheDocument();
    fireEvent.click(within(g).getByRole("button", { name: "Confirm" }));
    expect(await screen.findByText("Queued 2 books for a series check.")).toBeInTheDocument();
    expect(fn("findSeries")).toHaveBeenCalledWith(["b1", "b2"]);
  });

  it("says how many books it retries when a series check failed", () => {
    const failed = { ...mkJob("b2", "failed"), kind: "series" as const, reason: "series" as const };
    setup({ cards, jobs: [failed, mkJob("b3", "failed")] }, books);
    fireEvent.click(screen.getByRole("button", { name: "Find series" }));
    const g = screen.getByRole("group", { name: "Confirm series check" });
    expect(within(g).getByText("Check 2 books · about $0.01")).toBeInTheDocument();
    expect(within(g).getByText("Includes 1 book whose last series check failed.")).toBeInTheDocument();
  });

  it("shows no retry line when nothing failed", () => {
    setup({ cards }, books);
    fireEvent.click(screen.getByRole("button", { name: "Find series" }));
    expect(screen.queryByText(/last series check failed/)).toBeNull();
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

  it("ignores a queued follow-up with no run when counting progress", () => {
    const jobs: TagJob[] = [
      { ...mkJob("b1", "done"), kind: "series", runId: "r1" },
      { ...mkJob("b2", "queued"), kind: "series", runId: "r1" },
      { ...mkJob("b3", "queued"), kind: "series", reason: "unsure", runId: null },
    ];
    setup({ cards, jobs }, books);
    expect(screen.getByText(/Checked 1 of 2\./)).toBeInTheDocument();
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

describe("SeriesSection existing suggestions", () => {
  const existing = () => screen.getByRole("listitem", { name: "Add to your series Lantern Vale Cycle" });
  const withExisting = () => setup({ seriesSuggestions: [existingSuggestion()] });

  it("shows the name as text, the joins hint and the books, with no name input", () => {
    withExisting();
    const li = within(existing());
    expect(li.getAllByText("Add to your series Lantern Vale Cycle").length).toBeGreaterThan(0);
    expect(li.getByText('Joins your series "Lantern Vale Cycle".')).toBeInTheDocument();
    expect(li.queryByLabelText("Series name")).toBeNull();
    expect(li.getByRole("link", { name: "Title b1" })).toHaveAttribute("href", "#/book/b1");
    expect(li.getByLabelText("Number for Title b1")).toHaveValue("3");
    expect(li.getByText("Third in the cycle")).toBeInTheDocument();
  });

  it("approves with the suggestion name and the volumes, then says how many were added", async () => {
    withExisting();
    fn("approveSeries").mockResolvedValue(1);
    fireEvent.click(within(existing()).getByRole("button", { name: "Approve" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Added 1 book to Lantern Vale Cycle.");
    expect(fn("approveSeries")).toHaveBeenCalledWith("e1", "Lantern Vale Cycle", { b1: 3 });
    expect(screen.getByRole("heading", { name: "Series" })).toHaveFocus();
  });

  it("uses the plural for several books", async () => {
    withExisting();
    fn("approveSeries").mockResolvedValue(2);
    fireEvent.click(within(existing()).getByRole("button", { name: "Approve" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Added 2 books to Lantern Vale Cycle.");
  });

  it("dismisses with its own line and moves focus to the heading", async () => {
    withExisting();
    fn("dismissSeries").mockResolvedValue(undefined);
    fireEvent.click(within(existing()).getByRole("button", { name: "Dismiss" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Dismissed Lantern Vale Cycle for these books.");
    expect(fn("dismissSeries")).toHaveBeenCalledWith("e1");
    expect(screen.getByRole("heading", { name: "Series" })).toHaveFocus();
  });
});

describe("SeriesSection Audit series", () => {
  const books = [
    mk("b1", { seriesName: "Thornmere Cycle", seriesVolume: 2 }),
    mk("b2", { seriesName: "Thornmere Cycle", seriesVolume: 3 }),
    mk("b3", { seriesName: "Saltglass Archive" }),
    mk("b4", { seriesName: "Saltglass Archive", userEditedFields: ["seriesName"] }),
  ];
  const cards = new Map(books.map((b) => [b.id, card(b.id)]));
  const auditOn = (over: Partial<TaggingState> = {}) => setup({ auditAvailable: true, cards, ...over }, books);

  it("shows the estimate, the retry line and queues the eligible ids on Confirm", async () => {
    const failed = { ...mkJob("b2", "failed"), kind: "audit" as const, reason: "audit" as const };
    auditOn({ jobs: [failed] });
    fn("auditSeries").mockResolvedValue(3);
    expect(screen.getByText(/Audit series checks the series the tagger filled in or you approved\./)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Audit series" }));
    const g = screen.getByRole("group", { name: "Confirm series audit" });
    expect(within(g).getByText(`Audit 3 books · about ${formatUsd(3 * AUDIT_PER_BOOK_ESTIMATE_MICRO)}`)).toBeInTheDocument();
    expect(within(g).getByText("Includes 1 book whose last audit failed.")).toBeInTheDocument();
    expect(within(g).getByText(/of this month's tagging budget left\./)).toBeInTheDocument();
    fireEvent.click(within(g).getByRole("button", { name: "Confirm" }));
    expect(await screen.findByText("Queued 3 books for a series audit.")).toBeInTheDocument();
    expect(fn("auditSeries")).toHaveBeenCalledWith(["b1", "b2", "b3"]);
  });

  it("Cancel queues nothing", () => {
    auditOn();
    fireEvent.click(screen.getByRole("button", { name: "Audit series" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(fn("auditSeries")).not.toHaveBeenCalled();
  });

  it("says so when nothing is eligible", () => {
    auditOn({ seriesAudited: new Set(["b1", "b2", "b3"]) });
    expect(screen.getByText("Every series has been audited, apart from the ones you set by hand.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Audit series" })).toBeDisabled();
  });

  it("shows the progress of an open audit run", () => {
    const jobs: TagJob[] = [
      { ...mkJob("b1", "done"), kind: "audit", reason: "audit", runId: "r1" },
      { ...mkJob("b2", "queued"), kind: "audit", reason: "audit", runId: "r1" },
      { ...mkJob("b3", "queued"), kind: "audit", reason: "audit", runId: "r1" },
    ];
    auditOn({ jobs });
    expect(
      screen.getByText("Audited 1 of 3. It carries on whenever either of you has the app open."),
    ).toBeInTheDocument();
  });

  it("is hidden when the audit isn't available, with Find series and suggestions intact", () => {
    setup(
      { auditAvailable: false, seriesSuggestions: [suggestion], seriesAuditFlags: [auditFlag()], seriesDismissals: [dismissal()], cards },
      books,
    );
    expect(screen.queryByRole("button", { name: "Audit series" })).toBeNull();
    expect(screen.queryByText("Check these series")).toBeNull();
    expect(screen.queryByRole("button", { name: /Dismissed/ })).toBeNull();
    expect(screen.getByRole("button", { name: "Find series" })).toBeInTheDocument();
    expect(item()).toBeInTheDocument();
  });

  it("runs the section in D12 order", () => {
    const lib = [mk("b1", { title: "Wren Hollow", seriesName: "Thornmere Cycle", seriesVolume: 2 }), mk("b2"), mk("b3")];
    setup(
      {
        auditAvailable: true,
        cards,
        seriesSuggestions: [suggestion],
        seriesAuditFlags: [auditFlag()],
        seriesDismissals: [dismissal(), dismissal({ suggestionId: "d2", name: "Ember Loom" })],
      },
      lib,
    );
    const text = screen.getByRole("heading", { name: "Series" }).closest("section")!.textContent ?? "";
    const at = ["Find series", "Audit series", "Title b2", "Check these series", "Dismissed (2)"].map((t) => text.indexOf(t));
    expect(at.every((n) => n >= 0)).toBe(true);
    expect(at).toEqual([...at].sort((a, b) => a - b));
  });
});

describe("SeriesSection flag cards", () => {
  const wren = mk("b1", { title: "Wren Hollow", authors: ["Ines Dravenholt"], seriesName: "Thornmere Cycle", seriesVolume: 2 });
  const noNumber = mk("b2", { title: "Lantern Bell", seriesName: "Saltglass Archive" });
  const wrongNum = mk("b3", { title: "Ash Meridian", seriesName: "Saltglass Archive", seriesVolume: 5 });
  const lib = [wren, noNumber, wrongNum];
  const flags = [
    auditFlag({ id: "fm", bookId: "b2", kind: "wrong_number", currentName: "Saltglass Archive", currentVolume: null, proposedName: null, proposedVolume: 3, why: null }),
    auditFlag({ id: "fn", bookId: "b3", kind: "wrong_number", currentName: "Saltglass Archive", currentVolume: 5, proposedName: null, proposedVolume: 4, why: null }),
    auditFlag(),
  ];
  const card1 = () => screen.getByRole("listitem", { name: "Wren Hollow: Wrong series?" });
  const cards = () => setup({ auditAvailable: true, seriesAuditFlags: flags }, lib);

  it("lists the flags wrong series, wrong number, missing number", () => {
    // The context hands the section flags already sorted (sortAuditFlags); the section renders them in that order.
    setup({ auditAvailable: true, seriesAuditFlags: [flags[2], flags[1], flags[0]] }, lib);
    expect(screen.getByRole("heading", { name: "Check these series" })).toBeInTheDocument();
    const labels = screen.getAllByRole("listitem").map((l) => l.getAttribute("aria-label")).filter((l) => l?.includes("?"));
    expect(labels).toEqual(["Wren Hollow: Wrong series?", "Ash Meridian: Wrong number?", "Lantern Bell: Missing number?"]);
  });

  it("shows Now, Audit, the reason and the link", () => {
    cards();
    const li = within(card1());
    expect(li.getByRole("link", { name: "Wren Hollow" })).toHaveAttribute("href", "#/book/b1");
    expect(li.getByText("Ines Dravenholt")).toBeInTheDocument();
    expect(li.getByText("Thornmere Cycle #2")).toBeInTheDocument();
    expect(li.getByText("Saltglass Archive #1")).toBeInTheDocument();
    expect(li.getByText("The description places it first in the Saltglass Archive.")).toBeInTheDocument();
  });

  it("reads a standalone proposal and a missing number", () => {
    setup(
      { auditAvailable: true, seriesAuditFlags: [auditFlag({ proposedName: null, proposedVolume: null }), flags[0]] },
      lib,
    );
    expect(within(card1()).getByText("Standalone (no series)")).toBeInTheDocument();
    const li = within(screen.getByRole("listitem", { name: "Lantern Bell: Missing number?" }));
    expect(li.getByText("Saltglass Archive, no number")).toBeInTheDocument();
    expect(li.getByText("Saltglass Archive #3")).toBeInTheDocument();
  });

  it("skips a flag whose book isn't loaded", () => {
    setup({ auditAvailable: true, seriesAuditFlags: [auditFlag({ bookId: "gone" })] }, lib);
    expect(screen.queryByText("Check these series")).toBeNull();
  });

  it("Use audit's answer applies it, reports it and focuses the heading", async () => {
    cards();
    fn("applyAudit").mockResolvedValue("applied");
    fireEvent.click(within(card1()).getByRole("button", { name: "Use audit's answer" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Changed Wren Hollow to Saltglass Archive #1.");
    expect(fn("applyAudit")).toHaveBeenCalledWith("f1");
    expect(screen.getByRole("heading", { name: "Series" })).toHaveFocus();
  });

  it("Keep it keeps the book", async () => {
    cards();
    fn("keepAudit").mockResolvedValue("kept");
    fireEvent.click(within(card1()).getByRole("button", { name: "Keep it" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Kept Wren Hollow as it is.");
  });

  it("explains a stale and an already settled answer", async () => {
    cards();
    fn("applyAudit").mockResolvedValueOnce("stale").mockResolvedValueOnce("not_pending");
    fireEvent.click(within(card1()).getByRole("button", { name: "Use audit's answer" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Wren Hollow's series changed since the audit. Nothing was changed.");
    fireEvent.click(within(card1()).getByRole("button", { name: "Use audit's answer" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Wren Hollow was already settled."));
  });

  it("shows a failure in the card and lets the buttons work again", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    cards();
    fn("applyAudit").mockRejectedValue(new Error("x"));
    fireEvent.click(within(card1()).getByRole("button", { name: "Use audit's answer" }));
    expect(await within(card1()).findByRole("alert")).toHaveTextContent("Couldn't save that. Try again.");
    expect(within(card1()).getByRole("button", { name: "Use audit's answer" })).toBeEnabled();
    expect(within(card1()).getByRole("button", { name: "Keep it" })).toBeEnabled();
  });

  describe("Edit…", () => {
    const edit = () => fireEvent.click(within(card1()).getByRole("button", { name: "Edit…" }));

    it("prefills the audit's answer", () => {
      cards();
      edit();
      expect(within(card1()).getByLabelText("Series name")).toHaveValue("Saltglass Archive");
      expect(within(card1()).getByLabelText("Number")).toHaveValue("1");
      expect(within(card1()).queryByRole("button", { name: "Keep it" })).toBeNull();
    });

    it("hints at an existing spelling and saves under it", async () => {
      setup({ auditAvailable: true, seriesAuditFlags: flags }, [...lib, mk("b9", { seriesName: "Wrenfold Tales", seriesVolume: 1 })]);
      fn("editAudit").mockResolvedValue("edited");
      edit();
      fireEvent.change(within(card1()).getByLabelText("Series name"), { target: { value: "wrenfold tales" } });
      expect(within(card1()).getByText('Joins your series "Wrenfold Tales".')).toBeInTheDocument();
      fireEvent.change(within(card1()).getByLabelText("Number"), { target: { value: "2" } });
      fireEvent.click(within(card1()).getByRole("button", { name: "Save" }));
      expect(await screen.findByRole("status")).toHaveTextContent("Saved the series for Wren Hollow.");
      expect(fn("editAudit")).toHaveBeenCalledWith("f1", "Wrenfold Tales", 2);
      expect(screen.getByRole("heading", { name: "Series" })).toHaveFocus();
    });

    it("rejects a bad number", () => {
      cards();
      edit();
      fireEvent.change(within(card1()).getByLabelText("Number"), { target: { value: "x" } });
      expect(within(card1()).getByRole("alert")).toHaveTextContent("Use a number from 0 to 9999, or leave it blank.");
      expect(within(card1()).getByRole("button", { name: "Save" })).toBeDisabled();
    });

    it("saves a blank name as null", async () => {
      cards();
      fn("editAudit").mockResolvedValue("edited");
      edit();
      fireEvent.change(within(card1()).getByLabelText("Series name"), { target: { value: "  " } });
      fireEvent.click(within(card1()).getByRole("button", { name: "Save" }));
      await screen.findByRole("status");
      expect(fn("editAudit")).toHaveBeenCalledWith("f1", null, null);
    });

    it("Cancel restores the buttons and focuses Edit…", () => {
      cards();
      edit();
      fireEvent.click(within(card1()).getByRole("button", { name: "Cancel" }));
      expect(within(card1()).getByRole("button", { name: "Edit…" })).toHaveFocus();
      expect(within(card1()).getByRole("button", { name: "Keep it" })).toBeInTheDocument();
    });
  });
});

describe("SeriesSection Dismissed", () => {
  const lib = [mk("b1", { title: "Wren Hollow" }), mk("b2", { title: "Ash Meridian", seriesName: "Saltglass Archive" })];
  const bookItem = (over: Record<string, unknown> = {}) =>
    dismissal({ kind: "book", suggestionId: "d2", bookId: "b1", name: "Ember Loom", decidedAt: "2026-11-22T00:00:00Z", ...over } as never);
  const items = [dismissal({ suggestionId: "d1", name: "Wrenfold Tales", decidedAt: "2026-11-20T00:00:00Z" }), bookItem()];
  const withDismissed = (d = items) => setup({ auditAvailable: true, seriesDismissals: d }, lib);

  it("collapses by default, expands newest first", () => {
    withDismissed();
    const btn = screen.getByRole("button", { name: "Dismissed (2)" });
    expect(btn).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(btn);
    expect(btn).toHaveAttribute("aria-expanded", "true");
    expect(document.getElementById(btn.getAttribute("aria-controls")!)).not.toBeNull();
    const text = screen.getAllByRole("listitem").map((l) => l.textContent);
    expect(text[0]).toContain("Wren Hollow, from Ember Loom");
    expect(text[1]).toContain("Wrenfold Tales");
  });

  it("leaves out a book that has a series now, and the count follows", () => {
    withDismissed([...items, bookItem({ suggestionId: "d3", bookId: "b2" })]);
    expect(screen.getByRole("button", { name: "Dismissed (2)" })).toBeInTheDocument();
  });

  it("Undo puts a name back and focuses the heading", async () => {
    withDismissed([dismissal({ name: "Ember Loom" })]);
    fn("undoDismissal").mockResolvedValue("restored");
    fireEvent.click(screen.getByRole("button", { name: "Dismissed (1)" }));
    fireEvent.click(screen.getByRole("button", { name: "Undo dismissal of Ember Loom" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Put Ember Loom back in the suggestions.");
    expect(fn("undoDismissal")).toHaveBeenCalledWith(expect.objectContaining({ suggestionId: "d1" }));
    expect(screen.getByRole("heading", { name: "Series" })).toHaveFocus();
  });

  it("Undo puts a book back, or says it can't", async () => {
    withDismissed([bookItem()]);
    fn("undoDismissal").mockResolvedValueOnce("restored").mockResolvedValueOnce("not_eligible");
    fireEvent.click(screen.getByRole("button", { name: "Dismissed (1)" }));
    const undo = () => screen.getByRole("button", { name: "Undo dismissal of Wren Hollow from Ember Loom" });
    fireEvent.click(undo());
    expect(await screen.findByRole("status")).toHaveTextContent("Put Wren Hollow back in Ember Loom.");
    fireEvent.click(undo());
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Wren Hollow can't go back to Ember Loom."));
  });

  it("says a book is already back when the undo answers not_dismissed", async () => {
    withDismissed([bookItem()]);
    fn("undoDismissal").mockResolvedValue("not_dismissed");
    fireEvent.click(screen.getByRole("button", { name: "Dismissed (1)" }));
    fireEvent.click(screen.getByRole("button", { name: "Undo dismissal of Wren Hollow from Ember Loom" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Wren Hollow was already back in Ember Loom.");
  });

  it("disables Undo while its call runs, and re-enables it on rejection", async () => {
    withDismissed([bookItem()]);
    let reject!: (e: Error) => void;
    fn("undoDismissal").mockReturnValue(new Promise((_, r) => (reject = r)));
    vi.spyOn(console, "error").mockImplementation(() => {});
    fireEvent.click(screen.getByRole("button", { name: "Dismissed (1)" }));
    const undo = () => screen.getByRole("button", { name: "Undo dismissal of Wren Hollow from Ember Loom" });
    fireEvent.click(undo());
    expect(undo()).toBeDisabled();
    reject(new Error("boom"));
    await waitFor(() => expect(undo()).toBeEnabled());
    expect(screen.getByRole("alert")).toHaveTextContent("Couldn't undo that");
  });

  it("has no button without dismissals", () => {
    withDismissed([]);
    expect(screen.queryByRole("button", { name: /Dismissed/ })).toBeNull();
  });
});

describe("SeriesSection suggestion order", () => {
  it("lists a new suggestion's books by number, then unnumbered, then title", () => {
    const s: SeriesSuggestion = {
      id: "s9",
      name: "Saltglass Archive",
      kind: "new",
      books: [
        { bookId: "b1", volume: null, why: null },
        { bookId: "b2", volume: 3, why: null },
        { bookId: "b3", volume: 1, why: null },
      ],
    };
    setup({ seriesSuggestions: [s] }, [mk("b1"), mk("b2"), mk("b3")]);
    const links = within(screen.getByRole("listitem", { name: "Saltglass Archive" })).getAllByRole("link").map((a) => a.textContent);
    expect(links).toEqual(["Title b3", "Title b2", "Title b1"]);
  });
});
