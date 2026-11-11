import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TosTag } from "@/lib/tos-tags";
import TosTagsSection from "./TosTagsSection";

vi.mock("@/lib/library-repo", () => ({
  addBookTag: vi.fn().mockResolvedValue(undefined),
  removeBookTag: vi.fn().mockResolvedValue(undefined),
}));
import { addBookTag, removeBookTag } from "@/lib/library-repo";

const tosTags: TosTag[] = [
  { id: "fantasy", label: "Fantasy", category: "genre" },
  { id: "epistolary", label: "Letters / Documents / Found Records", category: "form" },
  { id: "re-read", label: "Re-read", category: "agency", scope: "reader" },
  { id: "audio", label: "Audio", category: "form", derivedFromType: "audiobook" },
];

function setup(tagIds: string[], extra: { stale?: boolean; unavailable?: boolean } = {}) {
  const onChange = vi.fn();
  render(
    <TosTagsSection
      bookId="b1"
      householdId="h1"
      tagIds={tagIds}
      tosTags={tosTags}
      stale={extra.stale ?? false}
      unavailable={extra.unavailable}
      onChange={onChange}
    />,
  );
  return onChange;
}

describe("TosTagsSection", () => {
  beforeEach(() => vi.clearAllMocks());

  it("shows the heading and an empty message", () => {
    setup([]);
    expect(screen.getByRole("heading", { name: "Tome of Secrets" })).toBeInTheDocument();
    expect(screen.getByText("No Tome of Secrets tags yet.")).toBeInTheDocument();
  });

  it("renders a tag label under its category", () => {
    setup(["fantasy"]);
    expect(screen.getByText("Genre:")).toBeInTheDocument();
    expect(screen.getByText(/Fantasy/)).toBeInTheDocument();
  });

  it("notes stale names", () => {
    setup(["fantasy"], { stale: true });
    expect(screen.getByText("Tag names couldn't be loaded; showing ids.")).toBeInTheDocument();
  });

  it("checking a tag adds it", async () => {
    const onChange = setup([]);
    fireEvent.click(screen.getByRole("button", { name: "Edit tags" }));
    fireEvent.click(screen.getByLabelText("Letters / Documents / Found Records"));
    await waitFor(() => expect(addBookTag).toHaveBeenCalledWith("b1", "h1", "epistolary"));
    await waitFor(() => expect(onChange).toHaveBeenCalledWith(["epistolary"]));
  });

  it("unchecking a tag removes it", async () => {
    setup(["fantasy"]);
    fireEvent.click(screen.getByRole("button", { name: "Edit tags" }));
    fireEvent.click(screen.getByLabelText("Fantasy"));
    await waitFor(() => expect(removeBookTag).toHaveBeenCalledWith("b1", "fantasy"));
  });

  it("reverts and alerts when saving fails", async () => {
    vi.mocked(addBookTag).mockRejectedValueOnce(new Error("nope"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const onChange = setup([]);
    fireEvent.click(screen.getByRole("button", { name: "Edit tags" }));
    const box = screen.getByLabelText("Fantasy");
    fireEvent.click(box);
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't save the tag.");
    expect(box).not.toBeChecked();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("offers neither reader nor derived tags, and shows an existing one as set in ToS", () => {
    setup(["re-read"]);
    fireEvent.click(screen.getByRole("button", { name: "Edit tags" }));
    expect(screen.queryByLabelText("Re-read")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Audio")).not.toBeInTheDocument();
    expect(screen.getByText(/Re-read.*set in Tome of Secrets/)).toBeInTheDocument();
  });

  it("is read-only when tags are unavailable", () => {
    setup([], { unavailable: true });
    expect(screen.getByText("Tome of Secrets tags unavailable.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Edit tags" })).not.toBeInTheDocument();
  });
});
