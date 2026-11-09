import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import CopyList from "./CopyList";
import type { Copy, HouseholdMember } from "@/lib/types";

vi.mock("@/lib/library-repo", () => ({
  deleteCopy: vi.fn().mockResolvedValue(undefined),
  deleteBook: vi.fn().mockResolvedValue(undefined),
  updateCopy: vi.fn().mockResolvedValue(undefined),
}));
import { deleteBook, deleteCopy } from "@/lib/library-repo";

const members: HouseholdMember[] = [
  { householdId: "h", userId: "u1", displayName: "Tierra", createdAt: "" },
];
function copy(id: string, ownerUserId: string | null): Copy {
  return {
    id,
    bookId: "b1",
    ownerUserId,
    editionNote: null,
    location: null,
    origin: "manual",
    libibId: null,
    photoPath: null,
    intakeItemId: null,
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
      <CopyList copies={copies} members={members} onChanged={onChanged} onBookDeleted={onBookDeleted} />,
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
});
