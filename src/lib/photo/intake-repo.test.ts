import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  queries: [] as { table: string; steps: [string, unknown[]][] }[],
  results: [] as { data: unknown; error: unknown }[],
  rpcCalls: [] as [string, unknown][],
  rpcResults: [] as { data: unknown; error: unknown }[],
  upload: vi.fn(),
  remove: vi.fn(),
  createSignedUrls: vi.fn(),
  invoke: vi.fn(),
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
      for (const method of ["select", "eq", "or", "order", "range", "insert", "update", "neq", "limit"]) {
        builder[method] = (...args: unknown[]) => {
          query.steps.push([method, args]);
          return builder;
        };
      }
      return builder;
    },
    rpc(name: string, args: unknown) {
      h.rpcCalls.push([name, args]);
      return Promise.resolve(h.rpcResults.shift() ?? { data: null, error: null });
    },
    storage: {
      from: () => ({ upload: h.upload, remove: h.remove, createSignedUrls: h.createSignedUrls }),
    },
    functions: { invoke: h.invoke },
  },
}));

import {
  confirmItem,
  coverPath,
  createIntakeItem,
  listIntakeItems,
  processItem,
  purgeIntakePhotos,
  signedPhotoUrls,
  sourceHashExists,
  titlePagePath,
  uploadPhoto,
} from "./intake-repo";
import { parseExtraction, toIntakeItem } from "./types";

const EXTRACTION = {
  isBook: true,
  title: "Sample Title",
  subtitle: null,
  authors: ["Wren Halloway"],
  editionClues: ["first printing"],
  publisher: null,
  isbn: null,
  confidence: "high",
};

beforeEach(() => {
  h.queries.length = 0;
  h.results.length = 0;
  h.rpcCalls.length = 0;
  h.rpcResults.length = 0;
  h.upload.mockReset();
  h.remove.mockReset();
  h.createSignedUrls.mockReset();
  h.invoke.mockReset();
});

describe("listIntakeItems", () => {
  it("selects explicit columns without claim_token and maps rows", async () => {
    h.results.push(
      {
        data: [
          {
            id: "i1",
            household_id: "h1",
            uploaded_by: null,
            batch_id: "b1",
            source_hash: "a".repeat(64),
            status: "ready",
            attempts: 1,
            extraction: EXTRACTION,
            created_at: "2026-01-01T00:00:00Z",
          },
        ],
        error: null,
      },
      { data: [], error: null },
    );
    const items = await listIntakeItems("h1");
    const select = h.queries[0].steps.find(([m]) => m === "select")![1][0] as string;
    expect(select).not.toBe("*");
    expect(select).not.toContain("claim_token");
    expect(select).toContain("extraction");
    expect(h.queries[0].table).toBe("intake_items");
    expect(items).toHaveLength(1);
    expect(items[0].uploadedBy).toBeNull();
    expect(items[0].householdId).toBe("h1");
    expect(items[0]).not.toHaveProperty("claimToken");
  });

  it("rejects on a query error", async () => {
    h.results.push({ data: null, error: new Error("boom") });
    await expect(listIntakeItems("h1")).rejects.toThrow("boom");
  });
});

describe("toIntakeItem / parseExtraction", () => {
  it("keeps a valid extraction", () => {
    expect(parseExtraction(EXTRACTION)).toEqual(EXTRACTION);
    const item = toIntakeItem({ id: "i", household_id: "h", batch_id: "b", extraction: EXTRACTION });
    expect(item.extraction?.title).toBe("Sample Title");
  });

  it("gives null for a malformed extraction", () => {
    const { title: _title, ...noTitle } = EXTRACTION;
    void _title;
    expect(parseExtraction(noTitle)).toBeNull();
    expect(parseExtraction({ ...EXTRACTION, authors: "Wren" })).toBeNull();
    expect(parseExtraction({ ...EXTRACTION, confidence: "certain" })).toBeNull();
    expect(parseExtraction(null)).toBeNull();
    expect(toIntakeItem({ id: "i", extraction: { ...EXTRACTION, authors: 3 } }).extraction).toBeNull();
  });
});

