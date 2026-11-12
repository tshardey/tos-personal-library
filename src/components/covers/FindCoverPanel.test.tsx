import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BookWithCopies } from "@/lib/types";
import type { CoverBudget, CoverMark, CoverSearch } from "@/lib/covers/types";
import type { CoverFinderState } from "@/contexts/CoverFinderContext";

const h = vi.hoisted(() => ({ state: {} as Record<string, unknown> }));
vi.mock("@/contexts/CoverFinderContext", () => ({ useCoverFinder: () => h.state }));
import FindCoverPanel from "./FindCoverPanel";

const book = { id: "b1", title: "The Salt Road" } as BookWithCopies;

const fns = {
  mark: vi.fn(),
  unmark: vi.fn(),
  findNow: vi.fn(),
  retry: vi.fn(),
};

function setState(over: Partial<CoverFinderState> = {}) {
  h.state = { available: true, marks: new Map(), latest: new Map(), budget: null, ...fns, ...over };
}

const search = (status: string, id = "s1"): CoverSearch => ({ id, bookId: "b1", status }) as CoverSearch;
const usedUp: CoverBudget = { month: "2026-11", spentMicro: 5000, budgetMicro: 5000, reserveMicro: 1, globalSpentMicro: 0, globalBudgetMicro: 100000 };

beforeEach(() => {
  vi.clearAllMocks();
  fns.mark.mockResolvedValue(undefined);
  fns.unmark.mockResolvedValue(undefined);
  fns.findNow.mockResolvedValue("queued");
  fns.retry.mockResolvedValue("queued");
  setState();
});

const open = () => fireEvent.click(screen.getByRole("button", { name: "Find a better cover" }));

