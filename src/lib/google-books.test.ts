import { describe, expect, it, vi } from "vitest";
import { coverOf, GoogleBooksError, lookupGoogleBooksIsbn, plainText, searchGoogleBooks, searchGoogleBooksIsbn } from "./google-books";

// Synthetic, checksum-valid ISBNs: 978-0-00-000001-? style, not real books.
const ISBN13 = "9780000000019";
const ISBN10_SAME = "0000000019";
const OTHER13 = "9780000000026";
const KEY = "test-key-not-real";

const reply = (body: unknown, status = 200) =>
  ({ ok: status >= 200 && status < 300, status, json: async () => body }) as Response;

const volume = (ids: object[], info: object = {}) => ({
  volumeInfo: { industryIdentifiers: ids, ...info },
});

describe("lookupGoogleBooksIsbn", () => {
  it("asks for one ISBN with the key and a 60 s abort signal", async () => {
    const timeout = vi.spyOn(AbortSignal, "timeout");
    const fetchImpl = vi.fn<typeof fetch>(async () => reply({}));
    await lookupGoogleBooksIsbn(ISBN13, KEY, fetchImpl);
    expect(String(fetchImpl.mock.calls[0][0])).toBe(
      `https://www.googleapis.com/books/v1/volumes?q=isbn:${ISBN13}&key=${KEY}`,
    );
    expect(timeout).toHaveBeenCalledWith(60_000);
    expect(fetchImpl.mock.calls[0][1]?.signal).toBeInstanceOf(AbortSignal);
    timeout.mockRestore();
  });

  it("takes the first item that lists the ISBN-13 or its ISBN-10", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      reply({
        items: [
          volume([{ type: "ISBN_13", identifier: OTHER13 }], { description: "Wrong" }),
          volume([{ type: "ISBN_10", identifier: ISBN10_SAME }], { description: "Right" }),
          volume([{ type: "ISBN_13", identifier: ISBN13 }], { description: "Later" }),
        ],
      }),
    );
    expect(await lookupGoogleBooksIsbn(ISBN13, KEY, fetchImpl)).toEqual({ coverUrl: null, synopsis: "Right" });
  });

  it("returns null when no item lists the ISBN, or there are no items", async () => {
    const mismatch = vi.fn<typeof fetch>(async () =>
      reply({ items: [volume([{ type: "ISBN_13", identifier: OTHER13 }], { description: "Wrong" })] }),
    );
    expect(await lookupGoogleBooksIsbn(ISBN13, KEY, mismatch)).toBeNull();
    const none = vi.fn<typeof fetch>(async () => reply({ totalItems: 0 }));
    expect(await lookupGoogleBooksIsbn(ISBN13, KEY, none)).toBeNull();
  });

  it("throws a GoogleBooksError without the key on HTTP errors and network failures", async () => {
    const http = vi.fn<typeof fetch>(async () => reply({}, 429));
    const e1 = await lookupGoogleBooksIsbn(ISBN13, KEY, http).catch((e: unknown) => e);
    expect(e1).toBeInstanceOf(GoogleBooksError);
    expect((e1 as GoogleBooksError).status).toBe(429);
    expect((e1 as Error).message).not.toContain(KEY);

    const offline = vi.fn<typeof fetch>(async () => {
      throw new TypeError(`Failed to fetch https://www.googleapis.com/books/v1/volumes?key=${KEY}`);
    });
    const e2 = await lookupGoogleBooksIsbn(ISBN13, KEY, offline).catch((e: unknown) => e);
    expect(e2).toBeInstanceOf(GoogleBooksError);
    expect((e2 as GoogleBooksError).status).toBeNull();
    expect((e2 as Error).message).not.toContain(KEY);
  });
});

describe("coverOf", () => {
  it("forces https and removes edge=curl", () => {
    expect(
      coverOf({
        imageLinks: { thumbnail: "http://books.google.com/books/content?id=abc&printsec=frontcover&img=1&zoom=1&edge=curl&source=gbs_api" },
      }),
    ).toBe("https://books.google.com/books/content?id=abc&printsec=frontcover&img=1&zoom=1&source=gbs_api");
  });

  it("falls back to smallThumbnail, and gives null without links", () => {
    expect(coverOf({ imageLinks: { smallThumbnail: "http://books.google.com/x?id=1&edge=curl" } })).toBe(
      "https://books.google.com/x?id=1",
    );
    expect(coverOf({})).toBeNull();
    expect(coverOf({ imageLinks: { thumbnail: "javascript:alert(1)" } })).toBeNull();
  });
});

