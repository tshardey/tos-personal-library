import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import CopyList from "./CopyList";
import type { Copy, HouseholdMember } from "@/lib/types";

vi.mock("@/lib/library-repo", () => ({
  deleteCopy: vi.fn().mockResolvedValue(undefined),
  deleteBook: vi.fn().mockResolvedValue(undefined),
  updateCopy: vi.fn().mockResolvedValue(undefined),
  setCopyFlags: vi.fn().mockResolvedValue(undefined),
}));
import { deleteBook, deleteCopy, setCopyFlags, updateCopy } from "@/lib/library-repo";

const members: HouseholdMember[] = [
  { householdId: "h", userId: "u1", displayName: "Tierra", createdAt: "" },
];
function copy(id: string, ownerUserId: string | null): Copy {
  return {
    id,
    bookId: "b1",
    ownerUserId,
    editionNote: null,
    copyNote: null,
    location: null,
    origin: "manual",
    libibId: null,
    photoPath: null,
    intakeItemId: null,
    unhauledAt: null,
    deluxe: false,
    signed: false,
    userEditedFields: [],
    createdAt: "",
    updatedAt: "",
  };
}

describe("CopyList", () => {
  const onChanged = vi.fn();
  const onBookDeleted = vi.fn();
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.restoreAllMocks());

  function renderList(copies: Copy[]) {
    render(
      <CopyList copies={copies} members={members} labels={["Invented Box"]} onChanged={onChanged} onBookDeleted={onBookDeleted} />,
    );
  }

  it("labels owners by display name or Shared", () => {
    renderList([copy("c1", "u1"), copy("c2", null)]);
    expect(screen.getByText("Tierra")).toBeInTheDocument();
    expect(screen.getByText("Shared")).toBeInTheDocument();
  });

  it("deletes one of two copies without prompting", async () => {
    const confirm = vi.spyOn(window, "confirm");
    renderList([copy("c1", "u1"), copy("c2", null)]);
    fireEvent.click(screen.getAllByText("Delete copy")[0]);
    await waitFor(() => expect(deleteCopy).toHaveBeenCalledWith("c1"));
    expect(confirm).not.toHaveBeenCalled();
    expect(deleteBook).not.toHaveBeenCalled();
  });

  it("asks to remove the book when deleting the last copy; confirm deletes the book", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    renderList([copy("c1", "u1")]);
    fireEvent.click(screen.getByText("Delete copy"));
    await waitFor(() => expect(deleteBook).toHaveBeenCalledWith("b1"));
    expect(confirm).toHaveBeenCalledWith("Remove this book from the library too?");
    expect(deleteCopy).not.toHaveBeenCalled();
    expect(onBookDeleted).toHaveBeenCalled();
  });

  it("keeps the book with zero copies when the prompt is declined", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);
    renderList([copy("c1", "u1")]);
    fireEvent.click(screen.getByText("Delete copy"));
    await waitFor(() => expect(deleteCopy).toHaveBeenCalledWith("c1"));
    expect(deleteBook).not.toHaveBeenCalled();
    expect(onChanged).toHaveBeenCalled();
  });

  it("edits the edition and copy note together", async () => {
    renderList([copy("c1", "u1")]);
    fireEvent.click(screen.getByText("Edit copy"));
    fireEvent.click(screen.getByRole("button", { name: "Edition: none" }));
    fireEvent.click(screen.getByRole("button", { name: "Invented Box" }));
    fireEvent.change(screen.getByLabelText("Copy note"), { target: { value: "Signed" } });
    fireEvent.click(screen.getByText("Save copy"));
    await waitFor(() =>
      expect(updateCopy).toHaveBeenCalledWith(
        "c1",
        { editionNote: "Invented Box", copyNote: "Signed" },
        ["copyNote", "editionNote"],
      ),
    );
  });

  it("shows the copy note under the edition", () => {
    renderList([{ ...copy("c1", "u1"), editionNote: "Invented Box", copyNote: "Sprayed edges" }]);
    expect(screen.getByText("Sprayed edges")).toBeInTheDocument();
  });

  describe("flag toggles", () => {
    beforeEach(() => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date(2026, 10, 12, 15, 0, 0));
    });
    afterEach(() => vi.useRealTimers());

    it("Deluxe sets and clears the flag, then reloads", async () => {
      const c = copy("c1", "u1");
      const { unmount } = render(
        <CopyList copies={[c]} members={members} labels={[]} onChanged={onChanged} onBookDeleted={onBookDeleted} />,
      );
      fireEvent.click(screen.getByRole("button", { name: "Deluxe" }));
      await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
      expect(setCopyFlags).toHaveBeenCalledTimes(1);
      expect(setCopyFlags).toHaveBeenCalledWith(c, { deluxe: true });
      unmount();
      const d = { ...c, deluxe: true };
      renderList([d]);
      const btn = screen.getByRole("button", { name: "Deluxe" });
      expect(btn).toHaveAttribute("aria-pressed", "true");
      fireEvent.click(btn);
      await waitFor(() => expect(setCopyFlags).toHaveBeenLastCalledWith(d, { deluxe: false }));
    });

    it("Signed sets and clears the flag", async () => {
      const c = copy("c1", "u1");
      const { unmount } = render(
        <CopyList copies={[c]} members={members} labels={[]} onChanged={onChanged} onBookDeleted={onBookDeleted} />,
      );
      fireEvent.click(screen.getByRole("button", { name: "Signed" }));
      await waitFor(() => expect(setCopyFlags).toHaveBeenCalledWith(c, { signed: true }));
      unmount();
      const d = { ...c, signed: true };
      renderList([d]);
      fireEvent.click(screen.getByRole("button", { name: "Signed" }));
      await waitFor(() => expect(setCopyFlags).toHaveBeenLastCalledWith(d, { signed: false }));
    });

    it("Unhaul sends the current time as an ISO string", async () => {
      const c = copy("c1", "u1");
      renderList([c]);
      fireEvent.click(screen.getByRole("button", { name: "Unhaul" }));
      await waitFor(() =>
        expect(setCopyFlags).toHaveBeenCalledWith(c, { unhauledAt: new Date(2026, 10, 12, 15, 0, 0).toISOString() }),
      );
    });

    it("shows an unhauled copy muted with its day and Undo unhaul", async () => {
      const c = { ...copy("c1", "u1"), unhauledAt: new Date(2026, 10, 12, 9, 0, 0).toISOString() };
      const { container } = render(
        <CopyList copies={[c]} members={members} labels={[]} onChanged={onChanged} onBookDeleted={onBookDeleted} />,
      );
      expect(container.querySelector('[data-unhauled="true"]')).not.toBeNull();
      expect(screen.getByText("Unhauled Nov 12")).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Unhaul" })).toBeNull();
      fireEvent.click(screen.getByRole("button", { name: "Undo unhaul" }));
      await waitFor(() => expect(setCopyFlags).toHaveBeenCalledWith(c, { unhauledAt: null }));
    });

    it("writes once on a double tap", async () => {
      renderList([copy("c1", "u1")]);
      const btn = screen.getByRole("button", { name: "Unhaul" });
      fireEvent.click(btn);
      fireEvent.click(btn);
      await waitFor(() => expect(onChanged).toHaveBeenCalled());
      expect(setCopyFlags).toHaveBeenCalledTimes(1);
    });

    it("shows an error and re-enables the button when the write fails", async () => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      vi.mocked(setCopyFlags).mockRejectedValueOnce(new Error("boom"));
      renderList([copy("c1", "u1")]);
      fireEvent.click(screen.getByRole("button", { name: "Unhaul" }));
      expect(await screen.findByText("Couldn't save the copy.")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Unhaul" })).toBeEnabled();
      expect(onChanged).not.toHaveBeenCalled();
    });
  });
});
