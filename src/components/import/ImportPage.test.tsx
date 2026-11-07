import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeStore, type FakeStore } from "@/lib/libib/fake-store";
import { libibCsv } from "@/lib/libib/fixtures";
import { REQUIRED_COLUMNS } from "@/lib/libib/parse";
import type { BookWithCopies } from "@/lib/types";

const h = vi.hoisted(() => ({
  store: null as unknown as FakeStore,
  failBooks: false,
  failLedger: false,
  listBooks: vi.fn(),
}));

vi.mock("@/lib/library-repo", () => {
  const store = () => h.store;
  h.listBooks.mockImplementation(async () => {
    if (h.failBooks) throw new Error("books unavailable");
    return store().listBooks();
  });
  return {
    listBooks: h.listBooks,
    listLibibLedger: async () => {
      if (h.failLedger) throw new Error("ledger unavailable");
      return store().ledger();
    },
    libibStore: {
      insertBooks: (...a: Parameters<FakeStore["insertBooks"]>) => store().insertBooks(...a),
      insertCopies: (...a: Parameters<FakeStore["insertCopies"]>) => store().insertCopies(...a),
      linkCopy: (...a: Parameters<FakeStore["linkCopy"]>) => store().linkCopy(...a),
      patchBook: (...a: Parameters<FakeStore["patchBook"]>) => store().patchBook(...a),
      upsertLedger: (...a: Parameters<FakeStore["upsertLedger"]>) => store().upsertLedger(...a),
    },
  };
});

const household = { id: "h1", name: "Home", inviteCode: "x", createdAt: "" };
const members = [
  { householdId: "h1", userId: "u1", displayName: "Tierra", createdAt: "" },
  { householdId: "h1", userId: "u2", displayName: "Sam", createdAt: "" },
];
vi.mock("@/contexts/HouseholdContext", () => ({
  useHousehold: () => ({ household, members, loading: false, error: null, refresh: vi.fn() }),
}));

import ImportPage from "./ImportPage";

const MINE = "Tierra's Books";
const OLD = "2026-01-01T00:00:00+00:00";

function isbn(n: number): string {
  const body = `978${String(n).padStart(9, "0")}`;
  const sum = [...body].reduce((acc, d, i) => acc + Number(d) * (i % 2 === 0 ? 1 : 3), 0);
  return `${body}${(10 - (sum % 10)) % 10}`;
}

function row(n: number, over: Partial<Record<string, string>> = {}) {
  return {
    id: `ROW${String(n).padStart(7, "0")}`,
    title: `Book ${n}`,
    ean_isbn13: isbn(n),
    collection: MINE,
    ...over,
  };
}

function upload(rows: Partial<Record<string, string>>[]) {
  const input = screen.getByLabelText("libib CSV file");
  const file = new File([libibCsv(rows)], "library.csv", { type: "application/octet-stream" });
  fireEvent.change(input, { target: { files: [file] } });
}

function uploadFile(file: File) {
  fireEvent.change(screen.getByLabelText("libib CSV file"), { target: { files: [file] } });
}

const SUMMARY_TWO = "2 new books, 0 extra copies, 0 unchanged, 0 to review";
const ALL_HERE = "Everything in this file is already in the library.";
const FAILED =
  "The import stopped partway. Everything saved so far is kept, and running it again adds only what's missing.";

function seededBook(over: Partial<BookWithCopies> & { id: string }): BookWithCopies {
  return {
    householdId: "h1",
    title: "Sample Title",
    authors: ["Wren Halloway"],
    synopsis: null,
    coverUrl: null,
    isbn13: [],
    isbn10: [],
    openlibraryId: null,
    googleBooksId: null,
    pageCount: null,
    publisher: null,
    publishDate: null,
    userEditedFields: [],
    createdAt: OLD,
    updatedAt: OLD,
    copies: [],
    ...over,
  };
}

const stages = () => h.store.calls.map((c) => c.stage);

