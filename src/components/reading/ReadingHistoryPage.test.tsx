import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { bookFixture, copyFixture } from "@/lib/flag-fixtures.test-util";
import { localDay } from "@/lib/date-added";
import { sgCsv } from "@/lib/reading/fixtures";
import type { PossibleMatch, ReadStatusMap, UploadCounts } from "@/lib/reading/types";
import type { BookWithCopies } from "@/lib/types";

const h = vi.hoisted(() => ({
  reading: {} as Record<string, unknown>,
  catalog: {} as Record<string, unknown>,
  reload: vi.fn(),
  upload: vi.fn(),
  list: vi.fn(),
  count: vi.fn(),
  link: vi.fn(),
  dismiss: vi.fn(),
}));

vi.mock("@/contexts/ReadingContext", () => ({ useReading: () => h.reading }));
vi.mock("@/hooks/useCatalog", () => ({ useCatalog: () => h.catalog }));
vi.mock("@/contexts/HouseholdContext", () => ({
  useHousehold: () => ({
    household: { id: "h1" },
    members: [
      { householdId: "h1", userId: "u2", displayName: "Member B", createdAt: "" },
      { householdId: "h1", userId: "u1", displayName: "Member A", createdAt: "" },
    ],
  }),
}));
vi.mock("@/lib/reading/reading-repo", () => ({
  uploadHistoryBatch: (...a: unknown[]) => h.upload(...a),
  listPossibleMatches: () => h.list(),
  countUnmatchedHistory: (...a: unknown[]) => h.count(...a),
  linkHistory: (...a: unknown[]) => h.link(...a),
  dismissMatch: (...a: unknown[]) => h.dismiss(...a),
}));
import ReadingHistoryPage from "./ReadingHistoryPage";

const shelf = (n: number): BookWithCopies[] =>
  Array.from({ length: n }, (_, i) => bookFixture(`b${i + 1}`, [copyFixture({ id: `c${i + 1}`, bookId: `b${i + 1}` })]));

const today = localDay(new Date().toISOString());
const statuses = (entries: [string, string, "read" | "dnf", string | null][]): ReadStatusMap => {
  const m: ReadStatusMap = new Map();
  for (const [b, u, state, finishedOn] of entries) {
    if (!m.has(b)) m.set(b, new Map());
    m.get(b)!.set(u, { state, finishedOn });
  }
  return m;
};

const counts = (over: Partial<UploadCounts> = {}): UploadCounts => ({
  rows: 500, matched: 1, applied: 1, possible: 1, unmatched: 1, ...over,
});

function setup(opts: { byBook?: ReadStatusMap; books?: BookWithCopies[]; available?: boolean } = {}) {
  h.reading = {
    available: opts.available ?? true,
    loading: false,
    rows: [],
    byBook: opts.byBook ?? new Map(),
    userId: "u1",
    reload: h.reload,
  };
  h.catalog = { books: opts.books ?? shelf(3), loading: false, error: null, reload: vi.fn(), refresh: vi.fn() };
  return render(<ReadingHistoryPage />);
}

const csvOf = (n: number, skippedRows = 0): File => {
  const rows: Partial<Record<string, string>>[] = [];
  for (let i = 0; i < n; i++) {
    rows.push({ Title: `The Salt Road ${i}`, Authors: "Petra Wynnecombe", "Read Status": "read", "Last Date Read": "2026/03/02" });
  }
  for (let i = 0; i < skippedRows; i++) {
    rows.push({ Title: `Unread ${i}`, Authors: "Petra Wynnecombe", "Read Status": "to-read" });
  }
  return new File([sgCsv(rows)], "export.csv", { type: "text/csv" });
};

async function choose(file: File) {
  fireEvent.change(screen.getByLabelText("StoryGraph CSV file"), { target: { files: [file] } });
}

const match = (historyId: string, bookId: string): PossibleMatch => ({
  historyId, bookId, reason: "title_author", sgTitle: "The Salt Road", sgAuthors: ["Petra Wynnecombe"],
});

beforeEach(() => {
  vi.clearAllMocks();
  h.reload.mockResolvedValue(undefined);
  h.list.mockResolvedValue([]);
  h.count.mockResolvedValue(0);
  h.upload.mockResolvedValue(counts());
  h.link.mockResolvedValue("linked");
  h.dismiss.mockResolvedValue("dismissed");
});

