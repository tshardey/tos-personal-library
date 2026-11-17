import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReadStatusMap } from "@/lib/reading/types";
import { localDay } from "@/lib/date-added";
import MarkReadButton from "./MarkReadButton";
import { YourReadingControl } from "./YourReadingSection";
import { useYourReading } from "./useYourReading";

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

function Button1({ onShow }: { onShow: () => void }) {
  const reading = useYourReading("b1");
  return <MarkReadButton reading={reading} onShowReading={onShow} />;
}

function Both({ onShow }: { onShow: () => void }) {
  const reading = useYourReading("b1");
  return (
    <>
      <MarkReadButton reading={reading} onShowReading={onShow} />
      <YourReadingControl reading={reading} />
    </>
  );
}

function setup(byBook: ReadStatusMap = new Map(), available = true, onShow = vi.fn(), shared = false) {
  h.reading = { available, loading: false, rows: [], byBook, userId: "u1", setStatus: h.setStatus, reload: vi.fn() };
  const ui = shared ? <Both onShow={onShow} /> : <Button1 onShow={onShow} />;
  return { onShow, ...render(ui) };
}
const mine = (state: "read" | "dnf", finishedOn: string | null): ReadStatusMap =>
  new Map([["b1", new Map([["u1", { state, finishedOn }]])]]);

describe("MarkReadButton", () => {
  beforeEach(() => {
    h.setStatus.mockReset();
    h.setStatus.mockResolvedValue(undefined);
  });

  it("unread: Mark read saves today and the name becomes Your reading: Read", async () => {
    setup();
    fireEvent.click(screen.getByRole("button", { name: "Mark read" }));
    expect(h.setStatus).toHaveBeenCalledWith(["b1"], "read", localDay(new Date().toISOString()), false);
    expect(await screen.findByRole("button", { name: "Your reading: Read" })).toBeInTheDocument();
  });

  it("read: a click shows the reading and writes nothing", () => {
    const { onShow } = setup(mine("read", "2026-03-02"));
    fireEvent.click(screen.getByRole("button", { name: "Your reading: Read" }));
    expect(onShow).toHaveBeenCalledTimes(1);
    expect(h.setStatus).not.toHaveBeenCalled();
  });

  it("dnf: is named Your reading: Did not finish", () => {
    const { onShow } = setup(mine("dnf", null));
    const btn = screen.getByRole("button", { name: "Your reading: Did not finish" });
    expect(btn).toHaveTextContent("Did not finish");
    fireEvent.click(btn);
    expect(onShow).toHaveBeenCalledTimes(1);
    expect(h.setStatus).not.toHaveBeenCalled();
  });

  it("is disabled while a save is pending and a double click sends one write", async () => {
    let finish: () => void = () => {};
    h.setStatus.mockReturnValue(new Promise<void>((r) => (finish = r)));
    setup();
    const btn = screen.getByRole("button", { name: "Mark read" });
    fireEvent.click(btn);
    fireEvent.click(btn);
    expect(h.setStatus).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button")).toBeDisabled();
    finish();
    await waitFor(() => expect(screen.getByRole("button")).toBeEnabled());
  });

  it("renders nothing when unavailable", () => {
    const { container } = setup(new Map(), false);
    expect(container).toBeEmptyDOMElement();
  });

  it("shares one pending state with the group", () => {
    let finish: () => void = () => {};
    h.setStatus.mockReturnValue(new Promise<void>((r) => (finish = r)));
    setup(new Map(), true, vi.fn(), true);
    fireEvent.click(screen.getByRole("button", { name: "Mark read" }));
    expect(within_group("Read")).toHaveAttribute("aria-pressed", "true");
    finish();
  });
});

function within_group(name: string) {
  const group = screen.getByRole("group", { name: "Your reading" });
  return Array.from(group.querySelectorAll("button")).find((b) => b.textContent === name)!;
}