beforeEach(() => {
  localStorage.clear();
  h.store = createFakeStore();
  h.failBooks = false;
  h.failLedger = false;
  h.listBooks.mockClear();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("ImportPage", () => {
  it("previews without writing, then writes on Confirm", async () => {
    render(<ImportPage />);
    upload([row(1), row(2)]);
    expect(await screen.findByText(SUMMARY_TWO)).toBeInTheDocument();
    expect(h.store.calls).toHaveLength(0);
    expect(screen.getByText("Book 1")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Import" }));
    expect(await screen.findByText("Import complete")).toBeInTheDocument();
    expect(stages()).toEqual(["books", "copies", "ledger"]);
    expect(screen.getByRole("link", { name: "Back to the library" })).toHaveAttribute("href", "#/");
  });

  it("reads the file by content, not MIME type, and singularises counts", async () => {
    render(<ImportPage />);
    expect(screen.getByLabelText("libib CSV file")).toHaveAttribute("accept", ".csv,text/csv");
    upload([row(1)]);
    expect(await screen.findByText("1 new book, 0 extra copies, 0 unchanged, 0 to review")).toBeInTheDocument();
  });

  it.each([
    [() => new File(["a,b\n1,2\n"], "x.csv"), `This doesn't look like a libib export. Missing column: ${REQUIRED_COLUMNS[0]}.`],
    [() => new File([new Uint8Array([0x50, 0x4b, 3, 4])], "x.csv"), "This isn't a CSV file. In libib, use Export, then upload the .csv it gives you."],
    [() => new File([libibCsv([])], "x.csv"), "This file has no books in it."],
    [
      () => new File([libibCsv([row(1)]) + 'BBBBBBBBBB,book,"Never closed,x\nmore\n'], "x.csv"),
      "This file looks damaged, so nothing was imported. Try exporting it from libib again.",
    ],
    [() => new File([new Uint8Array(10 * 1024 * 1024 + 1)], "x.csv"), "This file is too big to be a libib export (over 10 MB)."],
    [
      () => new File([libibCsv(Array.from({ length: 10_001 }, (_, i) => row(i)))], "x.csv"),
      "This file has more than 10,000 rows, which is too many to import at once.",
    ],
  ])("shows a file error and writes nothing (%#)", async (makeFile, text) => {
    render(<ImportPage />);
    uploadFile(makeFile());
    expect(await screen.findByText(text)).toBeInTheDocument();
    expect(h.store.calls).toHaveLength(0);
    expect(screen.queryByRole("button", { name: "Import" })).not.toBeInTheDocument();
  });

  it("RF1: a failed catalog read shows no plan and writes nothing", async () => {
    h.failBooks = true;
    render(<ImportPage />);
    upload([row(1)]);
    expect(await screen.findByText("Couldn't read the library, so nothing was imported.")).toBeInTheDocument();
    expect(screen.queryByText(/new book/)).not.toBeInTheDocument();
    expect(h.store.calls).toHaveLength(0);
  });

  it("RF1: a failed ledger read (migration not applied) is the same", async () => {
    h.failLedger = true;
    render(<ImportPage />);
    upload([row(1)]);
    expect(await screen.findByText("Couldn't read the library, so nothing was imported.")).toBeInTheDocument();
    expect(screen.queryByText(/new book/)).not.toBeInTheDocument();
    expect(h.store.calls).toHaveLength(0);
  });

  it("RF4: an unmatched collection blocks Confirm until chosen; Skip writes nothing", async () => {
    render(<ImportPage />);
    upload([row(1), row(2, { collection: "Partner Shelf" })]);
    await screen.findByText(/new book/);
    expect(screen.getByLabelText(`Owner for ${MINE}`)).toHaveValue("u1");
    expect(screen.getByText("Choose an owner for Partner Shelf.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Import" })).toBeDisabled();

    fireEvent.change(screen.getByLabelText("Owner for Partner Shelf"), { target: { value: "skip" } });
    expect(screen.queryByText("Choose an owner for Partner Shelf.")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Import" })).toBeEnabled();

    fireEvent.click(screen.getByRole("button", { name: "Import" }));
    await screen.findByText("Import complete");
    expect(h.store.listBooks().map((b) => b.title)).toEqual(["Book 1"]);
  });

  it("labels a blank collection", async () => {
    render(<ImportPage />);
    upload([row(1, { collection: "" })]);
    expect(await screen.findByText("Choose an owner for (no collection).")).toBeInTheDocument();
  });

  it("review: choosing Separate book changes the plan and is applied", async () => {
    h.store = createFakeStore({
      books: [
        seededBook({
          id: "b1",
          isbn13: [isbn(900)],
          copies: [
            {
              id: "c1", bookId: "b1", ownerUserId: "u1", editionNote: null, location: null,
              origin: "libib", libibId: "OLD0000001", photoPath: null, userEditedFields: [],
              createdAt: OLD, updatedAt: OLD,
            },
          ],
        }),
      ],
      ledger: [["OLD0000001", 1]],
    });
    render(<ImportPage />);
    upload([row(1, { title: "Sample Title" })]);
    expect(await screen.findByText("0 new books, 1 extra copy, 0 unchanged, 1 to review, 1 with details to fill")).toBeInTheDocument();
    const add = screen.getByRole("radio", { name: 'Another copy of "Sample Title"' });
    expect(add).toBeChecked();

    fireEvent.click(screen.getByRole("radio", { name: "Separate book" }));
    expect(await screen.findByText("1 new book, 0 extra copies, 0 unchanged, 1 to review")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Import" }));
    await screen.findByText("Import complete");
    expect(h.store.listBooks()).toHaveLength(2);
  });

  it("removed only: unticked rows show no action, ticking offers Import", async () => {
    h.store = createFakeStore({ ledger: [[row(1).id, 1]] });
    render(<ImportPage />);
    upload([row(1)]);
    const box = await screen.findByRole("checkbox", { name: /Book 1/ });
    expect(box).not.toBeChecked();
    expect(screen.getByText(/1 removed earlier/)).toBeInTheDocument();
    expect(screen.queryByText(ALL_HERE)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Import" })).not.toBeInTheDocument();

    fireEvent.click(box);
    expect(await screen.findByRole("button", { name: "Import" })).toBeInTheDocument();
    expect(screen.getByText(/^1 new book/)).toBeInTheDocument();

    fireEvent.click(box);
    await waitFor(() => expect(screen.queryByRole("button", { name: "Import" })).not.toBeInTheDocument());
  });

  it("re-upload of a finished import has nothing to do; skipping a collection says so differently", async () => {
    render(<ImportPage />);
    upload([row(1)]);
    fireEvent.click(await screen.findByRole("button", { name: "Import" }));
    await screen.findByText("Import complete");
    cleanup();

    render(<ImportPage />);
    upload([row(1)]);
    expect(await screen.findByText(ALL_HERE)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Import" })).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(`Owner for ${MINE}`), { target: { value: "skip" } });
    expect(await screen.findByText("Nothing to import from this file.")).toBeInTheDocument();
    expect(screen.queryByText(ALL_HERE)).not.toBeInTheDocument();
  });

  it("RF5: a lost ledger write is finished on retry, and a later delete stays removed", async () => {
    h.store.failAt("ledger", 0);
    render(<ImportPage />);
    upload([row(1)]);
    fireEvent.click(await screen.findByRole("button", { name: "Import" }));
    expect(await screen.findByText(FAILED)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Run it again" }));
    const finish = await screen.findByRole("button", { name: "Finish the earlier import" });
    expect(screen.getByText("These books are all here, but an earlier import didn't finish recording them.")).toBeInTheDocument();
    expect(screen.queryByText(ALL_HERE)).not.toBeInTheDocument();

    fireEvent.click(finish);
    await screen.findByText("Import complete");
    expect(h.store.ledger().get(row(1).id)).toBe(1);
    cleanup();

    h.store.deleteBook(h.store.listBooks()[0].id);
    const before = h.store.calls.length;
    render(<ImportPage />);
    upload([row(1)]);
    expect(await screen.findByText(/^0 new books.*1 removed earlier$/)).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: /Book 1/ })).toBeInTheDocument();
    expect(h.store.calls).toHaveLength(before);
  });

  it("returns to the preview with a notice when the library changed", async () => {
    render(<ImportPage />);
    upload([row(1), row(2)]);
    await screen.findByText(SUMMARY_TWO);
    await h.store.insertBooks([
      {
        id: "late",
        householdId: "h1",
        input: {
          title: "Book 2", authors: ["Wren Halloway"], synopsis: null, coverUrl: null,
          isbn13: [isbn(2)], isbn10: [], pageCount: null, publisher: null, publishDate: null,
        },
      },
    ]);
    const before = h.store.calls.length;

    fireEvent.click(screen.getByRole("button", { name: "Import" }));
    expect(
      await screen.findByText(
        "The library changed while you were reviewing. Check the updated summary, then confirm again.",
      ),
    ).toBeInTheDocument();
    expect(h.store.calls).toHaveLength(before);
    expect(screen.getByText("1 new book, 1 extra copy, 0 unchanged, 0 to review")).toBeInTheDocument();
  });

  it("RF3: a damaged ISBN shows the spreadsheet warning", async () => {
    render(<ImportPage />);
    upload([row(1, { ean_isbn13: "9.78E+12" })]);
    expect(
      await screen.findByText(
        "Some ISBNs look damaged, which usually means the file was opened in Excel. Export it from libib again and upload that file directly.",
      ),
    ).toBeInTheDocument();
  });

  it("failure: Run it again re-fetches and shows a refreshed preview", async () => {
    h.store.failAt("books", 0);
    render(<ImportPage />);
    upload([row(1), row(2)]);
    fireEvent.click(await screen.findByRole("button", { name: "Import" }));
    expect(await screen.findByText(FAILED)).toBeInTheDocument();
    const reads = h.listBooks.mock.calls.length;

    fireEvent.click(screen.getByRole("button", { name: "Run it again" }));
    expect(await screen.findByText(SUMMARY_TWO)).toBeInTheDocument();
    expect(h.listBooks.mock.calls.length).toBeGreaterThan(reads);
  });

  it("double-clicking Import applies once", async () => {
    render(<ImportPage />);
    upload([row(1), row(2)]);
    const button = await screen.findByRole("button", { name: "Import" });
    fireEvent.click(button);
    fireEvent.click(button);
    await screen.findByText("Import complete");
    expect(stages().filter((s) => s === "books")).toHaveLength(1);
  });
});
