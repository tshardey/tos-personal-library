import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ state: {} as unknown }));
vi.mock("@/contexts/TaggingContext", () => ({ useTagging: () => h.state }));
import LibraryTagsSection from "./LibraryTagsSection";
import { aiBudget, mkJob, mkTag, tagFns, taggingState } from "./testkit";

const vocab = [
  mkTag("cover-red", "Red", "cover-colour"),
  mkTag("found-family", "Found family", "trope"),
  mkTag("dragons", "Dragons", "creature"),
  mkTag("retired", "Retired", "trope", false),
];

function setState(over: Parameters<typeof taggingState>[0] = {}) {
  h.state = taggingState({
    vocabulary: vocab,
    libraryTagsByBook: new Map([["b1", ["cover-red", "found-family"]]]),
    ...over,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  tagFns.setBookLibraryTag.mockResolvedValue(undefined);
  tagFns.retag.mockResolvedValue(undefined);
  setState();
});

describe("LibraryTagsSection", () => {
  it("shows tags grouped in category order with labels", () => {
    render(<LibraryTagsSection bookId="b1" />);
    expect(screen.getByRole("heading", { name: "Library tags" })).toBeTruthy();
    const lines = screen.getAllByText(/:/).map((e) => e.parentElement?.textContent);
    expect(lines).toEqual(["Tropes: Found family", "Cover colour: Red"]);
  });

  it("says when there are no tags", () => {
    setState({ libraryTagsByBook: new Map() });
    render(<LibraryTagsSection bookId="b1" />);
    expect(screen.getByText("No library tags yet.")).toBeTruthy();
  });

  it("lists every active tag grouped in the editor and toggles once", async () => {
    render(<LibraryTagsSection bookId="b1" />);
    fireEvent.click(screen.getByRole("button", { name: "Edit tags" }));
    expect(screen.getByRole("group", { name: "Creatures and beings" })).toBeTruthy();
    expect(screen.queryByLabelText("Retired")).toBeNull();
    let release: () => void = () => {};
    tagFns.setBookLibraryTag.mockReturnValue(new Promise<void>((r) => (release = r)));
    const dragons = screen.getByLabelText("Dragons") as HTMLInputElement;
    fireEvent.click(dragons);
    fireEvent.click(dragons);
    expect(tagFns.setBookLibraryTag).toHaveBeenCalledTimes(1);
    expect(tagFns.setBookLibraryTag).toHaveBeenCalledWith("b1", "dragons", true);
    release();
    await waitFor(() => expect((screen.getByLabelText("Dragons") as HTMLInputElement).disabled).toBe(false));
  });

  it("unchecking removes the tag", async () => {
    render(<LibraryTagsSection bookId="b1" />);
    fireEvent.click(screen.getByRole("button", { name: "Edit tags" }));
    fireEvent.click(screen.getByLabelText("Red"));
    await waitFor(() => expect(tagFns.setBookLibraryTag).toHaveBeenCalledWith("b1", "cover-red", false));
  });

  it("reverts and alerts when the save fails", async () => {
    tagFns.setBookLibraryTag.mockRejectedValue(new Error("x"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    render(<LibraryTagsSection bookId="b1" />);
    fireEvent.click(screen.getByRole("button", { name: "Edit tags" }));
    fireEvent.click(screen.getByLabelText("Dragons"));
    expect((await screen.findByRole("alert")).textContent).toBe("Couldn't save the tag.");
    expect((screen.getByLabelText("Dragons") as HTMLInputElement).checked).toBe(false);
  });

  it("opening and closing the editor writes nothing", () => {
    render(<LibraryTagsSection bookId="b1" />);
    fireEvent.click(screen.getByRole("button", { name: "Edit tags" }));
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(tagFns.setBookLibraryTag).not.toHaveBeenCalled();
    expect(tagFns.retag).not.toHaveBeenCalled();
  });

  it("Retag this book calls retag, then shows Tagging… while the job is open", async () => {
    const { rerender } = render(<LibraryTagsSection bookId="b1" />);
    fireEvent.click(screen.getByRole("button", { name: "Retag this book" }));
    await waitFor(() => expect(tagFns.retag).toHaveBeenCalledWith("b1"));
    setState({ latestJob: new Map([["b1", mkJob("b1", "queued")]]) });
    rerender(<LibraryTagsSection bookId="b1" />);
    const b = screen.getByRole("button", { name: "Tagging…" }) as HTMLButtonElement;
    expect(b.disabled).toBe(true);
  });

  it("shows Tagging… for a processing job", () => {
    setState({ latestJob: new Map([["b1", mkJob("b1", "processing")]]) });
    render(<LibraryTagsSection bookId="b1" />);
    expect(screen.getByText("Tagging…")).toBeTruthy();
  });

  it("shows the failure and allows another try", async () => {
    setState({ latestJob: new Map([["b1", mkJob("b1", "failed")]]) });
    render(<LibraryTagsSection bookId="b1" />);
    fireEvent.click(screen.getByRole("button", { name: "Tagging failed. Try again." }));
    await waitFor(() => expect(tagFns.retag).toHaveBeenCalledWith("b1"));
  });

  it("disables Retag at the budget cap", () => {
    setState({ budgets: { tagging: aiBudget(1000, 5000), ask: null } });
    render(<LibraryTagsSection bookId="b1" />);
    expect((screen.getByRole("button", { name: "Retag this book" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("This month's tagging budget is used up.")).toBeTruthy();
  });

  it("renders nothing when tagging is unavailable", () => {
    setState({ available: false });
    const { container } = render(<LibraryTagsSection bookId="b1" />);
    expect(container.textContent).toBe("");
  });
});
