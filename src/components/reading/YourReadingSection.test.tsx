import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReadStatusMap } from "@/lib/reading/types";
import { localDay } from "@/lib/date-added";
import YourReadingSection from "./YourReadingSection";

const h = vi.hoisted(() => ({
  reading: {} as Record<string, unknown>,
  setStatus: vi.fn(),
}));

vi.mock("@/contexts/ReadingContext", () => ({ useReading: () => h.reading }));
vi.mock("@/contexts/HouseholdContext", () => ({
  useHousehold: () => ({
    members: [
      { householdId: "h1", userId: "u1", displayName: "Member A", createdAt: "" },
      { householdId: "h1", userId: "u2", displayName: "Member B", createdAt: "" },
    ],
  }),
}));

function setup(byBook: ReadStatusMap = new Map(), available = true) {
  h.reading = { available, loading: false, rows: [], byBook, userId: "u1", setStatus: h.setStatus, reload: vi.fn() };
  return render(<YourReadingSection bookId="b1" />);
}
const mine = (state: "read" | "dnf", finishedOn: string | null): ReadStatusMap =>
  new Map([["b1", new Map([["u1", { state, finishedOn }]])]]);

describe("YourReadingSection", () => {
  beforeEach(() => {
    h.setStatus.mockReset();
    h.setStatus.mockResolvedValue(undefined);
  });

  it("renders nothing when reading is unavailable", () => {
    const { container } = setup(new Map(), false);
    expect(container).toBeEmptyDOMElement();
  });

  it("presses the button for the current state, unread by default", () => {
    setup();
    expect(screen.getByRole("button", { name: "Unread" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Read" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.queryByLabelText("Finished")).not.toBeInTheDocument();
  });

  it("presses Did not finish", () => {
    setup(mine("dnf", null));
    expect(screen.getByRole("button", { name: "Did not finish" })).toHaveAttribute("aria-pressed", "true");
  });

  it("Read from unread sends today's local day", async () => {
    setup();
    fireEvent.click(screen.getByRole("button", { name: "Read" }));
    expect(h.setStatus).toHaveBeenCalledWith(["b1"], "read", localDay(new Date().toISOString()), false);
    expect(screen.getByLabelText("Finished")).toHaveValue(localDay(new Date().toISOString()));
  });

  it("Did not finish and Unread send their states", async () => {
    setup(mine("read", "2026-03-02"));
    fireEvent.click(screen.getByRole("button", { name: "Did not finish" }));
    expect(h.setStatus).toHaveBeenLastCalledWith(["b1"], "dnf", null, false);
    await waitFor(() => expect(screen.getByRole("button", { name: "Unread" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Unread" }));
    expect(h.setStatus).toHaveBeenLastCalledWith(["b1"], "unread", null, false);
  });

  it("a picked date saves at once, with no blur", async () => {
    setup(mine("read", "2026-03-02"));
    const input = screen.getByLabelText("Finished");
    expect(input).toHaveValue("2026-03-02");
    fireEvent.change(input, { target: { value: "2026-04-05" } });
    expect(h.setStatus).toHaveBeenCalledTimes(1);
    expect(h.setStatus).toHaveBeenLastCalledWith(["b1"], "read", "2026-04-05", false);
    expect(input).toBeEnabled();
  });

  it("does not save an incomplete, empty or unchanged date", async () => {
    setup(mine("read", "2026-03-02"));
    const input = screen.getByLabelText("Finished");
    fireEvent.change(input, { target: { value: "" } });
    fireEvent.change(input, { target: { value: "2026-03-02" } });
    expect(h.setStatus).not.toHaveBeenCalled();
  });

  it("two quick changes end with the last date saved", async () => {
    let finish: () => void = () => {};
    h.setStatus.mockReturnValueOnce(new Promise<void>((r) => (finish = r)));
    setup(mine("read", "2026-03-02"));
    const input = screen.getByLabelText("Finished");
    fireEvent.change(input, { target: { value: "2026-04-05" } });
    fireEvent.change(input, { target: { value: "2026-04-06" } });
    fireEvent.change(input, { target: { value: "2026-04-07" } });
    expect(h.setStatus).toHaveBeenCalledTimes(1);
    expect(input).toBeEnabled();
    expect(input).toHaveValue("2026-04-07");
    finish();
    await waitFor(() => expect(h.setStatus).toHaveBeenCalledTimes(2));
    expect(h.setStatus).toHaveBeenLastCalledWith(["b1"], "read", "2026-04-07", false);
  });

  it("unmounting while a save is in flight still sends the queued date", async () => {
    let finish: () => void = () => {};
    h.setStatus.mockReturnValueOnce(new Promise<void>((r) => (finish = r)));
    const { unmount } = setup(mine("read", "2026-03-02"));
    const input = screen.getByLabelText("Finished");
    fireEvent.change(input, { target: { value: "2026-04-05" } });
    fireEvent.change(input, { target: { value: "2026-04-06" } });
    unmount();
    finish();
    await waitFor(() => expect(h.setStatus).toHaveBeenCalledTimes(2));
    expect(h.setStatus).toHaveBeenLastCalledWith(["b1"], "read", "2026-04-06", false);
  });

  it("Clear date sends null", async () => {
    setup(mine("read", "2026-03-02"));
    fireEvent.click(screen.getByRole("button", { name: "Clear date" }));
    expect(h.setStatus).toHaveBeenCalledWith(["b1"], "read", null, false);
  });

  it("describes the other members and gives them no control", () => {
    const map: ReadStatusMap = new Map([["b1", new Map([["u2", { state: "read" as const, finishedOn: "2026-03-02" }]])]]);
    setup(map);
    expect(screen.getByText("Member B: read (2 Mar 2026)")).toBeInTheDocument();
    expect(screen.queryByText(/Member A:/)).not.toBeInTheDocument();
    expect(screen.getAllByRole("button")).toHaveLength(3);
  });

  it("describes undated read, did not finish and not read", () => {
    const { unmount } = setup(new Map([["b1", new Map([["u2", { state: "read" as const, finishedOn: null }]])]]));
    expect(screen.getByText("Member B: read")).toBeInTheDocument();
    unmount();
    const r = setup(new Map([["b1", new Map([["u2", { state: "dnf" as const, finishedOn: null }]])]]));
    expect(screen.getByText("Member B: did not finish")).toBeInTheDocument();
    r.unmount();
    setup(new Map());
    expect(screen.getByText("Member B: not read")).toBeInTheDocument();
  });

  it("shows the new state at once and reverts with an alert when the save fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    h.setStatus.mockRejectedValue(new Error("boom"));
    setup();
    fireEvent.click(screen.getByRole("button", { name: "Did not finish" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't save your reading.");
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Unread" })).toHaveAttribute("aria-pressed", "true"),
    );
    expect(screen.getByRole("button", { name: "Did not finish" })).toHaveAttribute("aria-pressed", "false");
  });

  it("disables the buttons, not the date, while a save is pending", async () => {
    let finish: () => void = () => {};
    h.setStatus.mockReturnValue(new Promise<void>((r) => (finish = r)));
    setup();
    fireEvent.click(screen.getByRole("button", { name: "Read" }));
    expect(screen.getByRole("button", { name: "Clear date" })).toBeDisabled();
    for (const name of ["Unread", "Read", "Did not finish"]) {
      expect(screen.getByRole("button", { name })).toBeDisabled();
    }
    expect(screen.getByLabelText("Finished")).toBeEnabled();
    fireEvent.change(screen.getByLabelText("Finished"), { target: { value: "2026-04-05" } });
    expect(h.setStatus).toHaveBeenCalledTimes(1);
    finish();
    await waitFor(() => expect(screen.getByRole("button", { name: "Unread" })).toBeEnabled());
  });
});
