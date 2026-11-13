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
  seriesName: null,
  seriesVolume: null,
  onShelf: true,
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

describe("enrichMissing with Google Books", () => {
  const KEY = "test-key-not-real";
  const isGoogle = (url: unknown) => String(url).startsWith("https://www.googleapis.com/");
  const gVolume = (n: number, info: object) => ({
    items: [{ volumeInfo: { industryIdentifiers: [{ type: "ISBN_13", identifier: isbn(n) }], ...info } }],
  });

  /** OpenLibrary answers `ol`; Google answers by the ISBN in its query via `google`. */
  function routed(ol: unknown, google: (isbn: string) => Response) {
    return vi.fn<typeof fetch>(async (url) => {
      if (isGoogle(url)) return google(new URL(String(url)).searchParams.get("q")!.replace("isbn:", ""));
      return reply(ol);
    });
  }

  const patchBook = () => vi.fn<ImportStore["patchBook"]>(async () => true);

  it("makes no Google request without a key", async () => {
    const fetchImpl = routed({}, () => reply(gVolume(1, { description: "G" })));
    const store = { patchBook: patchBook() };
    for (const key of [undefined, null, "", "  "]) {
      await enrichMissing([book(1)], store, { fetchImpl, googleBooksKey: key });
    }
    expect(fetchImpl.mock.calls.some((c) => isGoogle(c[0]))).toBe(false);
    expect(store.patchBook).not.toHaveBeenCalled();
  });

  it("asks Google only for books OpenLibrary left incomplete, and combines both in one patch", async () => {
    const fetchImpl = routed(
      { ...details(1, { covers: [5], description: "OL" }), ...details(2, { covers: [6] }) },
      (i) => reply(i === isbn(2) ? gVolume(2, { description: "<p>From &amp; Google</p>" }) : {}),
    );
    const store = { patchBook: patchBook() };
    const r = await enrichMissing([book(1), book(2)], store, { fetchImpl, googleBooksKey: KEY });
    const googleUrls = fetchImpl.mock.calls.filter((c) => isGoogle(c[0])).map((c) => String(c[0]));
    expect(googleUrls).toEqual([`https://www.googleapis.com/books/v1/volumes?q=isbn:${isbn(2)}&key=${KEY}`]);
    expect(store.patchBook).toHaveBeenCalledWith("b1", "u1", {
      coverUrl: "https://covers.openlibrary.org/b/id/5-L.jpg",
      synopsis: "OL",
    });
    expect(store.patchBook).toHaveBeenCalledWith("b2", "u2", {
      coverUrl: "https://covers.openlibrary.org/b/id/6-L.jpg",
      synopsis: "From & Google",
    });
    expect(r).toEqual({ looked: 2, filled: 2, failed: false });
  });

  it("does not ask Google for a field that is edited or present", async () => {
    const fetchImpl = routed(details(1, { covers: [5] }), () => reply(gVolume(1, { description: "G" })));
    const store = { patchBook: patchBook() };
    await enrichMissing([book(1, { synopsis: "Mine" }), book(2, { userEditedFields: ["coverUrl"], synopsis: "x" })], store, {
      fetchImpl,
      googleBooksKey: KEY,
    });
    expect(fetchImpl.mock.calls.some((c) => isGoogle(c[0]))).toBe(false);
  });

  it("tries each ISBN until one hits, and fills a forced-https cover without edge=curl", async () => {
    const fetchImpl = routed({}, (i) =>
      reply(
        i === isbn(9)
          ? gVolume(9, { imageLinks: { thumbnail: "http://books.google.com/books/content?id=z&edge=curl&zoom=1" } })
          : {},
      ),
    );
    const store = { patchBook: patchBook() };
    await enrichMissing([book(1, { isbn13: [isbn(8), isbn(9), isbn(10)] })], store, {
      fetchImpl,
      googleBooksKey: KEY,
    });
    // isbn(8) misses; isbn(9) gives only a cover, so isbn(10) is tried for the synopsis.
    const googleCalls = fetchImpl.mock.calls.filter((c) => isGoogle(c[0]));
    expect(googleCalls).toHaveLength(3);
    expect(store.patchBook).toHaveBeenCalledWith("b1", "u1", {
      coverUrl: "https://books.google.com/books/content?id=z&zoom=1",
    });
  });

  it("gives no patch when Google's item lists a different ISBN", async () => {
    const fetchImpl = routed({}, () => reply(gVolume(2, { description: "Other book" })));
    const store = { patchBook: patchBook() };
    const r = await enrichMissing([book(1)], store, { fetchImpl, googleBooksKey: KEY });
    expect(fetchImpl.mock.calls.some((c) => isGoogle(c[0]))).toBe(true);
    expect(store.patchBook).not.toHaveBeenCalled();
    expect(r).toEqual({ looked: 1, filled: 0, failed: false });
  });

  it("never patches an edited coverUrl from Google", async () => {
    const fetchImpl = routed({}, () =>
      reply(gVolume(1, { description: "G", imageLinks: { thumbnail: "https://books.google.com/c?id=1" } })),
    );
    const store = { patchBook: patchBook() };
    await enrichMissing([book(1, { userEditedFields: ["coverUrl"] })], store, { fetchImpl, googleBooksKey: KEY });
    expect(store.patchBook).toHaveBeenCalledWith("b1", "u1", { synopsis: "G" });
  });

  it("a 429 stops the Google lookups non-fatally, keeps earlier patches, and never logs the key", async () => {
    let googleCalls = 0;
    const fetchImpl = routed({}, () => {
      googleCalls += 1;
      if (googleCalls === 1) return reply(gVolume(1, { description: "G1" }));
      return { ok: false, status: 429, json: async () => ({}) } as Response;
    });
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const store = { patchBook: patchBook() };
    const onProgress = vi.fn();
    const r = await enrichMissing([book(1), book(2), book(3)], store, {
      fetchImpl,
      googleBooksKey: KEY,
      onProgress,
    });
    expect(googleCalls).toBe(2);
    expect(store.patchBook).toHaveBeenCalledTimes(1);
    expect(store.patchBook).toHaveBeenCalledWith("b1", "u1", { synopsis: "G1" });
    expect(r).toEqual({ looked: 3, filled: 1, failed: true });
    expect(onProgress.mock.calls.at(-1)).toEqual([3, 3]);
    expect(error).toHaveBeenCalled();
    expect(JSON.stringify(error.mock.calls.map((c) => c.map(String)))).not.toContain(KEY);
    error.mockRestore();
  });

  it("a network failure stops the Google lookups but OpenLibrary patches still land", async () => {
    const fetchImpl = routed({ ...details(1, { covers: [5] }), ...details(2, { covers: [6] }) }, () => {
      throw new TypeError(`Failed to fetch ?key=${KEY}`);
    });
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const store = { patchBook: patchBook() };
    const r = await enrichMissing([book(1), book(2)], store, { fetchImpl, googleBooksKey: KEY });
    expect(fetchImpl.mock.calls.filter((c) => isGoogle(c[0]))).toHaveLength(1);
    expect(store.patchBook).toHaveBeenCalledTimes(2);
    expect(r).toEqual({ looked: 2, filled: 2, failed: true });
    expect(JSON.stringify(error.mock.calls.map((c) => c.map(String)))).not.toContain(KEY);
    error.mockRestore();
  });

  it("keeps asking further ISBNs until the needed field is found, merging what each gives", async () => {
    const fetchImpl = routed({}, (i) => {
      if (i === isbn(8)) return reply(gVolume(8, { description: "From 8" }));
      if (i === isbn(9)) return reply(gVolume(9, { imageLinks: { thumbnail: "https://books.google.com/c?id=9" } }));
      return reply({});
    });
    const store = { patchBook: patchBook() };
    await enrichMissing([book(1, { isbn13: [isbn(8), isbn(9), isbn(10)] })], store, {
      fetchImpl,
      googleBooksKey: KEY,
    });
    expect(fetchImpl.mock.calls.filter((c) => isGoogle(c[0]))).toHaveLength(2);
    expect(store.patchBook).toHaveBeenCalledWith("b1", "u1", {
      coverUrl: "https://books.google.com/c?id=9",
      synopsis: "From 8",
    });
  });

  it("tries at most 5 ISBNs per book on Google", async () => {
    const fetchImpl = routed({}, () => reply({}));
    const store = { patchBook: patchBook() };
    await enrichMissing([book(1, { isbn13: Array.from({ length: 8 }, (_, k) => isbn(20 + k)) })], store, {
      fetchImpl,
      googleBooksKey: KEY,
    });
    expect(fetchImpl.mock.calls.filter((c) => isGoogle(c[0]))).toHaveLength(5);
  });

  it("matches a book that has only an ISBN-10, through its ISBN-13", async () => {
    // 0000000019 converts to 9780000000019 = isbn(1).
    const fetchImpl = routed({}, () =>
      reply({
        items: [{ volumeInfo: { industryIdentifiers: [{ type: "ISBN_10", identifier: "0000000019" }], description: "Ten" } }],
      }),
    );
    const store = { patchBook: patchBook() };
    await enrichMissing([book(1, { isbn13: [], isbn10: ["0000000019"] })], store, { fetchImpl, googleBooksKey: KEY });
    expect(String(fetchImpl.mock.calls.find((c) => isGoogle(c[0]))![0])).toContain(`q=isbn:${isbn(1)}`);
    expect(store.patchBook).toHaveBeenCalledWith("b1", "u1", { synopsis: "Ten" });
  });

  it("gives no synopsis for a blank or tag-only description", async () => {
    const fetchImpl = routed({}, () => reply(gVolume(1, { description: "<p> </p>" })));
    const store = { patchBook: patchBook() };
    await enrichMissing([book(1)], store, { fetchImpl, googleBooksKey: KEY });
    expect(store.patchBook).not.toHaveBeenCalled();
  });

  it.each([
    ["a 403", () => ({ ok: false, status: 403, json: async () => ({}) }) as Response],
    [
      "a timeout",
      () => {
        throw new DOMException("signal timed out", "TimeoutError");
      },
    ],
  ])("%s also stops the Google lookups non-fatally", async (_label, google) => {
    const fetchImpl = routed({}, google);
    vi.spyOn(console, "error").mockImplementation(() => {});
    const store = { patchBook: patchBook() };
    const r = await enrichMissing([book(1), book(2)], store, { fetchImpl, googleBooksKey: KEY });
    expect(fetchImpl.mock.calls.filter((c) => isGoogle(c[0]))).toHaveLength(1);
    expect(r).toEqual({ looked: 2, filled: 0, failed: true });
  });

  it("keeps Google patches when a later OpenLibrary request fails", async () => {
    let olCalls = 0;
    const fetchImpl = vi.fn<typeof fetch>(async (url) => {
      if (isGoogle(url)) {
        const i = new URL(String(url)).searchParams.get("q")!.replace("isbn:", "");
        return reply({ items: [{ volumeInfo: { industryIdentifiers: [{ identifier: i }], description: "G" } }] });
      }
      olCalls += 1;
      if (olCalls === 2) throw new Error("offline");
      return reply({});
    });
    vi.spyOn(console, "error").mockImplementation(() => {});
    const store = { patchBook: patchBook() };
    const r = await enrichMissing(Array.from({ length: 45 }, (_, k) => book(k + 1)), store, {
      fetchImpl,
      googleBooksKey: KEY,
    });
    expect(r).toEqual({ looked: 45, filled: 40, failed: true });
  });
});