describe("FindCoverPanel", () => {
  it("adds to batch with reasons and note", async () => {
    render(<FindCoverPanel book={book} />);
    open();
    fireEvent.click(screen.getByRole("button", { name: "Wrong language" }));
    fireEvent.change(screen.getByLabelText("What's wrong? (optional)"), {
      target: { value: "this is the Spanish edition" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add to batch" }));
    await waitFor(() => expect(fns.mark).toHaveBeenCalledWith("b1", ["wrong_language"], "this is the Spanish edition"));
  });

  it("find now marks then shows looking", async () => {
    render(<FindCoverPanel book={book} />);
    open();
    fireEvent.click(screen.getByRole("button", { name: "Wrong language" }));
    fireEvent.change(screen.getByLabelText("What's wrong? (optional)"), { target: { value: "x" } });
    fireEvent.click(screen.getByRole("button", { name: "Find now" }));
    expect(await screen.findByText("Looking for covers…")).toBeInTheDocument();
    expect(fns.findNow).toHaveBeenCalledWith("b1", ["wrong_language"], "x");
  });

  it("sends a blank note as null", async () => {
    render(<FindCoverPanel book={book} />);
    open();
    fireEvent.change(screen.getByLabelText("What's wrong? (optional)"), { target: { value: "   " } });
    fireEvent.click(screen.getByRole("button", { name: "Add to batch" }));
    await waitFor(() => expect(fns.mark).toHaveBeenCalledWith("b1", [], null));
  });

  it("shows a mark, prefills it and removes it", async () => {
    const mark = { bookId: "b1", reasons: ["placeholder"], note: "blurry" } as CoverMark;
    setState({ marks: new Map([["b1", mark]]) });
    render(<FindCoverPanel book={book} />);
    expect(screen.getByText("Marked for a cover search.")).toBeInTheDocument();
    open();
    expect(screen.getByRole("button", { name: "Placeholder" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Wrong book" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByLabelText("What's wrong? (optional)")).toHaveValue("blurry");
    expect(screen.getByRole("button", { name: "Update mark" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove mark" }));
    await waitFor(() => expect(fns.unmark).toHaveBeenCalledWith("b1"));
  });

  it("shows an open search", () => {
    setState({ latest: new Map([["b1", search("processing")]]) });
    render(<FindCoverPanel book={book} />);
    expect(screen.getByText("Looking for covers…")).toBeInTheDocument();
  });

  it("links to review when ready", () => {
    setState({ latest: new Map([["b1", search("ready")]]) });
    render(<FindCoverPanel book={book} />);
    expect(screen.getByText("New covers are ready.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Review covers" })).toHaveAttribute("href", "#/covers");
  });

  it("retries after nothing found or failure", async () => {
    setState({ latest: new Map([["b1", search("nothing_found")]]) });
    const { unmount } = render(<FindCoverPanel book={book} />);
    expect(screen.getByText("Nothing good found.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(fns.retry).toHaveBeenCalledWith("b1"));
    unmount();
    setState({ latest: new Map([["b1", search("failed")]]) });
    render(<FindCoverPanel book={book} />);
    expect(screen.getByText("The cover search failed.")).toBeInTheDocument();
  });

  it("disables Find now and Try again when the budget is used up", () => {
    setState({ budget: usedUp, latest: new Map([["b1", search("failed")]]) });
    render(<FindCoverPanel book={book} />);
    expect(screen.getByText("This month's cover-finding budget is used up.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try again" })).toBeDisabled();
    open();
    expect(screen.getByRole("button", { name: "Find now" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Add to batch" })).toBeEnabled();
  });

  it("shows an alert and keeps the note when saving fails", async () => {
    fns.mark.mockRejectedValue(new Error("boom"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    render(<FindCoverPanel book={book} />);
    open();
    fireEvent.change(screen.getByLabelText("What's wrong? (optional)"), { target: { value: "keep me" } });
    fireEvent.click(screen.getByRole("button", { name: "Add to batch" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't save this. Try again.");
    expect(screen.getByLabelText("What's wrong? (optional)")).toHaveValue("keep me");
  });

  it("treats already_open as an open search", async () => {
    fns.findNow.mockResolvedValue("already_open");
    render(<FindCoverPanel book={book} />);
    open();
    fireEvent.click(screen.getByRole("button", { name: "Find now" }));
    expect(await screen.findByText("Looking for covers…")).toBeInTheDocument();
  });

  it("calls nothing when opened and closed", () => {
    render(<FindCoverPanel book={book} />);
    open();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByRole("button", { name: "Find a better cover" })).toBeInTheDocument();
    for (const f of Object.values(fns)) expect(f).not.toHaveBeenCalled();
  });

  it("follows the search to ready after Find now", async () => {
    const { rerender } = render(<FindCoverPanel book={book} />);
    open();
    fireEvent.click(screen.getByRole("button", { name: "Find now" }));
    expect(await screen.findByText("Looking for covers…")).toBeInTheDocument();
    setState({ latest: new Map([["b1", search("queued", "s2")]]) });
    rerender(<FindCoverPanel book={book} />);
    expect(screen.getByText("Looking for covers…")).toBeInTheDocument();
    setState({ latest: new Map([["b1", search("ready", "s2")]]) });
    rerender(<FindCoverPanel book={book} />);
    expect(screen.queryByText("Looking for covers…")).toBeNull();
    expect(screen.getByRole("link", { name: "Review covers" })).toBeInTheDocument();
  });

  it("follows a retried search to nothing found", async () => {
    setState({ latest: new Map([["b1", search("failed", "s1")]]) });
    const { rerender } = render(<FindCoverPanel book={book} />);
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("Looking for covers…")).toBeInTheDocument();
    setState({ latest: new Map([["b1", search("nothing_found", "s2")]]) });
    rerender(<FindCoverPanel book={book} />);
    expect(screen.getByText("Nothing good found.")).toBeInTheDocument();
    expect(screen.queryByText("Looking for covers…")).toBeNull();
  });

  it("alerts on a non-queued outcome", async () => {
    fns.findNow.mockResolvedValue("not_found");
    render(<FindCoverPanel book={book} />);
    open();
    fireEvent.click(screen.getByRole("button", { name: "Find now" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't save this. Try again.");
    expect(screen.queryByText("Looking for covers…")).toBeNull();
  });

  it("alerts when retry rejects", async () => {
    fns.retry.mockRejectedValue(new Error("boom"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    setState({ latest: new Map([["b1", search("failed")]]) });
    render(<FindCoverPanel book={book} />);
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't save this. Try again.");
  });
});
