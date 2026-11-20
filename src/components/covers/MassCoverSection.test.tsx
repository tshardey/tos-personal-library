import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { mkSearch } from "@/lib/covers/fixtures.test-util";
import { budgetOf, finderState, mkBook } from "./testkit";

const h = vi.hoisted(() => ({ state: {} as Record<string, unknown> }));
vi.mock("@/contexts/CoverFinderContext", () => ({ useCoverFinder: () => h.state }));
import MassCoverSection from "./MassCoverSection";

const markMany = vi.fn();
const findMany = vi.fn();

/** a, b eligible; off unhauled; open queued; nf nothing found. */
const selected = [
  mkBook("a", "Ash Lantern"),
  mkBook("b", "Brine Atlas", { coverUrl: "https://example.com/b.jpg" }),
  mkBook("off", "Cinder Map", { onShelf: false }),
  mkBook("open", "Dune Ledger"),
  mkBook("nf", "Ember Quay"),
];
const latest = new Map([
  ["open", mkSearch("s1", "open", "queued")],
  ["nf", mkSearch("s2", "nf", "nothing_found")],
]);

function setup(over: Record<string, unknown> = {}, books = selected) {
  h.state = finderState({ latest, markMany, findMany, ...over });
  return render(<MassCoverSection selected={books} />);
}

const section = () => screen.getByRole("region", { name: "Covers" });
const button = (name: string) => within(section()).getByRole("button", { name });
const note = () => within(section()).getByLabelText("What's wrong? (optional)");
const confirmGroup = () => within(section()).getByRole("group", { name: "Confirm find covers" });

beforeEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
  markMany.mockResolvedValue({ marked: 2, failed: 0 });
  findMany.mockResolvedValue({ queued: 2, alreadyOpen: 0, nothingFound: 0 });
});

