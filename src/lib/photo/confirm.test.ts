import { describe, expect, it, vi } from "vitest";
import type { BookWithCopies, Copy } from "../types";
import { isbn10To13 } from "../libib/isbn";
import type { Extraction, IntakeItem, LookupResult } from "./types";
import { lookupAsBookInput, performConfirm, runBulkConfirm, type ConfirmDeps } from "./confirm";

const A = "member-a";
let seq = 0;

const extraction = (over: Partial<Extraction> = {}): Extraction => ({
  isBook: true,
  title: "Salt Road",
  subtitle: null,
  authors: ["Ana Vale"],
  editionClues: [],
  publisher: null,
  isbn: null,
  confidence: "high",
  ...over,
});
const item = (over: Partial<IntakeItem> = {}, ex: Partial<Extraction> = {}): IntakeItem => ({
  id: `item-${++seq}`,
  householdId: "h1",
  uploadedBy: A,
  batchId: "batch-1",
  ownerUserId: A,
  coverPath: "h1/x/cover.jpg",
  titlePagePath: null,
  sourceHash: `hash-${seq}`,
  source: "photo",
  scannedIsbn: null,
  editionLabel: null,
  extraCopy: false,
  discardReason: null,
  status: "ready",
  attempts: 1,
  claimedAt: null,
  retryAt: null,
  extraction: extraction(ex),
  lookup: null,
  errorCode: null,
  resultBookId: null,
  createdAt: "2026-01-01T00:00:00Z",
  ...over,
});
const copy = (over: Partial<Copy> = {}): Copy => ({
  id: `copy-${++seq}`,
  bookId: "b",
  ownerUserId: A,
  editionNote: null,
  copyNote: null,
  location: null,
  origin: "manual",
  libibId: null,
  photoPath: null,
  intakeItemId: null,
  userEditedFields: [],
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
  ...over,
});
const book = (id: string, title: string, over: Partial<BookWithCopies> = {}): BookWithCopies => ({
  id,
  householdId: "h1",
  title,
  authors: ["Ana Vale"],
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
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-02-02T00:00:00Z",
  copies: [copy({ bookId: id, ownerUserId: "member-b" })],
  ...over,
});
const lookup = (over: Partial<LookupResult> = {}): LookupResult => ({
  source: "openlibrary",
  agrees: true,
  title: "Salt Road",
  authors: ["Ana Vale"],
  matchIsbns: [isbn10To13("123456789X")],
  coverUrl: "https://covers.example.test/1.jpg",
  synopsis: "A synthetic synopsis.",
  pageCount: 321,
  publishDate: "1999",
  openlibraryId: "OL1W",
  googleBooksId: null,
  ...over,
});

const COPY = { ownerUserId: A, editionNote: null, copyNote: null, location: null };

function deps(over: Partial<ConfirmDeps> = {}): ConfirmDeps {
  return {
    confirm: vi.fn(async () => ({ bookId: "book-new", copyId: "copy-new" })),
    discard: vi.fn(async () => true),
    patchBook: vi.fn(async () => true),
    enrich: vi.fn(async () => undefined),
    catalog: [],
    purge: vi.fn(async () => 0),
    ...over,
  };
}

