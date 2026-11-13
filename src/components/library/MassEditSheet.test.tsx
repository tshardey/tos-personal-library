import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { bookFixture, copyFixture } from "@/lib/flag-fixtures.test-util";
import type { BookWithCopies, HouseholdMember } from "@/lib/types";

const repo = vi.hoisted(() => ({ updateCopyFields: vi.fn(), updateBook: vi.fn() }));
vi.mock("@/lib/library-repo", () => repo);
import MassEditSheet from "./MassEditSheet";

const MEMBERS: HouseholdMember[] = [
  { householdId: "h", userId: "u-a", displayName: "Member A", createdAt: "" },
  { householdId: "h", userId: "u-b", displayName: "Member B", createdAt: "" },
];

/** "Atlas" has an original and a deluxe copy; "Codex" one copy owned by Member B and one unhauled. */
function catalog(): BookWithCopies[] {
  return [
    bookFixture("Atlas", [
      copyFixture({ id: "a1", bookId: "Atlas", editionNote: "Harbor Press" }),
      copyFixture({ id: "a2", bookId: "Atlas", editionNote: "Lantern Box", deluxe: true }),
    ]),
    bookFixture(
      "Codex",
      [
        copyFixture({ id: "c1", bookId: "Codex", ownerUserId: "u-b", userEditedFields: ["location"] }),
        copyFixture({ id: "c2", bookId: "Codex", unhauledAt: "2026-01-01T00:00:00Z" }),
      ],
      { seriesName: "Tide Saga" },
    ),
  ];
}

function renderSheet(books = catalog()) {
  const props = {
    selected: books,
    catalog: books,
    labels: ["Harbor Press", "Lantern Box"],
    members: MEMBERS,
    refresh: vi.fn().mockResolvedValue(true),
    onClose: vi.fn(),
    onDone: vi.fn(),
  };
  render(<MassEditSheet {...props} />);
  return props;
}

const copyBox = (name: RegExp) => screen.getByRole("checkbox", { name });
const select = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });

