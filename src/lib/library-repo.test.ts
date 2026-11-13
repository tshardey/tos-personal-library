import { beforeEach, describe, expect, it, vi } from "vitest";

// A query is one `from(...)` chain; awaiting it takes the next queued result.
const h = vi.hoisted(() => ({
  queries: [] as { table: string; steps: [string, unknown[]][] }[],
  results: [] as { data: unknown; error: unknown }[],
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from(table: string) {
      const query = { table, steps: [] as [string, unknown[]][] };
      h.queries.push(query);
      const builder: Record<string, unknown> = {
        then(resolve: (v: unknown) => void, reject: (e: unknown) => void) {
          const next = h.results.shift();
          if (next) resolve(next);
          else reject(new Error("no result queued"));
        },
      };
      for (const method of ["select", "eq", "order", "range", "insert", "update", "upsert", "delete", "single"]) {
        builder[method] = (...args: unknown[]) => {
          query.steps.push([method, args]);
          return builder;
        };
      }
      return builder;
    },
  },
}));

import {
  addBookTag,
  addCopy,
  createBook,
  libibStore,
  listBooks,
  listBookTags,
  listLibibLedger,
  removeBookTag,
  setCopyFlags,
  updateCopyFields,
} from "./library-repo";
import { fromBookPatch, toBook, type BookInput } from "./types";

const bookRows = (count: number, start = 0) =>
  Array.from({ length: count }, (_, i) => ({ id: `b${start + i}`, title: "T", copies: [] }));

const ledgerRows = (count: number) =>
  Array.from({ length: count }, (_, i) => ({ libib_id: `x${i}`, copies_seen: 1 }));

const stepArgs = (queryIndex: number, method: string) =>
  h.queries[queryIndex].steps.filter(([m]) => m === method).map(([, args]) => args);

const INPUT: BookInput = {
  title: "Sample Title",
  authors: ["Wren Halloway"],
  synopsis: null,
  coverUrl: null,
  isbn13: ["9780000000002"],
  isbn10: [],
  pageCount: 12,
  publisher: null,
  publishDate: null,
};

beforeEach(() => {
  h.queries.length = 0;
  h.results.length = 0;
});

describe("listBooks paging (RF1)", () => {
  it("reads past the 1000-row cap", async () => {
    h.results.push(
      { data: bookRows(1000), error: null },
      { data: bookRows(3, 1000), error: null },
      { data: [], error: null },
    );
    const books = await listBooks("h1");
    expect(books).toHaveLength(1003);
    expect(books[1002].id).toBe("b1002");
    expect(h.queries).toHaveLength(3);
    expect(stepArgs(0, "range")).toEqual([[0, 999]]);
    expect(stepArgs(1, "range")).toEqual([[1000, 1999]]);
    expect(stepArgs(2, "range")).toEqual([[1003, 2002]]);
  });

  it("a lower row cap (pages of 500) still returns every row", async () => {
    h.results.push(
      { data: bookRows(500), error: null },
      { data: bookRows(500, 500), error: null },
      { data: bookRows(20, 1000), error: null },
      { data: [], error: null },
    );
    const books = await listBooks("h1");
    expect(books).toHaveLength(1020);
    expect(stepArgs(1, "range")).toEqual([[500, 1499]]);
    expect(stepArgs(2, "range")).toEqual([[1000, 1999]]);
    expect(stepArgs(3, "range")).toEqual([[1020, 2019]]);
  });

  it("orders by title then id, so pages can't overlap", async () => {
    h.results.push({ data: bookRows(3), error: null }, { data: [], error: null });
    await listBooks("h1");
    expect(stepArgs(0, "order")).toEqual([["title"], ["id"]]);
    expect(stepArgs(0, "eq")).toEqual([["household_id", "h1"]]);
    expect(stepArgs(0, "select")).toEqual([["*, on_shelf, copies(*)"]]);
  });

  it("a full last page, then an empty page, terminates", async () => {
    h.results.push({ data: bookRows(1000), error: null }, { data: [], error: null });
    await expect(listBooks("h1")).resolves.toHaveLength(1000);
    expect(h.queries).toHaveLength(2);
  });

  it("an error on page 2 rejects rather than returning a partial list", async () => {
    const error = { message: "boom" };
    h.results.push({ data: bookRows(1000), error: null }, { data: null, error });
    await expect(listBooks("h1")).rejects.toBe(error);
  });
});

