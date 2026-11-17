import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ComponentProps } from "react";
import CoverSizeControl from "./CoverSizeControl";
import FilterChipsRow from "./FilterChipsRow";
import LibraryToolbar from "./LibraryToolbar";

function stubDesktop() {
  window.matchMedia = ((query: string) => ({
    matches: query === "(min-width: 640px)",
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as typeof window.matchMedia;
}

type ToolbarProps = ComponentProps<typeof LibraryToolbar>;

function toolbar(over: Partial<ToolbarProps> = {}) {
  const props: ToolbarProps = {
    query: "",
    onQuery: vi.fn(),
    ask: { disabled: true, note: null, onAsk: vi.fn() },
    filtersCount: 0,
    filtersOpen: false,
    onToggleFilters: vi.fn(),
    filtersId: "filters-panel",
    sort: "title",
    onSort: vi.fn(),
    seriesOrder: false,
    size: "4",
    onSize: vi.fn(),
    selecting: false,
    canSelect: true,
    allShownSelected: false,
    onSelect: vi.fn(),
    onSelectAll: vi.fn(),
    ...over,
  };
  render(<LibraryToolbar {...props} />);
  return props;
}

describe("LibraryToolbar on the phone", () => {
  it("has the search box, Ask, Filters and Select, but no sort or size", () => {
    toolbar();
    expect(screen.getByRole("searchbox", { name: "Search books" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Ask ✨" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Filters" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Select" })).toBeInTheDocument();
    expect(screen.queryByLabelText("Sort")).toBeNull();
    expect(screen.queryByRole("group", { name: "Cover size" })).toBeNull();
  });

  it("shows the Ask note under the box", () => {
    toolbar({ ask: { disabled: true, note: "This month's Ask budget is used up.", onAsk: vi.fn() } });
    expect(screen.getByText("This month's Ask budget is used up.")).toBeInTheDocument();
  });

  it("has no Ask button without ask", () => {
    toolbar({ ask: undefined });
    expect(screen.queryByRole("button", { name: "Ask ✨" })).toBeNull();
  });

  it("Filters names its count and controls the panel", () => {
    const props = toolbar({ filtersCount: 2, filtersOpen: true });
    const button = screen.getByRole("button", { name: "Filters, 2 active" });
    expect(button).toHaveAttribute("aria-expanded", "true");
    expect(button).toHaveAttribute("aria-controls", "filters-panel");
    fireEvent.click(button);
    expect(props.onToggleFilters).toHaveBeenCalled();
  });

  it("swaps Select for Select all while selecting, and hides both when nothing can be selected", () => {
    const props = toolbar({ selecting: true, allShownSelected: true });
    expect(screen.queryByRole("button", { name: "Select" })).toBeNull();
    expect(screen.getByRole("button", { name: "Select all" })).toBeDisabled();
    expect(props.onSelectAll).not.toHaveBeenCalled();
  });

  it("hides Select when canSelect is false", () => {
    toolbar({ canSelect: false });
    expect(screen.queryByRole("button", { name: "Select" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Select all" })).toBeNull();
  });
});

describe("LibraryToolbar on the computer", () => {
  const original = window.matchMedia;
  beforeEach(stubDesktop);
  afterEach(() => {
    window.matchMedia = original;
  });

  it("lists D5's four sort labels and reports a choice", () => {
    const props = toolbar();
    const select = screen.getByLabelText("Sort") as HTMLSelectElement;
    expect(Array.from(select.options).map((o) => o.textContent)).toEqual([
      "Title",
      "Author",
      "Recently added",
      "Published (newest first)",
    ]);
    fireEvent.change(select, { target: { value: "author" } });
    expect(props.onSort).toHaveBeenCalledWith("author");
  });

  it("in series order the sort is disabled with a single Series order option", () => {
    toolbar({ seriesOrder: true, sort: "author" });
    const select = screen.getByLabelText("Sort") as HTMLSelectElement;
    expect(select).toBeDisabled();
    expect(Array.from(select.options).map((o) => o.textContent)).toEqual(["Series order"]);
  });

  it("has the cover size group and a text Ask button", () => {
    toolbar();
    expect(screen.getByRole("group", { name: "Cover size" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Ask ✨" })).toHaveTextContent("Ask ✨");
  });
});

describe("CoverSizeControl", () => {
  it("steps down and up", () => {
    const onSize = vi.fn();
    render(<CoverSizeControl size="3" onSize={onSize} />);
    const group = screen.getByRole("group", { name: "Cover size" });
    fireEvent.click(within(group).getByRole("button", { name: "Smaller covers" }));
    expect(onSize).toHaveBeenLastCalledWith("2");
    fireEvent.click(within(group).getByRole("button", { name: "Larger covers" }));
    expect(onSize).toHaveBeenLastCalledWith("4");
    expect(group.querySelectorAll("[aria-hidden='true'][data-step]")).toHaveLength(5);
  });

  it("disables Smaller at 1 and Larger at 5", () => {
    const { rerender } = render(<CoverSizeControl size="1" onSize={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Smaller covers" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Larger covers" })).toBeEnabled();
    rerender(<CoverSizeControl size="5" onSize={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Larger covers" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Smaller covers" })).toBeEnabled();
  });
});

describe("FilterChipsRow", () => {
  const chips = [
    { key: "deluxe", label: "Deluxe", clear: { deluxe: false } },
    { key: "signed", label: "Signed", clear: { signed: false } },
  ];

  it("renders the count, a chip per filter and Clear all from two chips", () => {
    const onRemove = vi.fn();
    const onClearAll = vi.fn();
    render(<FilterChipsRow chips={chips} count={<p aria-live="polite">3 books</p>} onRemove={onRemove} onClearAll={onClearAll} />);
    expect(screen.getByText("3 books")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Remove filter: Signed" }));
    expect(onRemove).toHaveBeenCalledWith(chips[1]);
    fireEvent.click(screen.getByRole("button", { name: "Clear all" }));
    expect(onClearAll).toHaveBeenCalled();
  });

  it("has no Clear all with one chip", () => {
    render(<FilterChipsRow chips={chips.slice(0, 1)} count={null} onRemove={vi.fn()} onClearAll={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Remove filter: Deluxe" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Clear all" })).toBeNull();
  });
});
