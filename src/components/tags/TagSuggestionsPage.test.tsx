import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { bookFixture, copyFixture } from "@/lib/flag-fixtures.test-util";
import type { BookWithCopies } from "@/lib/types";
import type { AiBudget, BookCardMeta, TagJob, TagSuggestion } from "@/lib/tagging/types";

const h = vi.hoisted(() => ({ state: {} as unknown, catalog: {} as unknown }));
vi.mock("@/contexts/TaggingContext", () => ({ useTagging: () => h.state }));
vi.mock("@/hooks/useCatalog", () => ({ useCatalog: () => h.catalog }));
import TagSuggestionsPage from "./TagSuggestionsPage";
import { mkJob, mkTag, taggingState } from "./testkit";
import type { TaggingState } from "@/contexts/TaggingContext";

const shelf = (n: number, prefix = "b"): BookWithCopies[] =>
  Array.from({ length: n }, (_, i) =>
    bookFixture(`${prefix}${i + 1}`, [copyFixture({ id: `${prefix}${i + 1}c`, bookId: `${prefix}${i + 1}` })]),
  );

const budget = (spentMicro: number, budgetMicro: number, reserveMicro = 80_000): AiBudget => ({
  month: "2026-11",
  spentMicro,
  budgetMicro,
  reserveMicro,
  globalSpentMicro: 0,
  globalBudgetMicro: 1_000_000_000,
});

const card = (bookId: string, vocabVersion: number): BookCardMeta => ({ bookId, vocabVersion, writtenAt: "" });

let state: TaggingState;
function setup(over: Partial<TaggingState> = {}, books: BookWithCopies[] = shelf(3)) {
  state = taggingState({
    vocabulary: [mkTag("vampires", "Vampires", "creature")],
    budgets: { tagging: budget(1_000_000, 5_000_000), ask: budget(250_000, 2_000_000, 1) },
    ...over,
  });
  h.state = state;
  h.catalog = { books, loading: false, error: null, reload: vi.fn(), refresh: vi.fn() };
  return render(<TagSuggestionsPage />);
}

const fn = (k: keyof TaggingState) => state[k] as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => vi.clearAllMocks());