describe("MassEditSheet", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    repo.updateCopyFields.mockResolvedValue(undefined);
    repo.updateBook.mockResolvedValue(undefined);
  });

  it("lists every copy grouped by book, with unhauled copies unticked, and starts with nothing to change", () => {
    renderSheet();
    const atlas = screen.getByRole("group", { name: "Atlas" });
    expect(within(atlas).getAllByRole("checkbox")).toHaveLength(2);
    expect(copyBox(/Shared · Harbor Press$/)).toBeChecked();
    expect(copyBox(/Shared · Lantern Box · Deluxe$/)).toBeChecked();
    expect(copyBox(/^Member B · No edition label$/)).toBeChecked();
    expect(copyBox(/Unhauled$/)).not.toBeChecked();
    expect(screen.getByText("Nothing to change yet.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Edition label: no change" })).toBeInTheDocument();
  });

  it("confirms with the counts and writes only touched fields to ticked copies", async () => {
    const props = renderSheet();
    select("Deluxe", "on");
    fireEvent.click(copyBox(/Shared · Harbor Press$/)); // untick the original
    expect(screen.getByText("1 copy")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(screen.getByText("This will change 1 copy. There is no undo.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
    await waitFor(() => expect(props.onDone).toHaveBeenCalledWith("Changed 1 copy."));
    // a2 is already deluxe, a1 is unticked, c2 is unhauled and unticked.
    expect(repo.updateCopyFields).toHaveBeenCalledTimes(1);
    expect(repo.updateCopyFields).toHaveBeenCalledWith("c1", { deluxe: true }, ["deluxe", "location"]);
    expect(props.refresh).toHaveBeenCalled();
  });

  it("picks an existing label for a case variant, sets Shared as a null owner, and sets the series", async () => {
    const props = renderSheet();
    fireEvent.click(screen.getByRole("button", { name: "Edition label: no change" }));
    const picker = screen.getByRole("dialog", { name: "Edition label" });
    fireEvent.change(within(picker).getByLabelText("Filter editions"), { target: { value: "lantern box " } });
    fireEvent.keyDown(within(picker).getByLabelText("Filter editions"), { key: "Enter" });
    expect(screen.getByRole("button", { name: "Edition label: Lantern Box" })).toBeInTheDocument();
    select("Owner", "shared");
    select("Series", "set");
    fireEvent.change(screen.getByLabelText("Series name"), { target: { value: "tide saga" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(screen.getByText("This will change 2 copies and 1 book's series. There is no undo.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
    await waitFor(() => expect(props.onDone).toHaveBeenCalled());
    expect(repo.updateCopyFields).toHaveBeenCalledWith("a1", { editionNote: "Lantern Box" }, ["editionNote"]);
    expect(repo.updateCopyFields).toHaveBeenCalledWith(
      "c1",
      { editionNote: "Lantern Box", ownerUserId: null },
      ["editionNote", "location", "ownerUserId"],
    );
    // Codex already has the series in another case; only Atlas changes.
    expect(repo.updateBook).toHaveBeenCalledWith("Atlas", { seriesName: "Tide Saga" }, ["seriesName"]);
  });

  it("unhauls with a timestamp and clears the series", async () => {
    const props = renderSheet();
    select("Unhauled", "on");
    select("Series", "clear");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(screen.getByText("This will change 3 copies and 1 book's series. There is no undo.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
    await waitFor(() => expect(props.onDone).toHaveBeenCalled());
    const [, patch, edited] = repo.updateCopyFields.mock.calls.find(([id]) => id === "a1")!;
    expect(typeof patch.unhauledAt).toBe("string");
    expect(edited).toEqual(["unhauledAt"]);
    expect(repo.updateBook).toHaveBeenCalledWith("Codex", { seriesName: null }, ["seriesName"]);
  });

  it("blocks Save on a blank series or location until one is typed", () => {
    renderSheet();
    select("Series", "set");
    expect(screen.getByText("Type a series name, or choose Clear series.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    select("Series", "");
    select("Location", "set");
    expect(screen.getByText("Type a location, or choose Clear location.")).toBeInTheDocument();
  });

  it("reports the writes that failed, keeps the rest, and tries only those again", async () => {
    const props = renderSheet();
    repo.updateCopyFields.mockImplementation(async (id: string) => {
      if (id === "a1") throw new Error("network");
    });
    repo.updateBook.mockRejectedValueOnce(new Error("network"));
    select("Signed", "on");
    select("Series", "set");
    fireEvent.change(screen.getByLabelText("Series name"), { target: { value: "Glass Orchard" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Changed 2 copies and 1 book's series. 2 couldn't be changed:");
    const failed = within(alert).getByRole("list", { name: "Not changed" });
    expect(within(failed).getAllByRole("listitem").map((li) => li.textContent)).toEqual([
      "Atlas: copy (Shared · Harbor Press)",
      "Atlas: series",
    ]);
    expect(props.onDone).not.toHaveBeenCalled();
    expect(props.refresh).toHaveBeenCalledTimes(1);

    repo.updateCopyFields.mockClear();
    repo.updateBook.mockClear();
    repo.updateCopyFields.mockResolvedValue(undefined);
    fireEvent.click(within(alert).getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(props.onDone).toHaveBeenCalledWith("Changed 1 copy and 1 book's series."));
    expect(repo.updateCopyFields).toHaveBeenCalledTimes(1);
    expect(repo.updateCopyFields).toHaveBeenCalledWith("a1", { signed: true }, ["signed"]);
    expect(repo.updateBook).toHaveBeenCalledTimes(1);
    expect(repo.updateBook).toHaveBeenCalledWith("Atlas", { seriesName: "Glass Orchard" }, ["seriesName"]);
  });

  it("Cancel closes without writing", () => {
    const props = renderSheet();
    select("Deluxe", "on");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(props.onClose).toHaveBeenCalled();
    expect(repo.updateCopyFields).not.toHaveBeenCalled();
  });

  it("lists a book with no copies, whose series can still change", () => {
    renderSheet([bookFixture("Empty", [])]);
    expect(within(screen.getByRole("group", { name: "Empty" })).getByText("No copies.")).toBeInTheDocument();
    select("Series", "set");
    fireEvent.change(screen.getByLabelText("Series name"), { target: { value: "Saga" } });
    expect(screen.getByText("1 book's series")).toBeInTheDocument();
  });
});