describe("lookupAsBookInput", () => {
  it("takes nothing from a lookup that doesn't agree", () => {
    const input = lookupAsBookInput("Salt Road", ["Ana Vale"], item({ lookup: lookup({ agrees: false }) }));
    expect(input).toEqual({
      title: "Salt Road",
      authors: ["Ana Vale"],
      synopsis: null,
      coverUrl: null,
      isbn13: [],
      isbn10: [],
      pageCount: null,
      publisher: null,
      publishDate: null,
      openlibraryId: null,
      googleBooksId: null,
    });
  });

  it("takes cover, synopsis and page count from an agreeing lookup, but never its matchIsbns", () => {
    const input = lookupAsBookInput("Salt Road", ["Ana Vale"], item({ lookup: lookup() }));
    expect(input.coverUrl).toBe("https://covers.example.test/1.jpg");
    expect(input.synopsis).toBe("A synthetic synopsis.");
    expect(input.pageCount).toBe(321);
    expect(input.publishDate).toBe("1999");
    expect(input.openlibraryId).toBe("OL1W");
    expect(input.googleBooksId).toBeNull();
    expect(input.isbn13).toEqual([]);
    expect(input.isbn10).toEqual([]);
  });

  it("keeps a valid photo ISBN-10 and derives its ISBN-13; publisher comes from the extraction", () => {
    const input = lookupAsBookInput(
      "Edited",
      ["Someone Else"],
      item({}, { isbn: "1-23456789-X", publisher: "Synthetic Press" }),
    );
    expect(input.title).toBe("Edited");
    expect(input.authors).toEqual(["Someone Else"]);
    expect(input.isbn10).toEqual(["123456789X"]);
    expect(input.isbn13).toEqual([isbn10To13("123456789X")]);
    expect(input.publisher).toBe("Synthetic Press");
  });

  it("a scan stores its scanned ISBN-13 and the byIsbn lookup's cover", () => {
    const scan = item({
      source: "scan",
      coverPath: null,
      sourceHash: null,
      scannedIsbn: "9780000000002",
      extraction: null,
      lookup: lookup({ byIsbn: true, matchIsbns: ["9780000000002", "9780000000019"] }),
    });
    const input = lookupAsBookInput("Salt Road", ["Ana Vale"], scan);
    expect(input.isbn13).toEqual(["9780000000002"]);
    expect(input.isbn10).toEqual([]);
    expect(input.coverUrl).toBe("https://covers.example.test/1.jpg");
    expect(input.publisher).toBeNull();
  });

  it("a photo with both a scanned and an extracted ISBN stores only the scanned one", () => {
    const photo = item({ scannedIsbn: "9780000000002" }, { isbn: "9780000000019" });
    const input = lookupAsBookInput("Salt Road", ["Ana Vale"], photo);
    expect(input.isbn13).toEqual(["9780000000002"]);
    expect(input.isbn10).toEqual([]);
  });

  it("drops a photo ISBN that fails its checksum", () => {
    const input = lookupAsBookInput("Salt Road", [], item({}, { isbn: "1234567890" }));
    expect(input.isbn10).toEqual([]);
    expect(input.isbn13).toEqual([]);
  });
});

