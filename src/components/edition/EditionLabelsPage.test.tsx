import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bookFixture, copyFixture } from "@/lib/flag-fixtures.test-util";
import { resetLibraryView, useLibraryView } from "@/lib/library-view";
import type { BookWithCopies } from "@/lib/types";

const h = vi.hoisted(() => ({ catalog: {} as Record<string, unknown> }));

vi.mock("@/contexts/HouseholdContext", () => ({ useHousehold: () => ({ household: { id: "h1" }, members: [] }) }));
vi.mock("@/hooks/useCatalog", () => ({ useCatalog: () => h.catalog }));
vi.mock("@/lib/library-repo", () => ({ updateCopy: vi.fn().mockResolvedValue(undefined) }));
import { updateCopy } from "@/lib/library-repo";
import EditionLabelsPage from "./EditionLabelsPage";

const books: BookWithCopies[] = [
  bookFixture("A", [
    copyFixture({ id: "a1", editionNote: "Lantern Box Edition" }),
    copyFixture({ id: "a2", editionNote: "Harbor Press", userEditedFields: ["location"] }),
  ]),
  bookFixture("B", [copyFixture({ id: "b1", editionNote: "Lantern Box" }), copyFixture({ id: "b2", editionNote: "Lantern Box" })]),
  bookFixture("C", [copyFixture({ id: "c1", editionNote: "Lantern Box Edition " })]),
];

const reload = vi.fn().mockResolvedValue(undefined);

function row(label: string) {
  return within(screen.getByRole("listitem", { name: label }));
}

let viewEdition: string | null = null;
let setFilter: (e: string | null) => void = () => {};
function ViewProbe() {
  const [view, patch] = useLibraryView("h1");
  viewEdition = view.edition;
  setFilter = (edition) => patch({ edition });
  return null;
}

describe("EditionLabelsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.catalog = { books, loading: false, error: null, reload };
  });
  afterEach(() => resetLibraryView());

  it("lists each label with its copy count, alphabetically", () => {
    render(<EditionLabelsPage />);
    const items = screen.getAllByRole("listitem").map((li) => li.textContent);
    expect(items).toEqual([
      expect.stringContaining("Harbor Press · 1 copy"),
      expect.stringContaining("Lantern Box · 2 copies"),
      expect.stringContaining("Lantern Box Edition · 2 copies"),
    ]);
  });

  it("previews a merge with the existing spelling and combined count, then confirms before writing", async () => {
    render(<EditionLabelsPage />);
    fireEvent.click(row("Lantern Box Edition").getByRole("button", { name: "Rename Lantern Box Edition" }));
    fireEvent.change(screen.getByLabelText(/New name/), { target: { value: "  lantern box " } });
    expect(screen.getByText(`Merges into "Lantern Box". 2 copies will change; "Lantern Box" will have 4 copies.`)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Merge" }));
    expect(updateCopy).not.toHaveBeenCalled();
    expect(screen.getByText(`Change 2 copies from "Lantern Box Edition" to "Lantern Box"?`)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Change 2 copies" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Changed 2 copies."));
    expect(updateCopy).toHaveBeenCalledWith("a1", { editionNote: "Lantern Box" }, ["editionNote"]);
    expect(updateCopy).toHaveBeenCalledWith("c1", { editionNote: "Lantern Box" }, ["editionNote"]);
    expect(updateCopy).toHaveBeenCalledTimes(2);
    expect(reload).toHaveBeenCalled();
  });

  it("renames to a new name", async () => {
    render(<EditionLabelsPage />);
    fireEvent.click(screen.getByRole("button", { name: "Rename Harbor Press" }));
    fireEvent.change(screen.getByLabelText(/New name/), { target: { value: "Harbor Press Classics" } });
    expect(screen.getByText("Renames the label on 1 copy.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Rename" }));
    expect(screen.getByText(`Rename "Harbor Press" to "Harbor Press Classics" on 1 copy?`)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Change 1 copy" }));
    await waitFor(() =>
      expect(updateCopy).toHaveBeenCalledWith("a2", { editionNote: "Harbor Press Classics" }, ["editionNote", "location"]),
    );
  });

  it("asks before clearing a label when the name is blank", async () => {
    render(<EditionLabelsPage />);
    fireEvent.click(screen.getByRole("button", { name: "Rename Lantern Box" }));
    fireEvent.change(screen.getByLabelText(/New name/), { target: { value: "   " } });
    fireEvent.click(screen.getByRole("button", { name: "Clear label" }));
    expect(screen.getByText(`Remove the label "Lantern Box" from 2 copies?`)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(updateCopy).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Clear label" }));
    fireEvent.click(screen.getByRole("button", { name: "Change 2 copies" }));
    await waitFor(() => expect(updateCopy).toHaveBeenCalledTimes(2));
    expect(updateCopy).toHaveBeenCalledWith("b1", { editionNote: null }, ["editionNote"]);
  });

  it("disables the action for an unchanged name and Cancel closes the form", () => {
    render(<EditionLabelsPage />);
    fireEvent.click(screen.getByRole("button", { name: "Rename Harbor Press" }));
    expect(screen.getByText("That is already the label's name.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Rename" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByLabelText(/New name/)).not.toBeInTheDocument();
  });

  it("reports copies that failed to change", async () => {
    vi.mocked(updateCopy).mockRejectedValueOnce(new Error("denied"));
    render(<EditionLabelsPage />);
    fireEvent.click(screen.getByRole("button", { name: "Rename Lantern Box" }));
    fireEvent.change(screen.getByLabelText(/New name/), { target: { value: "Amber Folio" } });
    fireEvent.click(screen.getByRole("button", { name: "Rename" }));
    fireEvent.click(screen.getByRole("button", { name: "Change 2 copies" }));
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("Changed 1 copy. 1 copy couldn't be changed; try again."),
    );
  });

  it("points a library edition filter on the old label at the new one", async () => {
    render(
      <>
        <ViewProbe />
        <EditionLabelsPage />
      </>,
    );
    act(() => setFilter("lantern box edition"));
    fireEvent.click(screen.getByRole("button", { name: "Rename Lantern Box Edition" }));
    fireEvent.change(screen.getByLabelText(/New name/), { target: { value: "Lantern Box" } });
    fireEvent.click(screen.getByRole("button", { name: "Merge" }));
    fireEvent.click(screen.getByRole("button", { name: "Change 2 copies" }));
    await waitFor(() => expect(viewEdition).toBe("Lantern Box"));
  });

  it("leaves a filter alone when other copies still match it", async () => {
    render(
      <>
        <ViewProbe />
        <EditionLabelsPage />
      </>,
    );
    act(() => setFilter("Amber Folio"));
    fireEvent.click(screen.getByRole("button", { name: "Rename Harbor Press" }));
    fireEvent.change(screen.getByLabelText(/New name/), { target: { value: "Amber Folio" } });
    fireEvent.click(screen.getByRole("button", { name: "Rename" }));
    fireEvent.click(screen.getByRole("button", { name: "Change 1 copy" }));
    await waitFor(() => expect(screen.getByRole("status")).toBeInTheDocument());
    expect(viewEdition).toBe("Amber Folio");
  });

  it("says when there are no labels", () => {
    h.catalog = { books: [bookFixture("A", [copyFixture()])], loading: false, error: null, reload };
    render(<EditionLabelsPage />);
    expect(screen.getByText("No copies have an edition label yet.")).toBeInTheDocument();
  });
});
