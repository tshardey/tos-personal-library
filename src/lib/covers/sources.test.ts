import { describe, expect, it, vi } from "vitest";
import { LookupError } from "../photo/lookup";
import type { ImageSize, MeasureImage } from "./measure";
import {
  gatherCandidates,
  googleCandidates,
  openLibraryCandidates,
  orderCandidates,
  type RawCandidate,
} from "./sources";
import type { CoverSearchBook } from "./types";

const book = (over: Partial<CoverSearchBook> = {}): CoverSearchBook => ({
  title: "The Salt Road",
  authors: ["Ada Writer"],
  isbn13: [],
  isbn10: [],
  coverUrl: null,
  ...over,
});

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const olUrl = (id: number) => `https://covers.openlibrary.org/b/id/${id}-L.jpg`;

interface Routes {
  search?: () => Response;
  editions?: Record<string, () => Response>;
  google?: () => Response;
}

function stub(routes: Routes) {
  const calls: string[] = [];
  const fn = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);
    if (url.startsWith("https://openlibrary.org/search.json")) return (routes.search ?? (() => json({ docs: [] })))();
    if (url.startsWith("https://www.googleapis.com/books/v1/volumes"))
      return (routes.google ?? (() => json({ items: [] })))();
    const m = /^https:\/\/openlibrary\.org(\/works\/[^/]+)\/editions\.json/.exec(url);
    if (m && routes.editions?.[m[1]]) return routes.editions[m[1]]();
    return json({}, 404);
  });
  return { fetchImpl: fn as unknown as typeof fetch, calls };
}

const work = (key: string, extra: Record<string, unknown> = {}) => ({
  key,
  title: "Der Salzweg",
  author_name: ["Ada Writer"],
  cover_i: 1000001,
  ...extra,
});

const ed = (title: string, cover: number, languages?: { key: string }[], extra: Record<string, unknown> = {}) => ({
  title,
  covers: [cover],
  ...(languages === undefined ? {} : { languages }),
  ...extra,
});

const EN = [{ key: "/languages/eng" }];

