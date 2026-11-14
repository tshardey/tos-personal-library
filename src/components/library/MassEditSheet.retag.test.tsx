import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { bookFixture, copyFixture } from "@/lib/flag-fixtures.test-util";
import type { BookWithCopies } from "@/lib/types";
import { aiBudget, taggingState } from "@/components/tags/testkit";

const h = vi.hoisted(() => ({ state: {} as unknown }));
vi.mock("@/lib/library-repo", () => ({ updateCopyFields: vi.fn(), updateBook: vi.fn() }));
vi.mock("@/lib/tagging/tagging-repo", () => ({ addLibraryTag: vi.fn(), removeLibraryTag: vi.fn() }));
vi.mock("@/contexts/TaggingContext", () => ({ useTagging: () => h.state }));
import MassEditSheet from "./MassEditSheet";

function catalog(titles = ["Atlas", "Codex", "Ember"]): BookWithCopies[] {
  return titles.map((t) => bookFixture(t, [copyFixture({ id: t + "1", bookId: t })]));
}

type Over = Parameters<typeof taggingState>[0];
const retagMany = vi.fn();

function setState(over: Over = {}) {
  // 4300 µ$ a book: 3 books ≈ $0.01 (12900 µ$).
  h.state = taggingState({ budgets: { tagging: aiBudget(1_000_000), ask: null }, retagMany, ...over });
}

function renderSheet(books = catalog()) {
  render(
    <MassEditSheet
      selected={books}
      catalog={books}
      labels={[]}
      members={[]}
      refresh={vi.fn().mockResolvedValue(true)}
      onClose={vi.fn()}
      onDone={vi.fn()}
    />,
  );
}

const retagButton = () => screen.getByRole("button", { name: "Retag selected" });
const confirmGroup = () => screen.getByRole("group", { name: "Confirm retag" });

beforeEach(() => {
  vi.clearAllMocks();
  retagMany.mockResolvedValue(3);
  setState();
});

describe("MassEditSheet Retag selected", () => {
  it("is hidden when tagging isn't available", () => {
    setState({ available: false });
    renderSheet();
    expect(screen.queryByRole("button", { name: "Retag selected" })).toBeNull();
  });

  it("spends nothing until Confirm, then queues the selected books", async () => {
    renderSheet();
    fireEvent.click(retagButton());
    expect(retagMany).not.toHaveBeenCalled();
    fireEvent.click(within(confirmGroup()).getByRole("button", { name: "Confirm" }));
    await waitFor(() => expect(screen.getByText("Queued 3 books for retagging.")).toBeInTheDocument());
    expect(retagMany).toHaveBeenCalledTimes(1);
    expect(retagMany).toHaveBeenCalledWith(["Atlas", "Codex", "Ember"]);
  });

  it("shows the estimate and what is left", () => {
    renderSheet();
    fireEvent.click(retagButton());
    expect(within(confirmGroup()).getByText("Retag 3 books · about $0.01")).toBeInTheDocument();
    expect(within(confirmGroup()).getByText("$1.00 of this month's tagging budget left.")).toBeInTheDocument();
    expect(within(confirmGroup()).queryByText(/budget covers about/)).toBeNull();
  });

  it("uses the singular for one book", () => {
    renderSheet(catalog(["Atlas"]));
    fireEvent.click(retagButton());
    expect(within(confirmGroup()).getByText("Retag 1 book · about under $0.01")).toBeInTheDocument();
  });

  it("says how many books the budget covers when it falls short", () => {
    // 10000 µ$ left covers 2 books at 4300 µ$.
    setState({ budgets: { tagging: aiBudget(10_000), ask: null } });
    renderSheet();
    fireEvent.click(retagButton());
    expect(
      within(confirmGroup()).getByText("This month's budget covers about 2 of these 3 books. The rest carry on next month."),
    ).toBeInTheDocument();
  });

  it("Cancel spends nothing and closes the confirm step", () => {
    renderSheet();
    fireEvent.click(retagButton());
    fireEvent.click(within(confirmGroup()).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("group", { name: "Confirm retag" })).toBeNull();
    expect(retagMany).not.toHaveBeenCalled();
  });

  it("is disabled at the budget cap, with the same copy as the per-book button", () => {
    setState({ budgets: { tagging: aiBudget(0, 100), ask: null } });
    renderSheet();
    expect(retagButton()).toBeDisabled();
    expect(screen.getByText("This month's tagging budget is used up.")).toBeInTheDocument();
  });

  it("is disabled with nothing selected", () => {
    renderSheet([]);
    expect(retagButton()).toBeDisabled();
  });

  it("is disabled-in-flight and shows a failure without the details", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    let reject!: (e: Error) => void;
    retagMany.mockReturnValue(new Promise((_, r) => (reject = r)));
    renderSheet();
    fireEvent.click(retagButton());
    fireEvent.click(within(confirmGroup()).getByRole("button", { name: "Confirm" }));
    expect(within(confirmGroup()).getByRole("button", { name: "Queueing…" })).toBeDisabled();
    expect(within(confirmGroup()).getByRole("button", { name: "Cancel" })).toBeDisabled();
    reject(new TypeError("secret detail"));
    expect(await screen.findByText("Couldn't queue the retag. Try again.")).toBeInTheDocument();
    expect(spy).toHaveBeenCalledWith("Failed to retag books", "TypeError");
    spy.mockRestore();
  });

  it("counts only newly queued books", async () => {
    retagMany.mockResolvedValue(1);
    renderSheet();
    fireEvent.click(retagButton());
    fireEvent.click(within(confirmGroup()).getByRole("button", { name: "Confirm" }));
    expect(await screen.findByText("Queued 1 book for retagging.")).toBeInTheDocument();
  });
});