describe("listLibibLedger", () => {
  it("maps rows to a Map", async () => {
    h.results.push(
      {
        data: [
          { libib_id: "a", copies_seen: 2 },
          { libib_id: "b", copies_seen: 1 },
        ],
        error: null,
      },
      { data: [], error: null },
    );
    await expect(listLibibLedger("h1")).resolves.toEqual(
      new Map([
        ["a", 2],
        ["b", 1],
      ]),
    );
    expect(h.queries[0].table).toBe("libib_import_rows");
    expect(stepArgs(0, "eq")).toEqual([["household_id", "h1"]]);
  });

  it("pages, in a stable order", async () => {
    h.results.push(
      { data: ledgerRows(1000), error: null },
      { data: [{ libib_id: "y", copies_seen: 1 }], error: null },
      { data: [], error: null },
    );
    const ledger = await listLibibLedger("h1");
    expect(ledger.size).toBe(1001);
    expect(stepArgs(0, "order")).toEqual([["libib_id"]]);
    expect(stepArgs(1, "range")).toEqual([[1000, 1999]]);
    expect(stepArgs(2, "range")).toEqual([[1001, 2000]]);
  });

  it("a lower row cap (pages of 500) still returns every row", async () => {
    h.results.push(
      { data: ledgerRows(500), error: null },
      { data: ledgerRows(500).map((r) => ({ ...r, libib_id: `z${r.libib_id}` })), error: null },
      { data: [], error: null },
    );
    const ledger = await listLibibLedger("h1");
    expect(ledger.size).toBe(1000);
    expect(stepArgs(2, "range")).toEqual([[1000, 1999]]);
  });

  it("an error on page 2 rejects", async () => {
    const error = { message: "boom" };
    h.results.push({ data: ledgerRows(1000), error: null }, { data: null, error });
    await expect(listLibibLedger("h1")).rejects.toBe(error);
  });
});

describe("libibStore", () => {
  it("insertBooks adds id and household_id around the mapped input", async () => {
    h.results.push({ data: null, error: null });
    await libibStore.insertBooks([{ id: "b1", householdId: "h1", input: INPUT }]);
    expect(h.queries[0].table).toBe("books");
    expect(stepArgs(0, "insert")).toEqual([
      [
        [
          {
            id: "b1",
            household_id: "h1",
            title: "Sample Title",
            authors: ["Wren Halloway"],
            synopsis: null,
            cover_url: null,
            isbn13: ["9780000000002"],
            isbn10: [],
            page_count: 12,
            publisher: null,
            publish_date: null,
          },
        ],
      ],
    ]);
  });

  it("insertCopies sends origin libib and libib_id", async () => {
    h.results.push({ data: null, error: null });
    await libibStore.insertCopies([
      { bookId: "b1", ownerUserId: null, editionNote: "Deluxe Edition", libibId: "L1" },
    ]);
    expect(h.queries[0].table).toBe("copies");
    expect(stepArgs(0, "insert")).toEqual([
      [
        [
          {
            book_id: "b1",
            owner_user_id: null,
            edition_note: "Deluxe Edition",
            libib_id: "L1",
            origin: "libib",
          },
        ],
      ],
    ]);
  });

  it("linkCopy updates libib_id only", async () => {
    h.results.push({ data: null, error: null });
    await libibStore.linkCopy("c1", "L1");
    expect(h.queries[0].table).toBe("copies");
    expect(stepArgs(0, "update")).toEqual([[{ libib_id: "L1" }]]);
    expect(stepArgs(0, "eq")).toEqual([["id", "c1"]]);
  });

  it("patchBook compares updated_at, sends no user_edited_fields, and returns true on a hit", async () => {
    h.results.push({ data: [{ id: "b1" }], error: null });
    await expect(libibStore.patchBook("b1", "stamp", { pageCount: 12 })).resolves.toBe(true);
    expect(stepArgs(0, "update")).toEqual([[{ page_count: 12 }]]);
    expect(JSON.stringify(h.queries[0].steps)).not.toContain("user_edited_fields");
    expect(stepArgs(0, "eq")).toEqual([
      ["id", "b1"],
      ["updated_at", "stamp"],
    ]);
    expect(stepArgs(0, "select")).toEqual([["id"]]);
  });

  it("patchBook returns false on an empty result", async () => {
    h.results.push({ data: [], error: null });
    await expect(libibStore.patchBook("b1", "stamp", { pageCount: 12 })).resolves.toBe(false);
  });

  it("upsertLedger conflicts on household_id,libib_id", async () => {
    h.results.push({ data: null, error: null });
    await libibStore.upsertLedger("h1", [{ libibId: "L1", copiesSeen: 2 }]);
    expect(h.queries[0].table).toBe("libib_import_rows");
    expect(stepArgs(0, "upsert")).toEqual([
      [[{ household_id: "h1", libib_id: "L1", copies_seen: 2 }], { onConflict: "household_id,libib_id" }],
    ]);
  });

  it("every write rejects on an error", async () => {
    const error = { message: "boom" };
    const writes = [
      () => libibStore.insertBooks([{ id: "b1", householdId: "h1", input: INPUT }]),
      () => libibStore.insertCopies([{ bookId: "b1", ownerUserId: null, editionNote: null, libibId: "L1" }]),
      () => libibStore.linkCopy("c1", "L1"),
      () => libibStore.patchBook("b1", "stamp", { pageCount: 12 }),
      () => libibStore.upsertLedger("h1", [{ libibId: "L1", copiesSeen: 1 }]),
    ];
    for (const write of writes) {
      h.results.push({ data: null, error });
      await expect(write()).rejects.toBe(error);
    }
  });
});

