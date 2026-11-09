import { describe, expect, it, vi } from "vitest";
import { agrees, LookupError, lookupMetadata } from "./lookup";

const reply = (body: unknown, status = 200) =>
  ({ ok: status >= 200 && status < 300, status, json: async () => body }) as Response;

const Q = { title: "The Glass Orchard", authors: ["Ana Vale"] };
const doc = (over: object = {}) => ({
  key: "/works/OL1W",
  title: "The Glass Orchard",
  author_name: ["Ana Vale"],
  isbn: ["9780000000019", "0000000019", "bogus", "9780000000026"],
  cover_i: 42,
  number_of_pages_median: 310,
  first_publish_year: 1999,
  ...over,
});

function router(routes: Record<string, () => Response | Promise<Response>>) {
  return vi.fn<typeof fetch>(async (input) => {
    const url = String(input);
    for (const [prefix, fn] of Object.entries(routes)) if (url.startsWith(prefix)) return fn();
    throw new Error(`unexpected ${url}`);
  });
}
const OL = "https://openlibrary.org/search.json";
const WORK = "https://openlibrary.org/works/OL1W.json";
const GB = "https://www.googleapis.com/books/v1/volumes";

describe("agrees", () => {
  it("needs a similar title and overlapping authors, or no query authors", () => {
    expect(agrees(Q, { title: "Glass Orchard", authors: ["Ana Vale"] })).toBe(true);
    expect(agrees(Q, { title: "Salt Road", authors: ["Ana Vale"] })).toBe(false);
    expect(agrees(Q, { title: "The Glass Orchard", authors: ["Bo Lin"] })).toBe(false);
    expect(agrees({ title: "Glass Orchard", authors: [] }, { title: "Glass Orchard", authors: ["Bo Lin"] })).toBe(true);
    expect(agrees(Q, { title: null, authors: ["Ana Vale"] })).toBe(false);
  });
});