describe("Reading history: stats", () => {
  it("shows my block first with read of owned and read this year", async () => {
    setup({ byBook: statuses([["b1", "u1", "read", today], ["b2", "u1", "read", "2020-01-01"], ["b3", "u1", "dnf", null]]) });
    const blocks = screen.getAllByRole("listitem", { name: /Member/ });
    expect(blocks[0]).toHaveAccessibleName("Member A");
    const a = within(blocks[0]);
    expect(a.getByText("Read of owned: 2 of 3, 67%")).toBeInTheDocument();
    expect(a.getByText("Read this year: 1")).toBeInTheDocument();
    expect(a.getByText("Did not finish: 1")).toBeInTheDocument();
    expect(a.queryByText(/^Read since/)).toBeNull();
    await waitFor(() => expect(h.count).toHaveBeenCalled());
  });

  it("starts with the read summary", () => {
    setup({ byBook: statuses([["b1", "u1", "read", today], ["b2", "u1", "read", "2020-01-01"]]) });
    const summary = screen.getByText("You've read 2 of 3 (67%)");
    const heading = screen.getByRole("heading", { name: "Reading history" });
    expect(heading.compareDocumentPosition(summary) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(summary.compareDocumentPosition(screen.getAllByRole("listitem", { name: /Member/ })[0]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("omits the read summary when nothing is owned", () => {
    setup({ books: [] });
    expect(screen.queryByText(/You've read/)).toBeNull();
  });

  it("shows the Since line once a date is chosen", () => {
    setup({ byBook: statuses([["b1", "u1", "read", "2026-06-01"], ["b2", "u1", "read", "2026-01-01"]]) });
    fireEvent.change(screen.getByLabelText("Since"), { target: { value: "2026-03-01" } });
    expect(screen.getAllByText("Read since 1 Mar 2026: 1").length).toBeGreaterThan(0);
  });

  it("does not count books the member has no status for as read", () => {
    setup({ byBook: statuses([["b1", "u2", "read", null]]) });
    const a = within(screen.getByRole("listitem", { name: "Member A" }));
    expect(a.getByText("Read of owned: 0 of 3, 0%")).toBeInTheDocument();
  });

  it("says No books yet when the member owns none", () => {
    setup({ books: [] });
    expect(screen.getAllByText("No books yet")).toHaveLength(2);
  });
});

describe("Reading history: upload", () => {
  it("summarises the file", async () => {
    setup();
    await choose(csvOf(1200, 3));
    expect(await screen.findByText("1200 books read or not finished. 3 to-read or currently reading will be skipped.")).toBeInTheDocument();
  });

  it("uploads three batches in order and sums the counts", async () => {
    setup();
    await choose(csvOf(1200, 3));
    await screen.findByRole("button", { name: "Upload" });
    let release: (c: UploadCounts) => void = () => {};
    h.upload.mockReset();
    h.upload
      .mockImplementationOnce(() => new Promise<UploadCounts>((r) => (release = r)))
      .mockResolvedValueOnce(counts({ matched: 2, applied: 2, possible: 0, unmatched: 3 }))
      .mockResolvedValueOnce(counts({ rows: 200, matched: 4, applied: 1, possible: 2, unmatched: 0 }));
    fireEvent.click(screen.getByRole("button", { name: "Upload" }));
    expect(await screen.findByText("Uploading 0 of 1200…")).toBeInTheDocument();
    release(counts());
    expect(await screen.findByText("7 matched books you own (4 newly marked)")).toBeInTheDocument();
    expect(h.upload).toHaveBeenCalledTimes(3);
    expect(h.upload.mock.calls.map((c) => (c[1] as unknown[]).length)).toEqual([500, 500, 200]);
    expect(h.upload.mock.calls.every((c) => c[0] === "h1")).toBe(true);
    expect(screen.getByText("3 possible matches to review")).toBeInTheDocument();
    expect(screen.getByText("4 kept for later, for books not on the shelf yet")).toBeInTheDocument();
    expect(screen.getByText("3 skipped (to-read or currently reading)")).toBeInTheDocument();
    await waitFor(() => expect(h.reload).toHaveBeenCalled());
    expect(h.list.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(h.count.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it("sends only the five fields", async () => {
    setup();
    await choose(csvOf(1));
    fireEvent.click(await screen.findByRole("button", { name: "Upload" }));
    await waitFor(() => expect(h.upload).toHaveBeenCalled());
    const row = (h.upload.mock.calls[0][1] as Record<string, unknown>[])[0];
    expect(Object.keys(row).sort()).toEqual(["authors", "isbnUid", "lastRead", "status", "title"]);
  });

  it("stops on a failed batch and says what finished", async () => {
    setup();
    await choose(csvOf(1200));
    await screen.findByRole("button", { name: "Upload" });
    h.upload.mockReset();
    h.upload.mockResolvedValueOnce(counts()).mockRejectedValueOnce(new Error("boom"));
    fireEvent.click(screen.getByRole("button", { name: "Upload" }));
    expect(
      await screen.findByText("Upload stopped after 500 of 1200. Try again; nothing is duplicated."),
    ).toBeInTheDocument();
    expect(h.upload).toHaveBeenCalledTimes(2);
  });

  it("uploads once on a double tap", async () => {
    setup();
    await choose(csvOf(2));
    const button = await screen.findByRole("button", { name: "Upload" });
    fireEvent.click(button);
    fireEvent.click(button);
    await screen.findByText(/matched books you own/);
    expect(h.upload).toHaveBeenCalledTimes(1);
  });

  it("offers no Upload when every row is skipped", async () => {
    setup();
    fireEvent.change(screen.getByLabelText("StoryGraph CSV file"), {
      target: { files: [new File([sgCsv([{ Title: "Unread", Authors: "A", "Read Status": "to-read" }])], "e.csv")] },
    });
    expect(await screen.findByText("0 books read or not finished. 1 to-read or currently reading will be skipped.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Upload" })).toBeNull();
  });

  it.each([
    ["not a StoryGraph export", new File(["Name,Other\nx,y\n"], "e.csv"), "This doesn't look like a StoryGraph export. Missing column: Title, Read Status."],
    ["not text", new File([new Uint8Array([0, 1, 2, 0])], "e.csv"), "That file isn't a CSV."],
  ])("shows the copy for %s", async (_n, file, text) => {
    setup();
    await choose(file);
    expect(await screen.findByRole("alert")).toHaveTextContent(text);
  });

  it("shows the empty copy for a header-only export", async () => {
    setup();
    await choose(new File([sgCsv([])], "e.csv"));
    expect(await screen.findByText("That export has no books in it.")).toBeInTheDocument();
  });
});

describe("Reading history: possible matches", () => {
  it("shows the StoryGraph title beside the book and links it", async () => {
    h.list.mockResolvedValue([match("x1", "b1")]);
    setup();
    expect(await screen.findByText("From StoryGraph: The Salt Road by Petra Wynnecombe")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /b1/ })).toHaveAttribute("href", "#/book/b1");
    fireEvent.click(screen.getByRole("button", { name: "Link" }));
    await waitFor(() => expect(h.link).toHaveBeenCalledWith("x1", "b1"));
    expect(await screen.findByText("No possible matches to review.")).toBeInTheDocument();
    await waitFor(() => expect(h.reload).toHaveBeenCalled());
  });

  it("Not this book dismisses and removes the row", async () => {
    h.list.mockResolvedValue([match("x1", "b1")]);
    setup();
    fireEvent.click(await screen.findByRole("button", { name: "Not this book" }));
    await waitFor(() => expect(h.dismiss).toHaveBeenCalledWith("x1", "b1"));
    expect(await screen.findByText("No possible matches to review.")).toBeInTheDocument();
    expect(h.reload).not.toHaveBeenCalled();
  });

  it("keeps the row and says so when the action fails", async () => {
    h.list.mockResolvedValue([match("x1", "b1")]);
    h.link.mockRejectedValue(new Error("nope"));
    setup();
    fireEvent.click(await screen.findByRole("button", { name: "Link" }));
    expect(await screen.findByText("Couldn't update that match.")).toBeInTheDocument();
    expect(screen.getByText(/From StoryGraph/)).toBeInTheDocument();
  });

  it("skips a candidate whose book isn't in the catalogue", async () => {
    h.list.mockResolvedValue([match("x1", "gone")]);
    setup();
    expect(await screen.findByText("No possible matches to review.")).toBeInTheDocument();
    expect(screen.queryByText(/From StoryGraph/)).toBeNull();
  });

  it("shows the unmatched footnote", async () => {
    h.count.mockResolvedValue(7);
    setup();
    expect(
      await screen.findByText("7 books from your history aren't on the shelf yet. They link by themselves when added."),
    ).toBeInTheDocument();
    expect(h.count).toHaveBeenCalledWith("h1");
  });
});

describe("Reading history: unavailable", () => {
  it("says it isn't available and loads nothing", () => {
    setup({ available: false });
    expect(screen.getByText("Reading history isn't available yet.")).toBeInTheDocument();
    expect(h.list).not.toHaveBeenCalled();
    expect(h.count).not.toHaveBeenCalled();
  });
});