describe("addCopy", () => {
  it("stays origin manual", async () => {
    h.results.push({ data: { id: "c1", book_id: "b1", origin: "manual" }, error: null });
    await addCopy("b1", { ownerUserId: null, editionNote: null, copyNote: null, location: null });
    const [[row]] = stepArgs(0, "insert") as [[Record<string, unknown>]];
    expect(row.origin).toBe("manual");
    expect(row).not.toHaveProperty("libib_id");
  });
});

describe("series columns", () => {
  it("toBook maps series_name and series_volume, absent gives null", () => {
    expect(toBook({ id: "b", series_name: "Saga", series_volume: 2.5 })).toMatchObject({
      seriesName: "Saga",
      seriesVolume: 2.5,
    });
    expect(toBook({ id: "b" })).toMatchObject({ seriesName: null, seriesVolume: null });
  });
  it("fromBookPatch maps seriesName and skips undefined", () => {
    expect(fromBookPatch({ seriesName: "Saga" })).toEqual({ series_name: "Saga" });
    expect(fromBookPatch({ seriesVolume: 3, seriesName: null })).toEqual({ series_volume: 3, series_name: null });
  });
  it("createBook and libib insertBooks send no series keys (safe before the db push)", async () => {
    h.results.push({ data: { id: "b1" }, error: null }, { data: { id: "c1" }, error: null });
    await createBook("h1", INPUT, { ownerUserId: null, editionNote: null, copyNote: null, location: null });
    const [[created]] = stepArgs(0, "insert") as [[Record<string, unknown>]];
    expect(created).not.toHaveProperty("series_name");
    expect(created).not.toHaveProperty("series_volume");

    h.results.push({ data: null, error: null });
    await libibStore.insertBooks([{ id: "b2", householdId: "h1", input: INPUT }]);
    const [[row]] = stepArgs(2, "insert") as [[Record<string, unknown>[]]];
    expect(row[0]).not.toHaveProperty("series_name");
    expect(row[0]).not.toHaveProperty("series_volume");
  });
});

describe("book tags", () => {
  it("listBookTags groups by book, filters by household and orders by book_id then tag_id", async () => {
    h.results.push({
      data: [
        { book_id: "b1", tag_id: "a" },
        { book_id: "b1", tag_id: "b" },
        { book_id: "b2", tag_id: "a" },
      ],
      error: null,
    });
    h.results.push({ data: [], error: null });
    const tags = await listBookTags("h1");
    expect(tags).toEqual(
      new Map([
        ["b1", ["a", "b"]],
        ["b2", ["a"]],
      ]),
    );
    expect(h.queries[0].table).toBe("book_tags");
    expect(stepArgs(0, "select")).toEqual([["book_id, tag_id"]]);
    expect(stepArgs(0, "eq")).toEqual([["household_id", "h1"]]);
    expect(stepArgs(0, "order")).toEqual([["book_id"], ["tag_id"]]);
  });
  it("listBookTags rejects when a later page errors", async () => {
    const error = new Error("page 2");
    h.results.push({ data: [{ book_id: "b1", tag_id: "a" }], error: null });
    h.results.push({ data: null, error });
    await expect(listBookTags("h1")).rejects.toBe(error);
  });
  it("addBookTag upserts ignoring duplicates", async () => {
    h.results.push({ data: null, error: null });
    await addBookTag("b1", "h1", "fantasy");
    expect(h.queries[0].table).toBe("book_tags");
    expect(stepArgs(0, "upsert")).toEqual([
      [{ book_id: "b1", household_id: "h1", tag_id: "fantasy" }, { onConflict: "book_id,tag_id", ignoreDuplicates: true }],
    ]);
  });
  it("removeBookTag deletes by book and tag, and surfaces errors", async () => {
    h.results.push({ data: null, error: null });
    await removeBookTag("b1", "fantasy");
    expect(stepArgs(0, "eq")).toEqual([["book_id", "b1"], ["tag_id", "fantasy"]]);
    const error = new Error("nope");
    h.results.push({ data: null, error });
    await expect(removeBookTag("b1", "fantasy")).rejects.toBe(error);
  });
});