describe("plainText", () => {
  it("strips tags and decodes entities", () => {
    expect(plainText("<p>A <b>bold</b> tale &amp; a &quot;quiet&quot; one&#39;s end.</p><p>Part two.</p>")).toBe(
      'A bold tale & a "quiet" one\'s end.\n\nPart two.',
    );
    expect(plainText("Line one<br>Line&nbsp;two<br clear=all>three")).toBe("Line one\nLine two\nthree");
    expect(plainText("<h2>Title</h2>Body<ul><li>a</li><li>b</li></ul>")).toBe("Title\n\nBody\n\na\n\nb");
    expect(plainText("<p> </p>")).toBe("");
  });

  it("does not run or keep markup from the description", () => {
    expect(plainText('<img src=x onerror="alert(1)">Safe')).toBe("Safe");
    expect(plainText("<style>p{color:red}</style><script>alert(1)</script>Hi")).toBe("Hi");
  });
});

describe("searchGoogleBooks", () => {
  it("builds the intitle/inauthor query with the key and maps hits", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      reply({
        items: [
          {
            id: "gb1",
            volumeInfo: {
              title: "Glass Orchard",
              authors: ["Ana Vale"],
              description: "<p>Hello</p>",
              pageCount: 200,
              publishedDate: "2001",
              language: "en",
              imageLinks: { thumbnail: "http://example.test/c.jpg?edge=curl" },
              industryIdentifiers: [
                { type: "ISBN_13", identifier: ISBN13 },
                { type: "ISBN_10", identifier: ISBN10_SAME },
                { type: "OTHER", identifier: "zzz" },
              ],
            },
          },
          { id: "gb2" },
        ],
      }),
    );
    const hits = await searchGoogleBooks("Glass Orchard", "Ana Vale", KEY, fetchImpl);
    const url = String(fetchImpl.mock.calls[0][0]);
    expect(url).toContain("q=intitle:%22Glass%20Orchard%22+inauthor:%22Ana%20Vale%22");
    expect(url).toContain("maxResults=5");
    expect(url).toContain(`key=${KEY}`);
    expect(fetchImpl.mock.calls[0][1]?.signal).toBeInstanceOf(AbortSignal);
    expect(hits).toEqual([
      {
        id: "gb1",
        title: "Glass Orchard",
        authors: ["Ana Vale"],
        isbns: [ISBN13],
        coverUrl: "https://example.test/c.jpg",
        synopsis: "Hello",
        pageCount: 200,
        publishDate: "2001",
        language: "en",
      },
    ]);
  });

  it("adds langRestrict and printType only when opts are given", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => reply({ totalItems: 0 }));
    await searchGoogleBooks("Glass Orchard", null, KEY, fetchImpl);
    expect(String(fetchImpl.mock.calls[0][0])).toBe(
      `https://www.googleapis.com/books/v1/volumes?q=intitle:%22Glass%20Orchard%22&maxResults=5&key=${KEY}`,
    );
    await searchGoogleBooks("Glass Orchard", null, KEY, fetchImpl, { langRestrict: "en", printType: "books" });
    const withOpts = String(fetchImpl.mock.calls[1][0]);
    expect(withOpts).toContain("&langRestrict=en&printType=books");
    expect(withOpts).toContain(`key=${KEY}`);
  });

  it("maps a missing language to null", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => reply({ items: [{ id: "gb3", volumeInfo: { title: "T" } }] }));
    const hits = await searchGoogleBooks("T", null, KEY, fetchImpl);
    expect(hits[0].language).toBeNull();
  });

  it("omits inauthor when there is no author, and returns [] with no items", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => reply({ totalItems: 0 }));
    expect(await searchGoogleBooks("Glass Orchard", null, KEY, fetchImpl)).toEqual([]);
    expect(String(fetchImpl.mock.calls[0][0])).not.toContain("inauthor");
  });

  it("throws GoogleBooksError on 429 without the key in the message", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => reply({}, 429));
    const e = await searchGoogleBooks("x", null, KEY, fetchImpl).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(GoogleBooksError);
    expect((e as GoogleBooksError).status).toBe(429);
    expect((e as Error).message).not.toContain(KEY);
  });
});

describe("searchGoogleBooksIsbn", () => {
  it("queries by isbn and maps the first hit", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      reply({ items: [{ id: "g1", volumeInfo: { title: "Glass Orchard", industryIdentifiers: [{ identifier: ISBN13 }] } }] }),
    );
    const hit = await searchGoogleBooksIsbn(ISBN13, KEY, fetchImpl);
    expect(String(fetchImpl.mock.calls[0][0])).toContain(`q=isbn:${ISBN13}`);
    expect(hit).toMatchObject({ id: "g1", title: "Glass Orchard", isbns: [ISBN13] });
  });

  it("returns null with no items", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => reply({ totalItems: 0 }));
    expect(await searchGoogleBooksIsbn(ISBN13, KEY, fetchImpl)).toBeNull();
  });

  it("never puts the key in an error message", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => reply({}, 429));
    const e = await searchGoogleBooksIsbn(ISBN13, KEY, fetchImpl).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(GoogleBooksError);
    expect((e as Error).message).not.toContain(KEY);
  });
});
