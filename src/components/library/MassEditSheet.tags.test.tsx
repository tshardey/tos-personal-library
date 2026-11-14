import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { bookFixture, copyFixture } from "@/lib/flag-fixtures.test-util";
import type { BookWithCopies } from "@/lib/types";
import { mkTag, taggingState } from "@/components/tags/testkit";

const repo = vi.hoisted(() => ({ updateCopyFields: vi.fn(), updateBook: vi.fn() }));
const tagRepo = vi.hoisted(() => ({ addLibraryTag: vi.fn(), removeLibraryTag: vi.fn() }));
const h = vi.hoisted(() => ({ state: {} as unknown }));
vi.mock("@/lib/library-repo", () => repo);
vi.mock("@/lib/tagging/tagging-repo", () => tagRepo);
vi.mock("@/contexts/TaggingContext", () => ({ useTagging: () => h.state }));
import MassEditSheet from "./MassEditSheet";

const vocab = [
  mkTag("vampires", "Vampires", "creature"),
  mkTag("found-family", "Found family", "trope"),
  mkTag("old", "Old", "trope", false),
];

function catalog(): BookWithCopies[] {
  return ["Atlas", "Codex", "Ember"].map((t) => bookFixture(t, [copyFixture({ id: t + "1", bookId: t })]));
}

function setState(over: Parameters<typeof taggingState>[0] = {}) {
  h.state = taggingState({
    vocabulary: vocab,
    libraryTagsByBook: new Map([
      ["Codex", ["vampires", "found-family"]],
      ["Ember", ["found-family"]],
    ]),
    ...over,
  });
}

function renderSheet() {
  const books = catalog();
  const props = {
    selected: books,
    catalog: books,
    labels: [],
    members: [],
    refresh: vi.fn().mockResolvedValue(true),
    onClose: vi.fn(),
    onDone: vi.fn(),
  };
  render(<MassEditSheet {...props} />);
  return props;
}

function pick(button: "Add tags" | "Remove tags", labels: string[]) {
  fireEvent.click(screen.getByRole("button", { name: button }));
  const dialog = screen.getByRole("dialog", { name: button });
  for (const l of labels) fireEvent.click(within(dialog).getByRole("checkbox", { name: l }));
  fireEvent.click(within(dialog).getByRole("button", { name: "Done" }));
}

beforeEach(() => {
  vi.clearAllMocks();
  repo.updateCopyFields.mockResolvedValue(undefined);
  repo.updateBook.mockResolvedValue(undefined);
  tagRepo.addLibraryTag.mockResolvedValue(undefined);
  tagRepo.removeLibraryTag.mockResolvedValue(undefined);
  setState();
});

describe("MassEditSheet library tags", () => {
  it("hides the row when tagging isn't available", () => {
    setState({ available: false });
    renderSheet();
    expect(screen.queryByRole("button", { name: "Add tags" })).toBeNull();
    expect(screen.queryByText("Library tags")).toBeNull();
  });

  it("adds a tag only to the books that lack it", async () => {
    const props = renderSheet();
    pick("Add tags", ["Vampires"]);
    expect(screen.getByText("2 books' tags")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(screen.getByText("This will change 2 books' tags. There is no undo.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
    await waitFor(() => expect(props.onDone).toHaveBeenCalledWith("Changed 2 books' tags."));
    expect(tagRepo.addLibraryTag.mock.calls).toEqual([
      ["Atlas", "h", "vampires"],
      ["Ember", "h", "vampires"],
    ]);
    expect(tagRepo.removeLibraryTag).not.toHaveBeenCalled();
    expect((h.state as { reload: ReturnType<typeof vi.fn> }).reload).toHaveBeenCalled();
  });

  it("removes with deletes only where the tag is present", async () => {
    const props = renderSheet();
    pick("Remove tags", ["Found family"]);
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
    await waitFor(() => expect(props.onDone).toHaveBeenCalledWith("Changed 2 books' tags."));
    expect(tagRepo.removeLibraryTag.mock.calls).toEqual([
      ["Codex", "found-family"],
      ["Ember", "found-family"],
    ]);
    expect(tagRepo.addLibraryTag).not.toHaveBeenCalled();
  });

  it("keeps a tag out of both pickers at once", () => {
    renderSheet();
    pick("Add tags", ["Vampires"]);
    fireEvent.click(screen.getByRole("button", { name: "Remove tags" }));
    const dialog = screen.getByRole("dialog", { name: "Remove tags" });
    expect(within(dialog).queryByRole("checkbox", { name: "Vampires" })).toBeNull();
    expect(within(dialog).getByRole("checkbox", { name: "Found family" })).toBeInTheDocument();
    // Retired tags aren't offered for adding.
    fireEvent.click(within(dialog).getByRole("button", { name: "Done" }));
    fireEvent.click(screen.getByRole("button", { name: "Add tags" }));
    expect(within(screen.getByRole("dialog", { name: "Add tags" })).queryByRole("checkbox", { name: "Old" })).toBeNull();
  });

  it("Escape closes the picker, not the sheet", () => {
    const props = renderSheet();
    fireEvent.click(screen.getByRole("button", { name: "Add tags" }));
    fireEvent.keyDown(screen.getByRole("dialog", { name: "Add tags" }), { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Add tags" })).toBeNull();
    expect(props.onClose).not.toHaveBeenCalled();
  });

  it("reports a book whose tag write failed and tries only it again", async () => {
    const props = renderSheet();
    tagRepo.addLibraryTag.mockImplementation(async (bookId: string) => {
      if (bookId === "Ember") throw new Error("network");
    });
    pick("Add tags", ["Vampires"]);
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Changed 1 book's tags. 1 couldn't be changed:");
    expect(within(alert).getByRole("listitem")).toHaveTextContent("Ember: tags");

    tagRepo.addLibraryTag.mockClear();
    tagRepo.addLibraryTag.mockResolvedValue(undefined);
    // The reload shows Atlas has the tag now.
    setState({
      libraryTagsByBook: new Map([
        ["Atlas", ["vampires"]],
        ["Codex", ["vampires", "found-family"]],
        ["Ember", ["found-family"]],
      ]),
    });
    fireEvent.click(within(alert).getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(props.onDone).toHaveBeenCalledWith("Changed 2 books' tags."));
    expect(tagRepo.addLibraryTag.mock.calls).toEqual([["Ember", "h", "vampires"]]);
  });
});