describe("paths", () => {
  it("builds household/item/file paths", () => {
    expect(coverPath("h", "i")).toBe("h/i/cover.jpg");
    expect(titlePagePath("h", "i")).toBe("h/i/title.jpg");
  });
});

describe("uploadPhoto", () => {
  const blob = new Blob(["x"]);

  it("uploads as jpeg without upsert", async () => {
    h.upload.mockResolvedValue({ data: {}, error: null });
    await uploadPhoto("h/i/cover.jpg", blob);
    expect(h.upload).toHaveBeenCalledWith("h/i/cover.jpg", blob, {
      contentType: "image/jpeg",
      upsert: false,
    });
  });

  it("resolves when the object already exists", async () => {
    h.upload.mockResolvedValueOnce({ data: null, error: { message: "The resource already exists" } });
    await expect(uploadPhoto("p", blob)).resolves.toBeUndefined();
    h.upload.mockResolvedValueOnce({ data: null, error: { message: "x", statusCode: "409" } });
    await expect(uploadPhoto("p", blob)).resolves.toBeUndefined();
  });

  it("rejects on any other error", async () => {
    h.upload.mockResolvedValue({ data: null, error: { message: "Payload too large", statusCode: "413" } });
    await expect(uploadPhoto("p", blob)).rejects.toMatchObject({ message: "Payload too large" });
  });
});

describe("createIntakeItem", () => {
  const row = {
    id: "i",
    householdId: "h",
    batchId: "b",
    ownerUserId: null,
    coverPath: "h/i/cover.jpg",
    titlePagePath: null,
    sourceHash: "a".repeat(64),
  };

  it("sends exactly the seven insertable columns and asks for no row back", async () => {
    h.results.push({ data: null, error: null });
    await expect(createIntakeItem(row)).resolves.toBe("created");
    const steps = h.queries[0].steps;
    const payload = steps.find(([m]) => m === "insert")![1][0] as Record<string, unknown>;
    expect(Object.keys(payload).sort()).toEqual(
      [
        "batch_id",
        "cover_path",
        "household_id",
        "id",
        "owner_user_id",
        "source_hash",
        "title_page_path",
      ].sort(),
    );
    expect(steps.map(([m]) => m)).toEqual(["insert"]);
  });

  it("returns duplicate on 23505 and rejects other errors", async () => {
    h.results.push({ data: null, error: { code: "23505" } });
    await expect(createIntakeItem(row)).resolves.toBe("duplicate");
    h.results.push({ data: null, error: { code: "42501" } });
    await expect(createIntakeItem(row)).rejects.toMatchObject({ code: "42501" });
  });
});

describe("sourceHashExists", () => {
  it("queries explicit id column, household, hash, not discarded, limit 1", async () => {
    h.results.push({ data: [{ id: "x" }], error: null });
    await expect(sourceHashExists("hh", "abc")).resolves.toBe(true);
    expect(h.queries[0].table).toBe("intake_items");
    expect(h.queries[0].steps).toEqual([
      ["select", ["id"]],
      ["eq", ["household_id", "hh"]],
      ["eq", ["source_hash", "abc"]],
      ["neq", ["status", "discarded"]],
      ["limit", [1]],
    ]);
  });

  it("is false for no rows and rejects on error", async () => {
    h.results.push({ data: [], error: null });
    await expect(sourceHashExists("hh", "abc")).resolves.toBe(false);
    h.results.push({ data: null, error: { code: "42501" } });
    await expect(sourceHashExists("hh", "abc")).rejects.toMatchObject({ code: "42501" });
  });
});

describe("processItem", () => {
  it("resolves the outcome from the body", async () => {
    for (const outcome of ["ready", "busy", "done", "retry_later", "failed", "daily_cap", "misconfigured"]) {
      h.invoke.mockResolvedValueOnce({ data: { outcome }, error: null });
      await expect(processItem("i")).resolves.toBe(outcome);
    }
    expect(h.invoke).toHaveBeenCalledWith("library-intake", { body: { itemId: "i" } });
  });

  it("rejects on an invoke error", async () => {
    h.invoke.mockResolvedValue({ data: null, error: new Error("net") });
    await expect(processItem("i")).rejects.toThrow("net");
  });
});