describe("openLibraryCandidates", () => {
  it("keeps only English and language-unknown editions of a translated work", async () => {
    const { fetchImpl } = stub({
      search: () => json({ docs: [work("/works/OL1W")] }),
      editions: {
        "/works/OL1W": () =>
          json({
            entries: [
              ed("Der Salzweg", 1000001, [{ key: "/languages/ger" }]),
              ed("The Salt Road", 1000002, EN),
              ed("The Salt Road", 1000003),
              ed("The Salt Road", 1000004, [{ key: "/languages/fre" }]),
            ],
          }),
      },
    });
    const out = await openLibraryCandidates(book(), fetchImpl);
    expect(out.map((c) => c.url)).toEqual([olUrl(1000002), olUrl(1000003)]);
    expect(out.map((c) => c.language)).toEqual(["en", null]);
    expect(out[0].source).toBe("openlibrary");
  });

  it("keeps an English edition although the edition has no authors, and drops other titles", async () => {
    const { fetchImpl } = stub({
      search: () => json({ docs: [work("/works/OL1W")] }),
      editions: {
        "/works/OL1W": () =>
          json({ entries: [ed("The Salt Road", 1000002, EN), ed("Another Book", 1000005, EN)] }),
      },
    });
    const out = await openLibraryCandidates(book(), fetchImpl);
    expect(out.map((c) => c.url)).toEqual([olUrl(1000002)]);
  });

  it("joins title and subtitle for the title check", async () => {
    const { fetchImpl } = stub({
      search: () => json({ docs: [work("/works/OL1W")] }),
      editions: { "/works/OL1W": () => json({ entries: [ed("The Salt", 1000002, EN, { subtitle: "Road" })] }) },
    });
    const out = await openLibraryCandidates(book(), fetchImpl);
    expect(out).toHaveLength(1);
    expect(out[0].editionTitle).toBe("The Salt: Road");
  });

  it("skips a work whose editions 404 but throws retryable on 429", async () => {
    const two = {
      search: () => json({ docs: [work("/works/OL1W"), work("/works/OL2W")] }),
    };
    const ok = stub({
      ...two,
      editions: {
        "/works/OL1W": () => json({}, 404),
        "/works/OL2W": () => json({ entries: [ed("The Salt Road", 1000002, EN)] }),
      },
    });
    expect((await openLibraryCandidates(book(), ok.fetchImpl)).map((c) => c.url)).toEqual([olUrl(1000002)]);

    const bad = stub({
      ...two,
      editions: {
        "/works/OL1W": () => json({}, 429),
        "/works/OL2W": () => json({ entries: [] }),
      },
    });
    await expect(openLibraryCandidates(book(), bad.fetchImpl)).rejects.toMatchObject({
      name: "LookupError",
      retryable: true,
    });
  });

  it("puts an ISBN match first", async () => {
    const { fetchImpl } = stub({
      search: () => json({ docs: [work("/works/OL1W")] }),
      editions: {
        "/works/OL1W": () =>
          json({
            entries: [
              ed("The Salt Road", 1000002, EN),
              ed("The Salt Road", 1000006, EN, { isbn_13: ["9780306406157"] }),
            ],
          }),
      },
    });
    const out = await gatherCandidates(book({ isbn13: ["9780306406157"] }), {
      fetchImpl,
      googleKey: null,
      measure: async () => ({ width: 300, height: 450 }),
    });
    expect(out.map((c) => c.url)).toEqual([olUrl(1000006), olUrl(1000002)]);
    const raw = await openLibraryCandidates(book({ isbn13: ["9780306406157"] }), fetchImpl);
    expect(raw.map((c) => c.isbnMatch)).toEqual([false, true]);
  });

  it("skips works whose authors do not overlap; no authors takes the first 2 works", async () => {
    const docs = [
      work("/works/OL1W", { author_name: ["Someone Else"] }),
      work("/works/OL2W"),
      work("/works/OL3W"),
      work("/works/OL4W"),
    ];
    const entries = (n: number) => () => json({ entries: [ed("The Salt Road", n, EN)] });
    const editions = {
      "/works/OL1W": entries(1000011),
      "/works/OL2W": entries(1000012),
      "/works/OL3W": entries(1000013),
      "/works/OL4W": entries(1000014),
    };
    const a = stub({ search: () => json({ docs }), editions });
    expect((await openLibraryCandidates(book(), a.fetchImpl)).map((c) => c.url)).toEqual([
      olUrl(1000012),
      olUrl(1000013),
    ]);
    const b = stub({ search: () => json({ docs }), editions });
    const out = await openLibraryCandidates(book({ authors: [] }), b.fetchImpl);
    expect(out.map((c) => c.url)).toEqual([olUrl(1000011), olUrl(1000012)]);
  });

  it("accepts a work whose author_alternative_name holds the author, and skips one matching neither", async () => {
    const docs = [
      work("/works/OL1W", { author_name: ["Ада Писатель"], author_alternative_name: ["Ada Writer"] }),
      work("/works/OL2W", { author_name: ["Ада Писатель"], author_alternative_name: ["Someone Else"] }),
    ];
    const { fetchImpl } = stub({
      search: () => json({ docs }),
      editions: {
        "/works/OL1W": () => json({ entries: [ed("The Salt Road", 1000021, EN)] }),
        "/works/OL2W": () => json({ entries: [ed("The Salt Road", 1000022, EN)] }),
      },
    });
    const out = await openLibraryCandidates(book(), fetchImpl);
    expect(out.map((c) => c.url)).toEqual([olUrl(1000021)]);
  });

  it("builds the search and editions URLs", async () => {
    const { fetchImpl, calls } = stub({
      search: () => json({ docs: [work("/works/OL1W")] }),
      editions: { "/works/OL1W": () => json({ entries: [] }) },
    });
    await openLibraryCandidates(book({ title: "The Salt & Road" }), fetchImpl);
    expect(calls[0]).toBe(
      "https://openlibrary.org/search.json?q=The%20Salt%20%26%20Road&author=Ada%20Writer&limit=5&fields=key,title,author_name,author_alternative_name,cover_i,language",
    );
    expect(calls[1]).toBe("https://openlibrary.org/works/OL1W/editions.json?limit=1000");

    const none = stub({ search: () => json({ docs: [] }) });
    await openLibraryCandidates(book({ authors: [] }), none.fetchImpl);
    expect(none.calls[0]).not.toContain("author=");
  });

  it("maps search errors to LookupError", async () => {
    const e429 = stub({ search: () => json({}, 429) });
    await expect(openLibraryCandidates(book(), e429.fetchImpl)).rejects.toMatchObject({ retryable: true });
    const e500 = stub({ search: () => json({}, 503) });
    await expect(openLibraryCandidates(book(), e500.fetchImpl)).rejects.toMatchObject({ retryable: true });
    const e400 = stub({ search: () => json({}, 400) });
    const err = await openLibraryCandidates(book(), e400.fetchImpl).catch((e) => e);
    expect(err).toBeInstanceOf(LookupError);
    expect(err.retryable).toBe(false);
    const net = (async () => {
      throw new TypeError("network");
    }) as unknown as typeof fetch;
    await expect(openLibraryCandidates(book(), net)).rejects.toMatchObject({ retryable: true });
  });
});