describe("performConfirm", () => {
  it("add_copy confirms by bookId, then patches only empty fields", async () => {
    const existing = book("b1", "Salt Road", { synopsis: "Ours already." });
    const d = deps({ catalog: [existing], confirm: vi.fn(async () => ({ bookId: "b1", copyId: "c1" })) });
    const it1 = item({ lookup: lookup() });
    const result = await performConfirm(
      it1,
      { kind: "add_copy", bookId: "b1" },
      { title: "Salt Road", authors: ["Ana Vale"], copy: COPY },
      d,
    );
    expect(result).toEqual({ bookId: "b1" });
    expect(d.confirm).toHaveBeenCalledWith(it1.id, { bookId: "b1" }, COPY);
    expect(d.patchBook).toHaveBeenCalledTimes(1);
    const [id, updatedAt, patch] = vi.mocked(d.patchBook).mock.calls[0];
    expect(id).toBe("b1");
    expect(updatedAt).toBe("2026-02-02T00:00:00Z");
    expect(patch).not.toHaveProperty("synopsis");
    expect(patch).toMatchObject({ coverUrl: "https://covers.example.test/1.jpg", pageCount: 321 });
    expect(d.discard).not.toHaveBeenCalled();
  });

  it("respects userEditedFields: an edited cover is never filled", async () => {
    const existing = book("b1", "Salt Road", { userEditedFields: ["coverUrl"] });
    const d = deps({ catalog: [existing], confirm: vi.fn(async () => ({ bookId: "b1", copyId: "c1" })) });
    await performConfirm(
      item({ lookup: lookup() }),
      { kind: "add_copy", bookId: "b1" },
      { title: "Salt Road", authors: ["Ana Vale"], copy: COPY },
      d,
    );
    const patch = vi.mocked(d.patchBook).mock.calls[0][2];
    expect(patch).not.toHaveProperty("coverUrl");
    expect(patch).toHaveProperty("synopsis");
  });

  it("skips patchBook when the patch is empty", async () => {
    const existing = book("b1", "Salt Road");
    const d = deps({ catalog: [existing], confirm: vi.fn(async () => ({ bookId: "b1", copyId: "c1" })) });
    await performConfirm(
      item({ lookup: null }),
      { kind: "add_copy", bookId: "b1" },
      { title: "Salt Road", authors: ["Ana Vale"], copy: COPY },
      d,
    );
    expect(d.patchBook).not.toHaveBeenCalled();
  });

  it("already_recorded only discards, with the already_recorded reason", async () => {
    const d = deps({ catalog: [book("b1", "Salt Road")] });
    const it1 = item();
    const result = await performConfirm(
      it1,
      { kind: "already_recorded", bookId: "b1" },
      { title: "Salt Road", authors: ["Ana Vale"], copy: COPY },
      d,
    );
    expect(result).toEqual({ bookId: null });
    expect(d.discard).toHaveBeenCalledWith(it1.id, "already_recorded");
    expect(d.confirm).not.toHaveBeenCalled();
    expect(d.patchBook).not.toHaveBeenCalled();
    expect(d.enrich).not.toHaveBeenCalled();
    expect(d.purge).toHaveBeenCalled();
  });

  it("discard only discards, with the discarded reason, then purges", async () => {
    const d = deps({ catalog: [book("b1", "Salt Road")] });
    const it1 = item();
    const result = await performConfirm(
      it1,
      { kind: "discard" },
      { title: "Salt Road", authors: ["Ana Vale"], copy: COPY },
      d,
    );
    expect(result).toEqual({ bookId: null });
    expect(d.discard).toHaveBeenCalledTimes(1);
    expect(d.discard).toHaveBeenCalledWith(it1.id, "discarded");
    expect(d.confirm).not.toHaveBeenCalled();
    expect(d.patchBook).not.toHaveBeenCalled();
    expect(d.purge).toHaveBeenCalled();
  });

  it("new_book confirms with the book input and enriches when it has an ISBN", async () => {
    const d = deps();
    const it1 = item({}, { isbn: "123456789X" });
    const result = await performConfirm(
      it1,
      { kind: "new_book" },
      { title: "Salt Road", authors: ["Ana Vale"], copy: COPY },
      d,
    );
    expect(result).toEqual({ bookId: "book-new" });
    expect(d.confirm).toHaveBeenCalledWith(
      it1.id,
      { book: expect.objectContaining({ title: "Salt Road", isbn10: ["123456789X"] }) },
      COPY,
    );
    await vi.waitFor(() => expect(d.enrich).toHaveBeenCalledTimes(1));
    expect(vi.mocked(d.enrich).mock.calls[0][0][0].id).toBe("book-new");
  });

  it("new_book without an ISBN doesn't enrich", async () => {
    const d = deps();
    await performConfirm(item(), { kind: "new_book" }, { title: "Salt Road", authors: [], copy: COPY }, d);
    await Promise.resolve();
    expect(d.enrich).not.toHaveBeenCalled();
  });

  it("still resolves when patchBook, enrich or purge reject", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const existing = book("b1", "Salt Road", { isbn13: [isbn10To13("123456789X")] });
    const d = deps({
      catalog: [existing],
      confirm: vi.fn(async () => ({ bookId: "b1", copyId: "c1" })),
      patchBook: vi.fn(async () => {
        throw new Error("nope");
      }),
      enrich: vi.fn(async () => {
        throw new Error("nope");
      }),
      purge: vi.fn(async () => {
        throw new Error("nope");
      }),
    });
    await expect(
      performConfirm(
        item({ lookup: lookup() }),
        { kind: "add_copy", bookId: "b1" },
        { title: "Salt Road", authors: ["Ana Vale"], copy: COPY },
        d,
      ),
    ).resolves.toEqual({ bookId: "b1" });
    await vi.waitFor(() => expect(d.enrich).toHaveBeenCalled());
    spy.mockRestore();
  });

  it("a confirm rejection rejects", async () => {
    const d = deps({
      confirm: vi.fn(async () => {
        throw new Error("network");
      }),
    });
    await expect(
      performConfirm(item(), { kind: "new_book" }, { title: "Salt Road", authors: [], copy: COPY }, d),
    ).rejects.toThrow("network");
  });
});

