import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AiBudget } from "@/lib/tagging/types";
import RetagConfirm from "./RetagConfirm";
import { aiBudget } from "./testkit";

const onRetag = vi.fn();

function renderIt(
  over: { bookIds?: string[]; budget?: AiBudget | null; disabled?: boolean; label?: string } = {},
) {
  return render(
    <RetagConfirm
      label={over.label ?? "Retag these"}
      bookIds={over.bookIds ?? ["a", "b", "c"]}
      budget={over.budget === undefined ? aiBudget(1_000_000) : over.budget}
      disabled={over.disabled}
      onRetag={onRetag}
    />,
  );
}

const button = () => screen.getByRole("button", { name: "Retag these" });
const group = () => screen.getByRole("group", { name: "Confirm retag" });

beforeEach(() => {
  vi.clearAllMocks();
  onRetag.mockResolvedValue(3);
});

describe("RetagConfirm", () => {
  it("uses the label for its button and spends nothing until Confirm", async () => {
    renderIt();
    fireEvent.click(button());
    expect(onRetag).not.toHaveBeenCalled();
    expect(within(group()).getByText("Retag 3 books · about $0.01")).toBeInTheDocument();
    expect(within(group()).getByText("$1.00 of this month's tagging budget left.")).toBeInTheDocument();
    expect(within(group()).queryByText(/budget covers/)).toBeNull();
    fireEvent.click(within(group()).getByRole("button", { name: "Confirm" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Queued 3 books for retagging.");
    expect(onRetag).toHaveBeenCalledTimes(1);
    expect(onRetag).toHaveBeenCalledWith(["a", "b", "c"]);
    expect(screen.queryByRole("group", { name: "Confirm retag" })).toBeNull();
  });

  it("uses the singular for one book", async () => {
    onRetag.mockResolvedValue(1);
    renderIt({ bookIds: ["a"] });
    fireEvent.click(button());
    expect(within(group()).getByText("Retag 1 book · under $0.01")).toBeInTheDocument();
    fireEvent.click(within(group()).getByRole("button", { name: "Confirm" }));
    expect(await screen.findByText("Queued 1 book for retagging.")).toBeInTheDocument();
  });

  it("says how many the budget covers when it falls short", () => {
    renderIt({ budget: aiBudget(5_000) });
    fireEvent.click(button());
    expect(
      within(group()).getByText("This month's budget covers about 2 of these 3 books. The rest carry on next month."),
    ).toBeInTheDocument();
  });

  it("says the budget covers none, and blocks Confirm, when it runs out while confirming", () => {
    const { rerender } = renderIt();
    fireEvent.click(button());
    rerender(<RetagConfirm label="Retag these" bookIds={["a", "b", "c"]} budget={aiBudget(50, 100)} onRetag={onRetag} />);
    expect(
      within(group()).getByText("This month's budget doesn't cover any of these books. They carry on next month."),
    ).toBeInTheDocument();
    expect(within(group()).getByRole("button", { name: "Confirm" })).toBeDisabled();
    expect(screen.getByText("This month's tagging budget is used up.")).toBeInTheDocument();
  });

  it("leaves the budget lines out while the budget is loading", () => {
    renderIt({ budget: null });
    fireEvent.click(button());
    expect(within(group()).queryByText(/budget left/)).toBeNull();
    expect(within(group()).queryByText(/budget covers|doesn't cover/)).toBeNull();
  });

  it("Cancel spends nothing and closes the confirm step", () => {
    renderIt();
    fireEvent.click(button());
    fireEvent.click(within(group()).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("group", { name: "Confirm retag" })).toBeNull();
    expect(onRetag).not.toHaveBeenCalled();
  });

  it("is disabled at the budget cap with the used-up line", () => {
    renderIt({ budget: aiBudget(0, 100) });
    expect(button()).toBeDisabled();
    expect(screen.getByText("This month's tagging budget is used up.")).toBeInTheDocument();
  });

  it("is disabled with no books, or when the caller says so", () => {
    const { unmount } = renderIt({ bookIds: [] });
    expect(button()).toBeDisabled();
    unmount();
    renderIt({ disabled: true });
    expect(button()).toBeDisabled();
  });

  it("shows a failure without the details", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    let reject!: (e: Error) => void;
    onRetag.mockReturnValue(new Promise((_, r) => (reject = r)));
    renderIt();
    fireEvent.click(button());
    fireEvent.click(within(group()).getByRole("button", { name: "Confirm" }));
    expect(within(group()).getByRole("button", { name: "Queueing…" })).toBeDisabled();
    expect(within(group()).getByRole("button", { name: "Cancel" })).toBeDisabled();
    reject(new TypeError("secret detail"));
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't queue the retag. Try again.");
    expect(spy).toHaveBeenCalledWith("Failed to retag books", "TypeError");
    spy.mockRestore();
    await waitFor(() => expect(button()).toBeEnabled());
  });
});
