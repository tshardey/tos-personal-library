import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { budgetOf, finderState, fns, mkBook, mkSearch } from "./testkit";

const h = vi.hoisted(() => ({ state: {} as Record<string, unknown> }));
vi.mock("@/contexts/CoverFinderContext", () => ({ useCoverFinder: () => h.state }));
import CoverBatchFooter from "./CoverBatchFooter";

const many = (n: number) => Array.from({ length: n }, (_, i) => mkBook("b" + i, "Title " + i));

beforeEach(() => {
  vi.clearAllMocks();
  fns.requestBatch.mockResolvedValue({ queued: 3, alreadyOpen: 0, nothingFound: 0 });
  h.state = finderState();
});

describe("CoverBatchFooter", () => {
  it("shows the count and estimate", () => {
    render(<CoverBatchFooter books={many(3)} />);
    expect(screen.getByText("3 books · under $0.01")).toBeInTheDocument();
  });

  it("says 1 book, singular", () => {
    render(<CoverBatchFooter books={many(1)} />);
    expect(screen.getByText("1 book · under $0.01")).toBeInTheDocument();
  });

  it("shows a dollar estimate for 60", () => {
    render(<CoverBatchFooter books={many(60)} />);
    expect(screen.getByText("60 books · about $0.03")).toBeInTheDocument();
  });

  it("leaves out open and nothing-found books", async () => {
    h.state = finderState({
      latest: new Map([
        ["b0", mkSearch("b0", "queued")],
        ["b1", mkSearch("b1", "nothing_found")],
      ]),
    });
    render(<CoverBatchFooter books={many(5)} />);
    expect(screen.getByText(/^3 books/)).toBeInTheDocument();
    expect(screen.getByText("1 already being searched.")).toBeInTheDocument();
    expect(screen.getByText("1 tried before with nothing found is left out.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Find covers" }));
    expect(fns.requestBatch).toHaveBeenCalledWith(["b2", "b3", "b4"]);
    await screen.findByText(/^Searching/);
  });

  it("pluralises two nothing-found books", () => {
    h.state = finderState({
      latest: new Map([
        ["b0", mkSearch("b0", "nothing_found")],
        ["b1", mkSearch("b1", "failed")],
      ]),
    });
    render(<CoverBatchFooter books={many(3)} />);
    expect(screen.getByText("1 book · under $0.01")).toBeInTheDocument();
    expect(screen.getByText("2 tried before with nothing found are left out.")).toBeInTheDocument();
  });

  it("shows the near-limit line and keeps the button enabled", () => {
    h.state = finderState({ budget: budgetOf(1000) });
    render(<CoverBatchFooter books={many(3)} />);
    expect(screen.getByText("This month's budget covers about 2 of these 3 books.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Find covers" })).toBeEnabled();
  });

  it("treats a null budget as not used up", () => {
    render(<CoverBatchFooter books={many(3)} />);
    expect(screen.queryByText(/budget/)).toBeNull();
    expect(screen.getByRole("button", { name: "Find covers" })).toBeEnabled();
  });

  it("disables the button when the budget is used up", () => {
    h.state = finderState({ budget: budgetOf(0, 1) });
    render(<CoverBatchFooter books={many(3)} />);
    expect(screen.getByText("This month's cover-finding budget is used up.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Find covers" })).toBeDisabled();
    expect(screen.queryByText(/budget covers about/)).toBeNull();
  });

  it("disables the button with nothing to search", () => {
    render(<CoverBatchFooter books={[]} />);
    expect(screen.getByText("Nothing to search here.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Find covers" })).toBeDisabled();
  });

  it("confirms after Find covers", async () => {
    render(<CoverBatchFooter books={many(3)} />);
    fireEvent.click(screen.getByRole("button", { name: "Find covers" }));
    expect(
      await screen.findByText("Searching 3 books. It carries on whenever either of you has the app open."),
    ).toBeInTheDocument();
  });

  it("says so when the request fails, and clears it on the next try", async () => {
    fns.requestBatch.mockRejectedValueOnce(new Error("network"));
    render(<CoverBatchFooter books={many(3)} />);
    fireEvent.click(screen.getByRole("button", { name: "Find covers" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't start the search. Try again.");
    fireEvent.click(screen.getByRole("button", { name: "Find covers" }));
    await waitFor(() => expect(screen.getByText(/^Searching 3 books/)).toBeInTheDocument());
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("calls requestBatch once on a double tap", async () => {
    let release: (v: unknown) => void = () => {};
    fns.requestBatch.mockReturnValue(new Promise((r) => (release = r)));
    render(<CoverBatchFooter books={many(3)} />);
    const button = screen.getByRole("button", { name: "Find covers" });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(fns.requestBatch).toHaveBeenCalledTimes(1);
    release({ queued: 3, alreadyOpen: 0, nothingFound: 0 });
    await waitFor(() => expect(screen.getByText(/^Searching 3 books/)).toBeInTheDocument());
  });

  it("pads for the safe area", () => {
    const { container } = render(<CoverBatchFooter books={many(3)} />);
    expect((container.firstChild as HTMLElement).className).toContain("safe-area-inset-bottom");
  });
});