const gItem = (id: string, title: string, language: string, authors = ["Ada Writer"]) => ({
  id,
  volumeInfo: {
    title,
    authors,
    language,
    imageLinks: {
      thumbnail: `http://books.google.com/books/content?id=${id}&printsec=frontcover&img=1&zoom=1&edge=curl`,
    },
  },
});

describe("googleCandidates", () => {
  it("keeps agreeing English hits with fife=w800, drops others, caps at 2", async () => {
    const { fetchImpl, calls } = stub({
      google: () =>
        json({
          items: [
            gItem("g1", "The Salt Road", "en"),
            gItem("g2", "La Ruta de Sal", "es"),
            gItem("g3", "Unrelated Thing", "en"),
            gItem("g4", "The Salt Road", "en"),
            gItem("g5", "The Salt Road", "en"),
          ],
        }),
    });
    const out = await googleCandidates(book(), "k", fetchImpl);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ source: "google", language: "en", editionTitle: "The Salt Road", isbnMatch: false });
    const u = new URL(out[0].url);
    expect(u.searchParams.get("fife")).toBe("w800");
    expect(u.searchParams.get("zoom")).toBe("1");
    expect(u.searchParams.get("id")).toBe("g1");
    expect(calls[0]).toContain("langRestrict=en");
  });

  it("returns [] on any Google failure", async () => {
    const { fetchImpl } = stub({ google: () => json({}, 403) });
    await expect(googleCandidates(book(), "k", fetchImpl)).resolves.toEqual([]);
  });
});

describe("orderCandidates", () => {
  const raw = (url: string, over: Partial<RawCandidate> = {}): RawCandidate => ({
    url,
    source: "openlibrary",
    language: null,
    editionTitle: null,
    isbnMatch: false,
    ...over,
  });

  it("orders ISBN, English, unknown, Google; dedupes; drops the current cover", () => {
    const list = [
      raw("g1", { source: "google", language: "en" }),
      raw("u1"),
      raw("e1", { language: "en" }),
      raw("i1", { language: "en", isbnMatch: true }),
      raw("e1", { language: "en" }),
      raw("cur", { language: "en" }),
    ];
    expect(orderCandidates(list, "cur").map((c) => c.url)).toEqual(["i1", "e1", "u1", "g1"]);
  });

  it("caps OpenLibrary at 5 and Google at 2", () => {
    const list = [
      ...Array.from({ length: 7 }, (_, i) => raw(`o${i}`, { language: "en" })),
      ...Array.from({ length: 4 }, (_, i) => raw(`g${i}`, { source: "google", language: "en" })),
    ];
    const out = orderCandidates(list, null);
    expect(out.filter((c) => c.source === "openlibrary")).toHaveLength(5);
    expect(out.filter((c) => c.source === "google")).toHaveLength(2);
  });
});

