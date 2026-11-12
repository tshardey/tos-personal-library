import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { finderState, fns, mkBook, mkSearch } from "./testkit";

const h = vi.hoisted(() => ({ state: {} as Record<string, unknown> }));
vi.mock("@/contexts/CoverFinderContext", () => ({ useCoverFinder: () => h.state }));
import NothingFoundList from "./NothingFoundList";

beforeEach(() => {
  vi.clearAllMocks();
  fns.retry.mockResolvedValue("queued");
  h.state = finderState({
    latest: new Map([
      ["a", mkSearch("a", "nothing_found", { createdAt: "2026-11-02T10:00:00Z" })],
      ["b", mkSearch("b", "failed", { createdAt: "2026-11-03T10:00:00Z" })],
    ]),
  });
});

describe("NothingFoundList", () => {
  it("renders a row per book with its outcome and date", () => {
    render(<NothingFoundList books={[mkBook("a", "Glass Orchard"), mkBook("b", "Paper Tide")]} />);
    expect(screen.getByText("Glass Orchard")).toBeInTheDocument();
    expect(screen.getByText("Nothing good found")).toBeInTheDocument();
    expect(screen.getByText("Search failed")).toBeInTheDocument();
    expect(screen.getByText(new Date("2026-11-02T10:00:00Z").toLocaleDateString())).toBeInTheDocument();
  });

  it("Try again retries that book", () => {
    render(<NothingFoundList books={[mkBook("a", "Glass Orchard"), mkBook("b", "Paper Tide")]} />);
    fireEvent.click(screen.getAllByRole("button", { name: "Try again" })[1]);
    expect(fns.retry).toHaveBeenCalledWith("b");
  });
});
