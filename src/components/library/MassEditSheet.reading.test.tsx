import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { bookFixture, copyFixture } from "@/lib/flag-fixtures.test-util";
import { taggingState } from "@/components/tags/testkit";
import type { ReadStatusMap } from "@/lib/reading/types";
import type { BookWithCopies } from "@/lib/types";

const repo = vi.hoisted(() => ({ updateCopyFields: vi.fn(), updateBook: vi.fn() }));
const readRepo = vi.hoisted(() => ({ setReadStatus: vi.fn() }));
const h = vi.hoisted(() => ({ reading: {} as unknown }));
vi.mock("@/lib/library-repo", () => repo);
vi.mock("@/lib/reading/reading-repo", () => readRepo);
vi.mock("@/contexts/TaggingContext", () => ({ useTagging: () => taggingState({ available: false }) }));
vi.mock("@/contexts/ReadingContext", () => ({ useReading: () => h.reading }));
import MassEditSheet from "./MassEditSheet";

const ME = "u-me";
const reload = vi.fn();

function setReading(over: { available?: boolean; byBook?: ReadStatusMap } = {}) {
  h.reading = {
    available: true,
    loading: false,
    rows: [],
    byBook: new Map([["Codex", new Map([[ME, { state: "read" as const, finishedOn: "2026-03-01" }]])]]),
    userId: ME,
    setStatus: vi.fn(),
    reload,
    ...over,
  };
}

function renderSheet() {
  const books: BookWithCopies[] = ["Atlas", "Codex", "Ember"].map((t) =>
    bookFixture(t, [copyFixture({ id: t + "1", bookId: t })]),
  );
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

const markSelect = () => screen.getByRole("combobox", { name: "Mark as… (for you)" });

beforeEach(() => {
  vi.clearAllMocks();
  repo.updateCopyFields.mockResolvedValue(undefined);
  repo.updateBook.mockResolvedValue(undefined);
  readRepo.setReadStatus.mockResolvedValue([]);
  reload.mockResolvedValue(undefined);
  setReading();
});

describe("MassEditSheet mark as", () => {
  it("offers the four options, with the date only for Read", () => {
    renderSheet();
    const options = Array.from(markSelect().querySelectorAll("option")).map((o) => o.textContent);
    expect(options).toEqual(["No change", "Read", "Did not finish", "Unread"]);
    expect(screen.queryByLabelText("Finish date")).toBeNull();
    fireEvent.change(markSelect(), { target: { value: "read" } });
    expect(screen.getByLabelText("Finish date")).toBeInTheDocument();
    expect(screen.getByText("Blank keeps existing dates; books without one get today.")).toBeInTheDocument();
    fireEvent.change(markSelect(), { target: { value: "dnf" } });
    expect(screen.queryByLabelText("Finish date")).toBeNull();
  });

  it("is hidden when reading is unavailable", () => {
    setReading({ available: false });
    renderSheet();
    expect(screen.queryByRole("combobox", { name: "Mark as… (for you)" })).toBeNull();
  });

  it("confirms the read changes, writes them straight to the repo and reloads once", async () => {
    const props = renderSheet();
    fireEvent.change(markSelect(), { target: { value: "read" } });
    expect(screen.getByText("2 books marked")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(screen.getByText("This will change 2 books marked. There is no undo.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
    await waitFor(() => expect(props.onDone).toHaveBeenCalledWith("Changed 2 books marked."));
    expect(readRepo.setReadStatus).toHaveBeenCalledTimes(1);
    const [household, ids, state, date, keep] = readRepo.setReadStatus.mock.calls[0];
    expect([household, ids, state, keep]).toEqual(["h", ["Atlas", "Ember"], "read", true]);
    expect(date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(repo.updateCopyFields).not.toHaveBeenCalled();
    expect(repo.updateBook).not.toHaveBeenCalled();
  });

  it("sends an explicit date without keeping dates", async () => {
    const props = renderSheet();
    fireEvent.change(markSelect(), { target: { value: "read" } });
    fireEvent.change(screen.getByLabelText("Finish date"), { target: { value: "2026-03-01" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
    await waitFor(() => expect(props.onDone).toHaveBeenCalled());
    expect(readRepo.setReadStatus).toHaveBeenCalledWith("h", ["Atlas", "Ember"], "read", "2026-03-01", false);
  });

  it("lists the books that failed and retries them", async () => {
    readRepo.setReadStatus.mockRejectedValueOnce(new Error("network"));
    renderSheet();
    fireEvent.change(markSelect(), { target: { value: "unread" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
    await screen.findByRole("list", { name: "Not changed" });
    expect(screen.getByText("Codex: reading")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(readRepo.setReadStatus).toHaveBeenCalledTimes(2));
  });
});
