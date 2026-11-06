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
      for (const method of ["select", "eq", "order", "range", "insert", "update", "upsert", "single"]) {
        builder[method] = (...args: unknown[]) => {
          query.steps.push([method, args]);
          return builder;
        };
      }
      return builder;
    },
  },
}));

import { addCopy, libibStore, listBooks, listLibibLedger } from "./library-repo";
import type { BookInput } from "./types";

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
    h.results.push({ data: bookRows(1000), error: null }, { data: bookRows(3, 1000), error: null });
    const books = await listBooks("h1");
    expect(books).toHaveLength(1003);
    expect(books[1002].id).toBe("b1002");
    expect(h.queries).toHaveLength(2);
    expect(stepArgs(0, "range")).toEqual([[0, 999]]);
    expect(stepArgs(1, "range")).toEqual([[1000, 1999]]);
  });

  it("orders by title then id, so pages can't overlap", async () => {
    h.results.push({ data: bookRows(3), error: null });
    await listBooks("h1");
    expect(stepArgs(0, "order")).toEqual([["title"], ["id"]]);
    expect(stepArgs(0, "eq")).toEqual([["household_id", "h1"]]);
    expect(stepArgs(0, "select")).toEqual([["*, copies(*)"]]);
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
    h.results.push({
      data: [
        { libib_id: "a", copies_seen: 2 },
        { libib_id: "b", copies_seen: 1 },
      ],
      error: null,
    });
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
    );
    const ledger = await listLibibLedger("h1");
    expect(ledger.size).toBe(1001);
    expect(stepArgs(0, "order")).toEqual([["libib_id"]]);
    expect(stepArgs(1, "range")).toEqual([[1000, 1999]]);
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
    await addCopy("b1", { ownerUserId: null, editionNote: null, location: null });
    const [[row]] = stepArgs(0, "insert") as [[Record<string, unknown>]];
    expect(row.origin).toBe("manual");
    expect(row).not.toHaveProperty("libib_id");
  });
});