describe("runBulkConfirm", () => {
  it("confirms neither of two in-batch twins", async () => {
    const a = item({}, { title: "Glass Orchard" });
    const b = item({}, { title: "Glass Orchard" });
    const perform = vi.fn(async () => ({ bookId: "x" }));
    const r = await runBulkConfirm([a.id, b.id], () => ({ catalog: [], openItems: [a, b] }), {
      perform,
      refresh: async () => {},
    });
    expect(r).toEqual({ confirmed: 0, skipped: 2 });
    expect(perform).not.toHaveBeenCalled();
  });

  it("recomputes before each write and skips one that gained a candidate", async () => {
    const c = item({}, { title: "Copper Lantern", authors: ["Ida Moss"] });
    const d = item({}, { title: "Silent Harbor", authors: ["Ana Vale"] });
    let catalog: BookWithCopies[] = [];
    let openItems = [c, d];
    const perform = vi.fn(async (it: IntakeItem) => {
      // Confirming C lands a book in the catalog that D now matches by title.
      catalog = [...catalog, book("b-new", "Silent Harbor")];
      openItems = openItems.map((o) => (o.id === it.id ? { ...o, status: "confirmed" as const } : o));
      return { bookId: "b-new" };
    });
    const refresh = vi.fn(async () => {});
    const r = await runBulkConfirm([c.id, d.id], () => ({ catalog, openItems }), { perform, refresh });
    expect(r).toEqual({ confirmed: 1, skipped: 1 });
    expect(perform).toHaveBeenCalledTimes(1);
    expect(vi.mocked(perform).mock.calls[0][0].id).toBe(c.id);
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it("only ever performs new_book, with the extracted title, authors and the item's edition label", async () => {
    const items = [
      item({ editionLabel: "Invented hardcover" }, { title: "Copper Lantern", editionClues: ["first edition"] }),
      item({}, { title: "Silent Harbor", editionClues: ["Invented foil"] }),
      item({}, { title: "Northern Kettle" }),
    ];
    const perform = vi.fn(async () => ({ bookId: "x" }));
    const r = await runBulkConfirm(
      items.map((i) => i.id),
      () => ({ catalog: [], openItems: items }),
      { perform, refresh: async () => {} },
    );
    expect(r).toEqual({ confirmed: 3, skipped: 0 });
    for (const call of perform.mock.calls as unknown as [IntakeItem, { kind: string }][]) {
      expect(call[1]).toEqual({ kind: "new_book" });
    }
    expect(perform.mock.calls[0]).toEqual([
      items[0],
      { kind: "new_book" },
      {
        title: "Copper Lantern",
        authors: ["Ana Vale"],
        copy: { ownerUserId: A, editionNote: "Invented hardcover", copyNote: null, location: null },
      },
    ]);
    // Claude's clues are only a hint: nothing prefills the edition from them (D12).
    expect((perform.mock.calls[1] as unknown[])[2]).toEqual({
      title: "Silent Harbor",
      authors: ["Ana Vale"],
      copy: { ownerUserId: A, editionNote: null, copyNote: null, location: null },
    });
  });

  it("bulk-confirms a found scan as new_book with the lookup's title and authors", async () => {
    const scan = item({
      source: "scan",
      coverPath: null,
      sourceHash: null,
      scannedIsbn: "9780000000002",
      editionLabel: "Invented foil",
      extraction: null,
      lookup: lookup({ byIsbn: true, title: "Salt Road", authors: ["A. Writer"] }),
    });
    const notFound = item({
      source: "scan",
      coverPath: null,
      sourceHash: null,
      scannedIsbn: "9780000000019",
      extraction: null,
      lookup: lookup({ source: "none", agrees: false, title: null, authors: [], matchIsbns: [] }),
    });
    const perform = vi.fn(async () => ({ bookId: "x" }));
    const r = await runBulkConfirm([scan.id, notFound.id], () => ({ catalog: [], openItems: [scan, notFound] }), {
      perform,
      refresh: async () => {},
    });
    expect(r).toEqual({ confirmed: 1, skipped: 1 });
    expect(perform.mock.calls).toEqual([
      [
        scan,
        { kind: "new_book" },
        {
          title: "Salt Road",
          authors: ["A. Writer"],
          copy: { ownerUserId: A, editionNote: "Invented foil", copyNote: null, location: null },
        },
      ],
    ]);
  });

  it("rejects before writing anything when a refresh fails", async () => {
    const items = [item({}, { title: "Copper Lantern" }), item({}, { title: "Silent Harbor" })];
    const perform = vi.fn(async () => ({ bookId: "x" }));
    const refresh = vi.fn(async () => {
      throw new Error("offline");
    });
    await expect(
      runBulkConfirm(items.map((i) => i.id), () => ({ catalog: [], openItems: items }), { perform, refresh }),
    ).rejects.toThrow("offline");
    expect(perform).not.toHaveBeenCalled();
  });
});