describe("TagSuggestionsPage", () => {
  it("says tagging isn't available only once the first load is done", () => {
    const { rerender } = setup({ available: false, loading: true });
    expect(screen.queryByText("Tagging isn't available yet.")).toBeNull();
    h.state = taggingState({ available: false, loading: false });
    rerender(<TagSuggestionsPage />);
    expect(screen.getByText("Tagging isn't available yet.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Tag all books" })).toBeNull();
  });

  it("shows the month's spending once both budgets are loaded", () => {
    setup();
    expect(
      screen.getByText("This month: $1.00 of $5.00 used for tagging, $0.25 of $2.00 for Ask."),
    ).toBeInTheDocument();
  });

  it("leaves the budget line out while a budget is loading", () => {
    setup({ budgets: { tagging: budget(0, 5_000_000), ask: null } });
    expect(screen.queryByText(/^This month:/)).toBeNull();
  });

  it("Tag all books counts the eligible books and queues exactly those", async () => {
    const books = shelf(5);
    const jobs: TagJob[] = [mkJob("b2", "queued"), mkJob("b3", "failed")];
    setup(
      { cards: new Map([["b4", card("b4", 1)]]), jobs, tagAll: vi.fn().mockResolvedValue(2) },
      books,
    );
    // b2 open, b3 failed, b4 has a card: b1 and b5 remain.
    expect(screen.getByText("2 books · under $0.01")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Tag all books" }));
    await waitFor(() => expect(fn("tagAll")).toHaveBeenCalledWith(["b1", "b5"]));
  });

  it("Try 10 first queues the first 10 eligible in catalogue order", async () => {
    setup({ tagAll: vi.fn().mockResolvedValue(10) }, shelf(14));
    expect(screen.getByText("14 books · about $0.06")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Try 10 first" }));
    await waitFor(() => expect(fn("tagAll")).toHaveBeenCalledTimes(1));
    expect(fn("tagAll").mock.calls[0][0]).toEqual(shelf(10).map((b) => b.id));
  });

  it("a double tap sends once", async () => {
    let resolve!: (n: number) => void;
    setup({ tagAll: vi.fn(() => new Promise<number>((r) => (resolve = r))) });
    const button = screen.getByRole("button", { name: "Tag all books" });
    fireEvent.click(button);
    fireEvent.click(button);
    fireEvent.click(screen.getByRole("button", { name: "Try 10 first" }));
    expect(fn("tagAll")).toHaveBeenCalledTimes(1);
    await act(async () => resolve(3));
  });

  it("near the limit says how many the budget covers", () => {
    // 100,000 µ$ left less the 80,000 reserve, covers about 5 of these 30 books at 4,300 each.
    setup({ budgets: { tagging: budget(4_900_000, 5_000_000), ask: budget(0, 2_000_000) } }, shelf(30));
    expect(screen.getByText("This month's budget covers about 5 of these 30 books.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Tag all books" })).toBeEnabled();
  });

  it("disables every run once the budget is used up", () => {
    setup({ budgets: { tagging: budget(4_950_000, 5_000_000), ask: budget(0, 2_000_000) } });
    // Tag all books, Check for new tags and Retag all books each say so.
    expect(screen.getAllByText("This month's tagging budget is used up.")).toHaveLength(3);
    expect(screen.getByRole("button", { name: "Tag all books" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Try 10 first" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Retag all books (covers too)" })).toBeDisabled();
  });

  it("says every book is tagged when none are eligible", () => {
    const books = shelf(2);
    setup({ cards: new Map(books.map((b) => [b.id, card(b.id, 1)])) }, books);
    expect(screen.getByText("Every book on the shelf is tagged.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Tag all books" })).toBeDisabled();
  });

  it("shows a run's progress while it is open", () => {
    const jobs = ["b1", "b2", "b3"].map((id, i) => ({
      ...mkJob(id, i === 0 ? "done" : "queued"),
      runId: "run-1",
    }));
    setup({ jobs, runId: "run-1" });
    expect(
      screen.getByText("Tagged 1 of 3. It carries on whenever either of you has the app open."),
    ).toBeInTheDocument();
    expect(screen.queryByText("Every book on the shelf is tagged.")).toBeNull();
  });

  it("Check for new tags counts books with older cards and queues them", async () => {
    const books = shelf(3);
    setup(
      {
        vocabulary: [{ ...mkTag("vampires", "Vampires", "creature"), addedVersion: 2 }],
        vocabVersion: 2,
        cards: new Map([
          ["b1", card("b1", 1)],
          ["b2", card("b2", 2)],
          ["b3", card("b3", 1)],
        ]),
        checkNewTags: vi.fn().mockResolvedValue(2),
      },
      books,
    );
    const section = screen.getByRole("region", { name: "Check for new tags" });
    expect(within(section).getByText("2 books · under $0.01")).toBeInTheDocument();
    fireEvent.click(within(section).getByRole("button", { name: "Check for new tags" }));
    await waitFor(() => expect(fn("checkNewTags")).toHaveBeenCalledWith(["b1", "b3"]));
  });

  it("says when every book has been checked against the current tags", () => {
    setup({ cards: new Map([["b1", card("b1", 1)]]) });
    expect(screen.getByText("Every book has been checked against the current tags.")).toBeInTheDocument();
  });

  describe("Retag all books (covers too)", () => {
    const retagAll = () => screen.getByRole("button", { name: "Retag all books (covers too)" });
    const confirmGroup = () => screen.getByRole("group", { name: "Confirm retag" });

    it("comes after Check for new tags and spends nothing until Confirm", async () => {
      const books = shelf(5);
      // b2 open, b3 failed, b4 tagged (still eligible), b5 unhauled: b1 and b4 remain.
      books[4] = { ...books[4], onShelf: false };
      const jobs: TagJob[] = [mkJob("b2", "processing"), mkJob("b3", "failed"), mkJob("b4", "done")];
      setup({ cards: new Map([["b4", card("b4", 1)]]), jobs, retagMany: vi.fn().mockResolvedValue(2) }, books);
      const check = screen.getByRole("region", { name: "Check for new tags" });
      const section = screen.getByRole("region", { name: "Retag all books" });
      expect(check.compareDocumentPosition(section) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      fireEvent.click(within(section).getByRole("button", { name: "Retag all books (covers too)" }));
      expect(fn("retagMany")).not.toHaveBeenCalled();
      expect(within(confirmGroup()).getByText("Retag 2 books · under $0.01")).toBeInTheDocument();
      // 4,000,000 µ$ left of the 5,000,000 budget.
      expect(within(confirmGroup()).getByText("$4.00 of this month's tagging budget left.")).toBeInTheDocument();
      expect(within(confirmGroup()).queryByText(/budget covers about/)).toBeNull();
      fireEvent.click(within(confirmGroup()).getByRole("button", { name: "Confirm" }));
      expect(await within(section).findByRole("status")).toHaveTextContent("Queued 2 books for retagging.");
      expect(fn("retagMany")).toHaveBeenCalledTimes(1);
      expect(fn("retagMany")).toHaveBeenCalledWith(["b1", "b4"]);
      for (const k of ["tagAll", "checkNewTags"] as const) expect(fn(k)).not.toHaveBeenCalled();
    });

    it("shows the about-estimate and the coverage line when the budget falls short", () => {
      // 100,000 µ$ left less the 80,000 reserve covers about 5 of 30 at 4,300 each; 30 × 4,300 ≈ $0.13.
      setup({ budgets: { tagging: budget(4_900_000, 5_000_000), ask: budget(0, 2_000_000) } }, shelf(30));
      fireEvent.click(retagAll());
      expect(within(confirmGroup()).getByText("Retag 30 books · about $0.13")).toBeInTheDocument();
      expect(within(confirmGroup()).getByText("$0.10 of this month's tagging budget left.")).toBeInTheDocument();
      expect(
        within(confirmGroup()).getByText(
          "This month's budget covers about 5 of these 30 books. The rest carry on next month.",
        ),
      ).toBeInTheDocument();
    });

    it("Cancel spends nothing", () => {
      setup();
      fireEvent.click(retagAll());
      fireEvent.click(within(confirmGroup()).getByRole("button", { name: "Cancel" }));
      expect(screen.queryByRole("group", { name: "Confirm retag" })).toBeNull();
      expect(fn("retagMany")).not.toHaveBeenCalled();
      expect(retagAll()).toBeEnabled();
    });

    it("says when queueing failed", async () => {
      const spy = vi.spyOn(console, "error").mockImplementation(() => {});
      setup({ retagMany: vi.fn().mockRejectedValue(new TypeError("secret detail")) });
      fireEvent.click(retagAll());
      fireEvent.click(within(confirmGroup()).getByRole("button", { name: "Confirm" }));
      expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't queue the retag. Try again.");
      spy.mockRestore();
    });

    it("is disabled at the budget cap", () => {
      setup({ budgets: { tagging: budget(4_950_000, 5_000_000), ask: budget(0, 2_000_000) } });
      expect(retagAll()).toBeDisabled();
      const section = screen.getByRole("region", { name: "Retag all books" });
      expect(within(section).getByText("This month's tagging budget is used up.")).toBeInTheDocument();
    });

    it("is disabled when no book is eligible", () => {
      setup({ jobs: [mkJob("b1", "queued"), mkJob("b2", "failed")] }, shelf(2));
      expect(retagAll()).toBeDisabled();
    });

    it("is hidden when tagging isn't available", () => {
      setup({ available: false });
      expect(screen.queryByRole("button", { name: "Retag all books (covers too)" })).toBeNull();
    });

    it("explains why Check for new tags can't add cover tags", () => {
      setup();
      expect(
        screen.getByText(
          "Check for new tags is cheap but only rereads each book's summary, so it can't add cover tags. To pick up new cover tags, use Retag all books.",
        ),
      ).toBeInTheDocument();
    });
  });

  const suggestion: TagSuggestion = {
    id: "s1",
    tagId: "lighthouses",
    label: "Lighthouses",
    category: "setting",
    books: [
      { bookId: "b1", why: "Set in a lighthouse." },
      { bookId: "b2", why: "A keeper's story." },
    ],
  };

  it("lists suggestions with their category and linked books", () => {
    setup({ suggestions: [suggestion] });
    const item = screen.getByRole("listitem", { name: "Lighthouses" });
    expect(within(item).getByText("Setting")).toBeInTheDocument();
    expect(within(item).getByRole("link", { name: "b1" })).toHaveAttribute("href", "#/book/b1");
    expect(within(item).getByText(/Set in a lighthouse\./)).toBeInTheDocument();
    expect(within(item).getByRole("link", { name: "b2" })).toHaveAttribute("href", "#/book/b2");
  });

  it("says when there are no suggestions", () => {
    setup();
    expect(screen.getByText("No suggestions right now.")).toBeInTheDocument();
  });

  it("Approve opens the label and category for a last edit, then approves once", async () => {
    setup({ suggestions: [suggestion], approve: vi.fn().mockResolvedValue(2) });
    const item = screen.getByRole("listitem", { name: "Lighthouses" });
    fireEvent.click(within(item).getByRole("button", { name: "Approve" }));
    const label = within(item).getByLabelText("Label");
    expect(label).toHaveValue("Lighthouses");
    expect(within(item).getByLabelText("Category")).toHaveValue("setting");
    fireEvent.change(label, { target: { value: "Lighthouse keepers" } });
    fireEvent.change(within(item).getByLabelText("Category"), { target: { value: "protagonist" } });
    const confirm = within(item).getByRole("button", { name: "Confirm" });
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    await waitFor(() => expect(fn("approve")).toHaveBeenCalledTimes(1));
    expect(fn("approve")).toHaveBeenCalledWith("s1", "Lighthouse keepers", "protagonist");
  });

  it("Dismiss dismisses once", async () => {
    setup({ suggestions: [suggestion], dismiss: vi.fn(() => new Promise<void>(() => {})) });
    const button = within(screen.getByRole("listitem", { name: "Lighthouses" })).getByRole("button", { name: "Dismiss" });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(fn("dismiss")).toHaveBeenCalledTimes(1);
    expect(fn("dismiss")).toHaveBeenCalledWith("s1");
  });

  it("adds a tag with its label and category", async () => {
    setup({ createTag: vi.fn().mockResolvedValue("added") });
    const form = screen.getByRole("region", { name: "Add a tag" });
    fireEvent.change(within(form).getByLabelText("Label"), { target: { value: "Sea monsters" } });
    fireEvent.change(within(form).getByLabelText("Category"), { target: { value: "creature" } });
    const add = within(form).getByRole("button", { name: "Add tag" });
    fireEvent.click(add);
    fireEvent.click(add);
    await waitFor(() => expect(within(form).getByText("Added Sea monsters.")).toBeInTheDocument());
    expect(fn("createTag")).toHaveBeenCalledTimes(1);
    expect(fn("createTag")).toHaveBeenCalledWith("Sea monsters", "creature");
    expect(within(form).getByLabelText("Label")).toHaveValue("");
  });

  it("a label that collides with a vocabulary or ToS id says it exists and calls nothing else", async () => {
    setup({ createTag: vi.fn().mockResolvedValue("exists") });
    const form = screen.getByRole("region", { name: "Add a tag" });
    fireEvent.change(within(form).getByLabelText("Label"), { target: { value: "Vampires" } });
    fireEvent.click(within(form).getByRole("button", { name: "Add tag" }));
    expect(await within(form).findByText("That tag already exists.")).toBeInTheDocument();
    for (const k of ["approve", "dismiss", "tagAll", "checkNewTags", "reload"] as const) {
      expect(fn(k)).not.toHaveBeenCalled();
    }
    expect(within(form).getByLabelText("Label")).toHaveValue("Vampires");
  });

  it("a label with no usable characters says to use letters or numbers", async () => {
    setup({ createTag: vi.fn().mockResolvedValue("invalid") });
    const form = screen.getByRole("region", { name: "Add a tag" });
    fireEvent.change(within(form).getByLabelText("Label"), { target: { value: "!!!" } });
    // The button is disabled for these labels; Enter in the field still submits the form.
    fireEvent.submit(within(form).getByLabelText("Label").closest("form")!);
    expect(await within(form).findByText("Use letters or numbers in the tag name.")).toBeInTheDocument();
  });

  it("can't add a label with no usable characters", () => {
    setup();
    const form = screen.getByRole("region", { name: "Add a tag" });
    fireEvent.change(within(form).getByLabelText("Label"), { target: { value: " -- " } });
    expect(within(form).getByRole("button", { name: "Add tag" })).toBeDisabled();
  });
});