describe("gatherCandidates", () => {
  const sizes = (map: Record<string, ImageSize | null>, fallback: ImageSize | null = { width: 300, height: 450 }) =>
    vi.fn(async (url: string) => (url in map ? map[url] : fallback));

  const olEditions = (ids: number[]) =>
    stub({
      search: () => json({ docs: [work("/works/OL1W")] }),
      editions: { "/works/OL1W": () => json({ entries: ids.map((n) => ed("The Salt Road", n, EN)) }) },
    });

  it("never offers the book's own cover", async () => {
    const { fetchImpl } = olEditions([1000002, 1000003]);
    const out = await gatherCandidates(book({ coverUrl: olUrl(1000002) }), {
      fetchImpl,
      googleKey: null,
      measure: sizes({}),
    });
    expect(out.map((c) => c.url)).toEqual([olUrl(1000003)]);
  });

  it("does not call Google without a key, and survives a Google 403 with one", async () => {
    const a = olEditions([1000002]);
    await gatherCandidates(book(), { fetchImpl: a.fetchImpl, googleKey: null, measure: sizes({}) });
    expect(a.calls.some((u) => u.includes("googleapis"))).toBe(false);

    const b = stub({
      search: () => json({ docs: [work("/works/OL1W")] }),
      editions: { "/works/OL1W": () => json({ entries: [ed("The Salt Road", 1000002, EN)] }) },
      google: () => json({}, 403),
    });
    const out = await gatherCandidates(book(), { fetchImpl: b.fetchImpl, googleKey: "k", measure: sizes({}) });
    expect(out.map((c) => c.url)).toEqual([olUrl(1000002)]);
  });

  it("returns width, height, language and edition title; Google follows OpenLibrary", async () => {
    const s = stub({
      search: () => json({ docs: [work("/works/OL1W")] }),
      editions: { "/works/OL1W": () => json({ entries: [ed("The Salt Road", 1000002, EN)] }) },
      google: () => json({ items: [gItem("g1", "The Salt Road", "en")] }),
    });
    const out = await gatherCandidates(book(), { fetchImpl: s.fetchImpl, googleKey: "k", measure: sizes({}) });
    expect(out.map((c) => c.source)).toEqual(["openlibrary", "google"]);
    expect(out[0]).toEqual({
      url: olUrl(1000002),
      source: "openlibrary",
      width: 300,
      height: 450,
      language: "en",
      editionTitle: "The Salt Road",
    });
  });

  it("measures at most 8 and returns at most 6", async () => {
    const s = stub({
      search: () => json({ docs: [work("/works/OL1W"), work("/works/OL2W")] }),
      editions: {
        "/works/OL1W": () => json({ entries: [1, 2, 3, 4, 5].map((n) => ed("The Salt Road", 1000100 + n, EN)) }),
        "/works/OL2W": () => json({ entries: [6, 7].map((n) => ed("The Salt Road", 1000100 + n, EN)) }),
      },
      google: () => json({ items: [gItem("g1", "The Salt Road", "en"), gItem("g2", "The Salt Road", "en")] }),
    });
    const measure = sizes({});
    const out = await gatherCandidates(book(), { fetchImpl: s.fetchImpl, googleKey: "k", measure });
    expect(measure.mock.calls.length).toBeLessThanOrEqual(8);
    expect(out).toHaveLength(6);
  });

  it("drops candidates by size, and those that fail to measure", async () => {
    const ids = [1000301, 1000302, 1000303, 1000304, 1000305, 1000306];
    const { fetchImpl } = olEditions(ids);
    const measure = sizes({
      [olUrl(1000301)]: { width: 1, height: 1 },
      [olUrl(1000302)]: { width: 200, height: 300 },
      [olUrl(1000303)]: { width: 400, height: 400 },
      [olUrl(1000304)]: { width: 400, height: 1000 },
      [olUrl(1000305)]: { width: 300, height: 450 },
      [olUrl(1000306)]: null,
    });
    const out = await gatherCandidates(book(), { fetchImpl, googleKey: null, measure: measure as MeasureImage });
    expect(out.map((c) => c.url)).toEqual([olUrl(1000305)]);
  });

  it("clips the edition title to 200 characters", async () => {
    const long = `The Salt Road ${"x".repeat(300)}`;
    const s = stub({
      search: () => json({ docs: [work("/works/OL1W")] }),
      editions: { "/works/OL1W": () => json({ entries: [ed(long, 1000002, EN)] }) },
    });
    const out = await gatherCandidates(book({ title: long }), {
      fetchImpl: s.fetchImpl,
      googleKey: null,
      measure: sizes({}),
    });
    expect(out).toHaveLength(1);
    expect(out[0].editionTitle).toHaveLength(200);
  });

  it("propagates a retryable OpenLibrary error", async () => {
    const { fetchImpl } = stub({ search: () => json({}, 429) });
    await expect(gatherCandidates(book(), { fetchImpl, googleKey: null, measure: sizes({}) })).rejects.toMatchObject({
      retryable: true,
    });
  });
});