describe("MassCoverSection", () => {
  it("is hidden when the cover finder isn't available", () => {
    setup({ available: false });
    expect(screen.queryByRole("region", { name: "Covers" })).toBeNull();
  });

  it("offers the reasons, all off, and an empty note", () => {
    setup();
    for (const name of ["Wrong language", "Placeholder", "Wrong book", "Low quality", "Angled or shows edges"]) {
      expect(button(name)).toHaveAttribute("aria-pressed", "false");
    }
    expect(note()).toHaveValue("");
  });

  it("counts the skipped books by rule", () => {
    setup();
    expect(within(section()).getByText("1 not on the shelf is left out.")).toBeInTheDocument();
    expect(within(section()).getByText("1 already being searched.")).toBeInTheDocument();
    expect(
      within(section()).getByText("1 tried before with nothing found is left out of Add to batch."),
    ).toBeInTheDocument();
  });

  describe("Add to batch", () => {
    it("marks the eligible books with the chosen reasons and note, then points to the Covers tab", async () => {
      setup();
      fireEvent.click(button("Placeholder"));
      fireEvent.click(button("Wrong book"));
      fireEvent.change(note(), { target: { value: "  the hardback " } });
      fireEvent.click(button("Add to batch"));
      expect(markMany).toHaveBeenCalledWith(["a", "b"], ["placeholder", "wrong_book"], "the hardback");
      expect(await within(section()).findByText(/^Marked 2 books\./)).toHaveTextContent(
        "Marked 2 books. Find covers from the Covers tab.",
      );
      expect(within(section()).getByRole("link", { name: "Covers tab" })).toHaveAttribute("href", "#/covers");
    });

    it("sends a blank note as null and no reasons as an empty list", () => {
      setup();
      fireEvent.click(button("Add to batch"));
      expect(markMany).toHaveBeenCalledWith(["a", "b"], [], null);
    });

    it("says how many couldn't be marked", async () => {
      markMany.mockResolvedValue({ marked: 1, failed: 1 });
      setup();
      fireEvent.click(button("Add to batch"));
      expect(await within(section()).findByRole("alert")).toHaveTextContent("Couldn't mark 1 book. Try again.");
    });

    it("says none were marked when the call itself fails", async () => {
      markMany.mockRejectedValue(new Error("network"));
      vi.spyOn(console, "error").mockImplementation(() => {});
      setup();
      fireEvent.click(button("Add to batch"));
      expect(await within(section()).findByRole("alert")).toHaveTextContent("Couldn't mark 2 books. Try again.");
    });

    it("with nothing ticked or typed, leaves existing marks alone and marks only the rest", async () => {
      markMany.mockResolvedValue({ marked: 1, failed: 0 });
      setup({ marks: new Map([["a", { bookId: "a", reasons: ["wrong_language"], note: "the Spanish edition" }]]) });
      fireEvent.click(button("Add to batch"));
      expect(markMany).toHaveBeenCalledWith(["b"], [], null);
      expect(await within(section()).findByText(/^Marked 1 book\./)).toBeInTheDocument();
      expect(within(section()).getByText("1 already marked kept its reasons and note.")).toBeInTheDocument();
    });

    it("with reasons, updates existing marks too", () => {
      setup({ marks: new Map([["a", { bookId: "a", reasons: ["wrong_language"], note: null }]]) });
      fireEvent.click(button("Placeholder"));
      fireEvent.click(button("Add to batch"));
      expect(markMany).toHaveBeenCalledWith(["a", "b"], ["placeholder"], null);
    });

    it("with nothing ticked and every book already marked, is off", () => {
      setup({
        marks: new Map([
          ["a", { bookId: "a", reasons: [], note: null }],
          ["b", { bookId: "b", reasons: [], note: null }],
        ]),
      });
      expect(button("Add to batch")).toBeDisabled();
      fireEvent.click(button("Low quality"));
      expect(button("Add to batch")).toBeEnabled();
    });

    it("is off when no selected book can be marked", () => {
      setup({}, [selected[2], selected[3]]);
      expect(button("Add to batch")).toBeDisabled();
    });

    it("stays on when the budget is used up (marking is free)", () => {
      setup({ budget: budgetOf(0, 1) });
      expect(button("Add to batch")).toBeEnabled();
    });
  });

  describe("Find covers now", () => {
    it("confirms with the count and estimate before searching", async () => {
      setup();
      fireEvent.click(button("Find covers now"));
      expect(findMany).not.toHaveBeenCalled();
      expect(within(confirmGroup()).getByText("Find covers for 2 books · under $0.01")).toBeInTheDocument();
      fireEvent.click(within(confirmGroup()).getByRole("button", { name: "Confirm" }));
      expect(findMany).toHaveBeenCalledWith(["a", "b"], [], [], null);
      const status = await within(section()).findByText(/^Searching 2 books\./);
      expect(status).toHaveTextContent(
        "Searching 2 books. It carries on whenever either of you has the app open. You can close this. Covers show up in the Covers tab when they're ready.",
      );
      expect(within(status).getByRole("link", { name: "Covers tab" })).toHaveAttribute("href", "#/covers");
      expect(within(section()).queryByRole("group", { name: "Confirm find covers" })).toBeNull();
    });

    it("carries the reasons and note", () => {
      setup();
      fireEvent.click(button("Low quality"));
      fireEvent.change(note(), { target: { value: "blurry" } });
      fireEvent.click(button("Find covers now"));
      fireEvent.click(within(confirmGroup()).getByRole("button", { name: "Confirm" }));
      expect(findMany).toHaveBeenCalledWith(["a", "b"], [], ["low_quality"], "blurry");
    });

    it("can try again for the nothing-found books, explicitly", () => {
      setup();
      fireEvent.click(button("Find covers now"));
      const retry = within(confirmGroup()).getByRole("checkbox", {
        name: "Also try again for 1 tried before with nothing found",
      });
      expect(retry).not.toBeChecked();
      fireEvent.click(retry);
      expect(within(confirmGroup()).getByText("Find covers for 3 books · under $0.01")).toBeInTheDocument();
      fireEvent.click(within(confirmGroup()).getByRole("button", { name: "Confirm" }));
      expect(findMany).toHaveBeenCalledWith(["a", "b"], ["nf"], [], null);
    });

    it("is on with only nothing-found books, and Confirm waits for the retry box", () => {
      setup({}, [selected[4]]);
      fireEvent.click(button("Find covers now"));
      expect(within(confirmGroup()).getByRole("button", { name: "Confirm" })).toBeDisabled();
      fireEvent.click(within(confirmGroup()).getByRole("checkbox"));
      expect(within(confirmGroup()).getByRole("button", { name: "Confirm" })).toBeEnabled();
    });

    it("says how many the budget covers when it falls short", () => {
      setup({ budget: budgetOf(500) });
      fireEvent.click(button("Find covers now"));
      expect(within(confirmGroup()).getByText("This month's budget covers about 1 of these 2 books.")).toBeInTheDocument();
    });

    it("is off when the budget is used up, and says so", () => {
      setup({ budget: budgetOf(0, 1) });
      expect(button("Find covers now")).toBeDisabled();
      expect(within(section()).getByText("This month's cover-finding budget is used up.")).toBeInTheDocument();
    });

    it("is off with nothing to search", () => {
      setup({}, [selected[2], selected[3]]);
      expect(button("Find covers now")).toBeDisabled();
    });

    it("Cancel closes the confirm without searching", () => {
      setup();
      fireEvent.click(button("Find covers now"));
      fireEvent.click(within(confirmGroup()).getByRole("button", { name: "Cancel" }));
      expect(within(section()).queryByRole("group", { name: "Confirm find covers" })).toBeNull();
      expect(findMany).not.toHaveBeenCalled();
    });

    it("says so when the search can't start", async () => {
      findMany.mockRejectedValue(new Error("network"));
      vi.spyOn(console, "error").mockImplementation(() => {});
      setup();
      fireEvent.click(button("Find covers now"));
      fireEvent.click(within(confirmGroup()).getByRole("button", { name: "Confirm" }));
      expect(await within(section()).findByRole("alert")).toHaveTextContent("Couldn't start the search. Try again.");
      expect(within(section()).queryByText(/^Searching/)).toBeNull();
      expect(within(section()).queryByRole("link", { name: "Covers tab" })).toBeNull();
    });

    it("ignores a double tap on Confirm", () => {
      findMany.mockReturnValue(new Promise(() => {}));
      setup();
      fireEvent.click(button("Find covers now"));
      const confirm = within(confirmGroup()).getByRole("button", { name: "Confirm" });
      fireEvent.click(confirm);
      fireEvent.click(confirm);
      expect(findMany).toHaveBeenCalledTimes(1);
    });
  });
});