describe("copy flags", () => {
  it("listBooks maps on_shelf and the copy flag columns", async () => {
    h.results.push(
      {
        data: [
          { id: "b1", title: "A", on_shelf: false, copies: [{ id: "c1", unhauled_at: "2026-05-01T00:00:00Z", deluxe: true }] },
          { id: "b2", title: "B", copies: [{ id: "c2" }] },
        ],
        error: null,
      },
      { data: [], error: null },
    );
    const [one, two] = await listBooks("h1");
    expect(one.onShelf).toBe(false);
    expect(one.copies[0]).toMatchObject({ unhauledAt: "2026-05-01T00:00:00Z", deluxe: true, signed: false });
    expect(two.onShelf).toBe(true);
    expect(two.copies[0]).toMatchObject({ unhauledAt: null, deluxe: false, signed: false });
  });

  const COPY = {
    id: "c1",
    userEditedFields: ["location", "copyNote"],
  } as Parameters<typeof setCopyFlags>[0];

  it("setCopyFlags sends only the patched column and the sorted edited keys", async () => {
    h.results.push({ data: null, error: null });
    await setCopyFlags(COPY, { deluxe: true });
    expect(h.queries[0].table).toBe("copies");
    expect(stepArgs(0, "update")).toEqual([
      [{ deluxe: true, user_edited_fields: ["copyNote", "deluxe", "location"] }],
    ]);
    expect(stepArgs(0, "eq")).toEqual([["id", "c1"]]);
  });

  it("setCopyFlags writes a null unhauled_at and marks unhauledAt", async () => {
    h.results.push({ data: null, error: null });
    await setCopyFlags(COPY, { unhauledAt: null });
    expect(stepArgs(0, "update")).toEqual([
      [{ unhauled_at: null, user_edited_fields: ["copyNote", "location", "unhauledAt"] }],
    ]);
  });

  it("setCopyFlags rejects on a write error", async () => {
    const error = { message: "boom" };
    h.results.push({ data: null, error });
    await expect(setCopyFlags(COPY, { signed: true })).rejects.toBe(error);
  });
});

describe("updateCopyFields (mass edit)", () => {
  it("writes copy fields and flags in one update with the given edited fields", async () => {
    h.results.push({ data: [{ id: "c1" }], error: null });
    await updateCopyFields(
      "c1",
      { editionNote: "Lantern Box", ownerUserId: null, deluxe: true, unhauledAt: null },
      ["deluxe", "editionNote", "ownerUserId", "unhauledAt"],
    );
    expect(h.queries).toHaveLength(1);
    expect(h.queries[0].table).toBe("copies");
    expect(stepArgs(0, "update")).toEqual([
      [
        {
          edition_note: "Lantern Box",
          owner_user_id: null,
          deluxe: true,
          unhauled_at: null,
          user_edited_fields: ["deluxe", "editionNote", "ownerUserId", "unhauledAt"],
        },
      ],
    ]);
    expect(stepArgs(0, "eq")).toEqual([["id", "c1"]]);
  });

  it("leaves out keys not in the patch", async () => {
    h.results.push({ data: [{ id: "c1" }], error: null });
    await updateCopyFields("c1", { signed: false }, ["signed"]);
    expect(stepArgs(0, "update")).toEqual([[{ signed: false, user_edited_fields: ["signed"] }]]);
  });

  it("rejects on a write error, and when no row was updated", async () => {
    const error = { message: "boom" };
    h.results.push({ data: null, error });
    await expect(updateCopyFields("c1", { deluxe: true }, ["deluxe"])).rejects.toBe(error);
    h.results.push({ data: [], error: null });
    await expect(updateCopyFields("c1", { deluxe: true }, ["deluxe"])).rejects.toThrow("copy_not_found");
  });
});