describe("confirmItem", () => {
  const copy = { ownerUserId: null, editionNote: " first printing ", location: null };

  it("sends p_book_id and a null p_book for an existing book", async () => {
    h.rpcResults.push({ data: [{ book_id: "b1", copy_id: "c1" }], error: null });
    const out = await confirmItem("i", { bookId: "b1" }, copy);
    const [name, args] = h.rpcCalls[0] as [string, Record<string, unknown>];
    expect(name).toBe("confirm_intake_item");
    expect(args).toMatchObject({ p_item: "i", p_book_id: "b1", p_book: null });
    expect(args.p_copy).toEqual({ owner_user_id: null, edition_note: "first printing", location: null });
    expect(out).toEqual({ bookId: "b1", copyId: "c1" });
  });

  it("sends snake_case book keys and a null p_book_id for a new book", async () => {
    h.rpcResults.push({ data: [{ book_id: "b2", copy_id: "c2" }], error: null });
    await confirmItem(
      "i",
      {
        book: {
          title: "Sample Title",
          authors: ["Wren Halloway"],
          synopsis: null,
          coverUrl: null,
          isbn13: ["9780000000002"],
          isbn10: [],
          pageCount: 12,
          publisher: null,
          publishDate: null,
        },
      },
      copy,
    );
    const args = h.rpcCalls[0][1] as Record<string, Record<string, unknown>>;
    expect(args.p_book_id).toBeNull();
    expect(args.p_book).toMatchObject({ title: "Sample Title", page_count: 12, isbn13: ["9780000000002"] });
    expect(args.p_book).not.toHaveProperty("pageCount");
  });

  it("rejects on rpc error", async () => {
    h.rpcResults.push({ data: null, error: new Error("nope") });
    await expect(confirmItem("i", { bookId: "b" }, copy)).rejects.toThrow("nope");
  });
});

describe("purgeIntakePhotos", () => {
  const paths = Array.from({ length: 250 }, (_, i) => `h/i${i}/cover.jpg`);

  it("removes in chunks of 100 then marks all paths", async () => {
    h.rpcResults.push({ data: paths.map((path) => ({ path })), error: null });
    h.remove.mockResolvedValue({ data: [], error: null });
    await expect(purgeIntakePhotos("h")).resolves.toBe(250);
    expect(h.remove).toHaveBeenCalledTimes(3);
    expect(h.rpcCalls[1]).toEqual(["mark_intake_purged", { p_household: "h", p_paths: paths }]);
  });

  it("rejects and marks nothing when remove fails", async () => {
    h.rpcResults.push({ data: paths.map((path) => ({ path })), error: null });
    h.remove.mockResolvedValue({ data: null, error: new Error("storage down") });
    await expect(purgeIntakePhotos("h")).rejects.toThrow("storage down");
    expect(h.rpcCalls.map(([n]) => n)).toEqual(["intake_purgeable"]);
  });

  it("does nothing when there is nothing purgeable", async () => {
    h.rpcResults.push({ data: [], error: null });
    await expect(purgeIntakePhotos("h")).resolves.toBe(0);
    expect(h.remove).not.toHaveBeenCalled();
  });
});

describe("signedPhotoUrls", () => {
  it("makes no request for no paths", async () => {
    const out = await signedPhotoUrls([]);
    expect(out.size).toBe(0);
    expect(h.createSignedUrls).not.toHaveBeenCalled();
  });

  it("signs in chunks of 100 for 3600 s and maps path to url", async () => {
    h.createSignedUrls.mockImplementation(async (batch: string[]) => ({
      data: batch.map((path) => ({ path, signedUrl: `https://signed.example/${path}`, error: null })),
      error: null,
    }));
    const paths = Array.from({ length: 150 }, (_, i) => `p${i}`);
    const out = await signedPhotoUrls(paths);
    expect(h.createSignedUrls).toHaveBeenCalledTimes(2);
    expect(h.createSignedUrls.mock.calls[0][1]).toBe(3600);
    expect(out.get("p149")).toBe("https://signed.example/p149");
  });
});
