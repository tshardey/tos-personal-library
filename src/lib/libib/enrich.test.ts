import { describe, expect, it, vi } from "vitest";
import type { BookWithCopies } from "../types";
import { enrichMissing } from "./enrich";
import type { ImportStore } from "./apply";

function isbn(n: number): string {
  const body = `978${String(n).padStart(9, "0")}`;
  const sum = [...body].reduce((acc, d, i) => acc + Number(d) * (i % 2 === 0 ? 1 : 3), 0);
  return `${body}${(10 - (sum % 10)) % 10}`;
}

const book = (n: number, over: Partial<BookWithCopies> = {}): BookWithCopies => ({
  id: `b${n}`,
  householdId: "h1",
  title: `Book ${n}`,
  authors: ["Wren Halloway"],
  synopsis: null,
  coverUrl: null,
  isbn13: [isbn(n)],
  isbn10: [],
  openlibraryId: null,
  googleBooksId: null,
  pageCount: null,
  publisher: null,
  publishDate: null,
  userEditedFields: [],
  createdAt: "",
  updatedAt: `u${n}`,
  copies: [],
  ...over,
});

const reply = (body: unknown) => ({ ok: true, json: async () => body }) as Response;
const details = (n: number, d: object) => ({ [`ISBN:${isbn(n)}`]: { details: d } });

function setup(response: unknown = {}) {
  const fetchMock = vi.fn<typeof fetch>(async () => reply(response));
  const patchBook = vi.fn<ImportStore["patchBook"]>(async () => true);
  return { fetchImpl: fetchMock, fetchMock, patchBook };
}

describe("enrichMissing", () => {
  it("passes a 60 s abort signal with each request", async () => {
    const timeout = vi.spyOn(AbortSignal, "timeout");
    const s = setup(details(1, { covers: [123] }));
    await enrichMissing([book(1)], s, { fetchImpl: s.fetchImpl });
    expect(timeout).toHaveBeenCalledWith(60_000);
    const init = s.fetchMock.mock.calls[0][1];
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    timeout.mockRestore();
  });

  it("uses the first positive cover id", async () => {
    const s = setup(details(1, { covers: [-1, 123] }));
    const r = await enrichMissing([book(1)], s, { fetchImpl: s.fetchImpl });
    expect(s.patchBook).toHaveBeenCalledWith("b1", "u1", {
      coverUrl: "https://covers.openlibrary.org/b/id/123-L.jpg",
    });
    expect(r).toEqual({ looked: 1, filled: 1, failed: false });
  });

  it("gives no patch for only -1", async () => {
    const s = setup(details(1, { covers: [-1] }));
    const r = await enrichMissing([book(1)], s, { fetchImpl: s.fetchImpl });
    expect(s.patchBook).not.toHaveBeenCalled();
    expect(r).toEqual({ looked: 1, filled: 0, failed: false });
  });

  it("fills a synopsis from a string or { value }, and leaves it alone when absent", async () => {
    const s = setup({
      ...details(1, { description: "Plain" }),
      ...details(2, { description: { value: "Typed" } }),
      ...details(3, {}),
    });
    await enrichMissing([book(1), book(2), book(3)], s, { fetchImpl: s.fetchImpl });
    expect(s.patchBook).toHaveBeenCalledTimes(2);
    expect(s.patchBook).toHaveBeenCalledWith("b1", "u1", { synopsis: "Plain" });
    expect(s.patchBook).toHaveBeenCalledWith("b2", "u2", { synopsis: "Typed" });
  });

  it("never patches an edited field or replaces an existing one, and skips books without an ISBN", async () => {
    const s = setup({
      ...details(1, { covers: [5], description: "D" }),
      ...details(2, { covers: [6], description: "D" }),
    });
    const books = [
      book(1, { userEditedFields: ["coverUrl", "synopsis"] }),
      book(2, { coverUrl: "https://example.test/c.jpg", synopsis: "Mine" }),
      book(3, { isbn13: [], isbn10: [] }),
    ];
    const r = await enrichMissing(books, s, { fetchImpl: s.fetchImpl });
    expect(s.patchBook).not.toHaveBeenCalled();
    expect(s.fetchMock).not.toHaveBeenCalled();
    expect(r).toEqual({ looked: 0, filled: 0, failed: false });
  });

  it("still fills the other field when only one is edited or present", async () => {
    const s = setup(details(1, { covers: [5], description: "D" }));
    await enrichMissing([book(1, { userEditedFields: ["coverUrl"] })], s, { fetchImpl: s.fetchImpl });
    expect(s.patchBook).toHaveBeenCalledWith("b1", "u1", { synopsis: "D" });
  });

  it("sends 90 candidates in 3 requests of at most 40 ISBNs", async () => {
    const s = setup({});
    await enrichMissing(Array.from({ length: 90 }, (_, i) => book(i + 1)), s, { fetchImpl: s.fetchImpl });
    const urls = s.fetchMock.mock.calls.map((c) => String(c[0]));
    expect(urls).toHaveLength(3);
    expect(urls.map((u) => u.split("ISBN:").length - 1)).toEqual([40, 40, 10]);
    expect(urls[0]).toMatch(/^https:\/\/openlibrary\.org\/api\/books\?bibkeys=ISBN:\d+,ISBN:\d+/);
    expect(urls[0]).toContain("&format=json&jscmd=details");
  });

  it("stops on a rejected fetch but keeps earlier patches", async () => {
    const s = setup({});
    let call = 0;
    const fetchImpl = vi.fn(async () => {
      call += 1;
      if (call === 2) throw new Error("offline");
      return reply(details(1, { covers: [9] }));
    }) as unknown as typeof fetch;
    vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await enrichMissing(Array.from({ length: 90 }, (_, i) => book(i + 1)), s, { fetchImpl });
    expect(r).toEqual({ looked: 90, filled: 1, failed: true });
    expect(call).toBe(2);
  });

  it("treats an HTTP error as a failure", async () => {
    const s = setup({});
    vi.spyOn(console, "error").mockImplementation(() => {});
    const fetchImpl = vi.fn(
      async () => ({ ok: false, status: 429, json: async () => ({}) }) as Response,
    ) as unknown as typeof fetch;
    const r = await enrichMissing([book(1)], s, { fetchImpl });
    expect(r.failed).toBe(true);
  });

  it("does not count a patch the store refused", async () => {
    const s = setup(details(1, { covers: [9] }));
    s.patchBook.mockResolvedValue(false);
    const r = await enrichMissing([book(1)], s, { fetchImpl: s.fetchImpl });
    expect(r).toEqual({ looked: 1, filled: 0, failed: false });
  });

  it("skips an ISBN missing from the response and reports progress", async () => {
    const s = setup(details(2, { covers: [4] }));
    const onProgress = vi.fn();
    const r = await enrichMissing([book(1), book(2)], s, { fetchImpl: s.fetchImpl, onProgress });
    expect(s.patchBook).toHaveBeenCalledTimes(1);
    expect(r.filled).toBe(1);
    expect(onProgress.mock.calls).toEqual([
      [0, 2],
      [2, 2],
    ]);
  });
});