describe("lookupMetadata", () => {
  it("adopts an agreeing OpenLibrary doc", async () => {
    const fetchImpl = router({
      [OL]: () => reply({ docs: [doc()] }),
      [WORK]: () => reply({ description: "A tale." }),
    });
    const r = await lookupMetadata(Q, { fetchImpl, googleBooksKey: null });
    expect(r).toMatchObject({
      source: "openlibrary",
      agrees: true,
      title: "The Glass Orchard",
      authors: ["Ana Vale"],
      coverUrl: "https://covers.openlibrary.org/b/id/42-L.jpg",
      synopsis: "A tale.",
      matchIsbns: ["9780000000019", "9780000000026"],
      pageCount: 310,
      publishDate: "1999",
      openlibraryId: "OL1W",
      googleBooksId: null,
    });
  });

  it("reads a description given as { value }", async () => {
    const fetchImpl = router({
      [OL]: () => reply({ docs: [doc()] }),
      [WORK]: () => reply({ description: { value: "Object form." } }),
    });
    expect((await lookupMetadata(Q, { fetchImpl, googleBooksKey: null })).synopsis).toBe("Object form.");
  });

  it("leaves synopsis null when the work record fails", async () => {
    const fetchImpl = router({
      [OL]: () => reply({ docs: [doc()] }),
      [WORK]: () => reply({}, 500),
    });
    const r = await lookupMetadata(Q, { fetchImpl, googleBooksKey: null });
    expect(r.agrees).toBe(true);
    expect(r.synopsis).toBeNull();
  });

  it("leaves synopsis null when the work request rejects", async () => {
    const fetchImpl = router({
      [OL]: () => reply({ docs: [doc()] }),
      [WORK]: () => Promise.reject(new TypeError("offline")),
    });
    expect((await lookupMetadata(Q, { fetchImpl, googleBooksKey: null })).synopsis).toBeNull();
  });

  it("returns none for a different title when there is no Google key", async () => {
    const fetchImpl = router({ [OL]: () => reply({ docs: [doc({ title: "Salt Road" })] }) });
    const r = await lookupMetadata(Q, { fetchImpl, googleBooksKey: null });
    expect(r).toMatchObject({ source: "none", agrees: false, title: "Salt Road", coverUrl: null, matchIsbns: [] });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("asks Google when OpenLibrary has no agreeing doc", async () => {
    const fetchImpl = router({
      [OL]: () => reply({ docs: [doc({ title: "Salt Road" })] }),
      [GB]: () =>
        reply({
          items: [
            {
              id: "gb1",
              volumeInfo: {
                title: "The Glass Orchard",
                authors: ["Ana Vale"],
                description: "<p>Google text</p>",
                pageCount: 280,
                publishedDate: "2001-05-01",
                industryIdentifiers: [{ type: "ISBN_13", identifier: "9780000000019" }],
              },
            },
          ],
        }),
    });
    const r = await lookupMetadata(Q, { fetchImpl, googleBooksKey: "k" });
    expect(r).toMatchObject({
      source: "google",
      agrees: true,
      googleBooksId: "gb1",
      synopsis: "Google text",
      pageCount: 280,
      publishDate: "2001-05-01",
      matchIsbns: ["9780000000019"],
      openlibraryId: null,
    });
  });

  it("returns none when Google has no agreeing hit either", async () => {
    const fetchImpl = router({
      [OL]: () => reply({ docs: [] }),
      [GB]: () => reply({ items: [{ id: "g", volumeInfo: { title: "Salt Road", authors: ["Ana Vale"] } }] }),
    });
    const r = await lookupMetadata(Q, { fetchImpl, googleBooksKey: "k" });
    expect(r).toMatchObject({ source: "none", agrees: false, title: "Salt Road" });
  });

  it("does not agree when authors don't overlap, but agrees on title alone with no query authors", async () => {
    const other = doc({ author_name: ["Bo Lin"] });
    const f1 = router({ [OL]: () => reply({ docs: [other] }) });
    expect((await lookupMetadata(Q, { fetchImpl: f1, googleBooksKey: null })).agrees).toBe(false);
    const f2 = router({ [OL]: () => reply({ docs: [other] }), [WORK]: () => reply({}) });
    const r = await lookupMetadata({ title: Q.title, authors: [] }, { fetchImpl: f2, googleBooksKey: null });
    expect(r.agrees).toBe(true);
  });

  it("throws retryable LookupError on 429, 5xx and network failure; not on 404", async () => {
    for (const status of [429, 503]) {
      const f = router({ [OL]: () => reply({}, status) });
      const e = await lookupMetadata(Q, { fetchImpl: f, googleBooksKey: null }).catch((x: unknown) => x);
      expect(e).toBeInstanceOf(LookupError);
      expect((e as LookupError).retryable).toBe(true);
    }
    const offline = router({ [OL]: () => Promise.reject(new TypeError("offline")) });
    const e2 = await lookupMetadata(Q, { fetchImpl: offline, googleBooksKey: null }).catch((x: unknown) => x);
    expect((e2 as LookupError).retryable).toBe(true);
    const nf = router({ [OL]: () => reply({}, 404) });
    const e3 = await lookupMetadata(Q, { fetchImpl: nf, googleBooksKey: null }).catch((x: unknown) => x);
    expect(e3).toBeInstanceOf(LookupError);
    expect((e3 as LookupError).retryable).toBe(false);
  });

  it("wraps a Google Books failure as LookupError without the key", async () => {
    const fetchImpl = router({
      [OL]: () => reply({ docs: [] }),
      [GB]: () => reply({}, 429),
    });
    const e = await lookupMetadata(Q, { fetchImpl, googleBooksKey: "SECRETKEY" }).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(LookupError);
    expect((e as LookupError).retryable).toBe(true);
    expect((e as Error).message).not.toContain("SECRETKEY");
  });

  it("encodes the title, omits author when there are none, and sends a timeout signal", async () => {
    const fetchImpl = router({ [OL]: () => reply({ docs: [] }) });
    await lookupMetadata({ title: "Glass & Orchard?", authors: [] }, { fetchImpl, googleBooksKey: null });
    const url = String(fetchImpl.mock.calls[0][0]);
    expect(url).toContain("title=Glass%20%26%20Orchard%3F");
    expect(url).not.toContain("author=");
    expect(url).toContain("limit=5");
    expect(fetchImpl.mock.calls[0][1]?.signal).toBeInstanceOf(AbortSignal);
    const f2 = router({ [OL]: () => reply({ docs: [] }) });
    await lookupMetadata(Q, { fetchImpl: f2, googleBooksKey: null });
    expect(String(f2.mock.calls[0][0])).toContain("author=Ana%20Vale");
  });
});
