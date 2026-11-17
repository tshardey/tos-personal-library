import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { bookFixture } from "@/lib/flag-fixtures.test-util";
import type { ReadStatusMap } from "@/lib/reading/types";

const h = vi.hoisted(() => ({ reading: {} as unknown }));
vi.mock("@/contexts/ReadingContext", () => ({ useReading: () => h.reading }));
vi.mock("@/hooks/useCopyPhotoUrls", () => ({ useCopyPhotoUrls: () => new Map<string, string>() }));
import CoverWall from "./CoverWall";

const ME = "u-me";
const OTHER = "u-other";

function setReading(available: boolean, byBook: ReadStatusMap) {
  h.reading = { available, loading: false, rows: [], byBook, userId: ME, setStatus: vi.fn(), reload: vi.fn() };
}

const books = [bookFixture("Glass Orchard", []), bookFixture("The Salt Road", [])];
const byBook: ReadStatusMap = new Map([
  ["Glass Orchard", new Map([[ME, { state: "read" as const, finishedOn: "2026-03-01" }]])],
  ["The Salt Road", new Map([[OTHER, { state: "read" as const, finishedOn: "2026-03-01" }]])],
]);

describe("CoverWall read badges", () => {
  it("shows Read on the viewer's read book only", () => {
    setReading(true, byBook);
    const { container } = render(<CoverWall books={books} viewKey="k" />);
    const mine = container.querySelector<HTMLElement>('[data-book-id="Glass Orchard"]')!;
    const theirs = container.querySelector<HTMLElement>('[data-book-id="The Salt Road"]')!;
    expect(within(mine).getByText("✓ Read")).toBeInTheDocument();
    expect(within(theirs).queryByText("✓ Read")).not.toBeInTheDocument();
    expect(screen.getAllByText("✓ Read")).toHaveLength(1);
  });
  it("shows nothing when reading is unavailable", () => {
    setReading(false, byBook);
    render(<CoverWall books={books} viewKey="k" />);
    expect(screen.queryByText("✓ Read")).not.toBeInTheDocument();
  });
});
