import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { groupTags, isSharedTag, loadTosTags, type TosTag } from "./tos-tags";

const TAGS: TosTag[] = [
  { id: "fantasy", label: "Fantasy", category: "genre" },
  { id: "epistolary", label: "Epistolary", category: "form" },
  { id: "gift", label: "Gift", category: "provenance" },
  { id: "spicy", label: "Spicy", category: "content" },
  { id: "mine", label: "Mine", category: "agency", scope: "reader" },
  { id: "audio", label: "Audio", category: "form", derivedFromType: "audiobook" },
];
const CACHE_KEY = "tpl_tos_book_tags";

function memoryStorage(initial?: string): Storage {
  const map = new Map<string, string>(initial === undefined ? [] : [[CACHE_KEY, initial]]);
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
    key: () => null,
    length: 0,
  } as Storage;
}
const ok = (body: unknown) => ({ ok: true, json: async () => body }) as Response;
const asFetch = (fn: unknown) => fn as typeof fetch;

describe("loadTosTags", () => {
  beforeEach(() => vi.useRealTimers());
  afterEach(() => vi.useRealTimers());

  it("fetches the default same-origin URL and caches the result", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => ok(TAGS));
    const storage = memoryStorage();
    const result = await loadTosTags({ fetchImpl: asFetch(fetchImpl), storage });
    expect(fetchImpl.mock.calls[0][0]).toBe("/tome-of-secrets/assets/data/bookTags.json");
    expect(result).toEqual({ tags: TAGS, stale: false });
    expect(JSON.parse(storage.getItem(CACHE_KEY)!)).toEqual(TAGS);
  });

  it("returns the cached tags, stale, on a 500", async () => {
    const fetchImpl = vi.fn(async () => ({ ok: false, status: 500 }) as Response);
    const storage = memoryStorage(JSON.stringify(TAGS));
    expect(await loadTosTags({ fetchImpl: asFetch(fetchImpl), storage })).toEqual({ tags: TAGS, stale: true });
  });

  it("falls back to the cache when the fetch exceeds 4000 ms", async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
        }),
    );
    const storage = memoryStorage(JSON.stringify(TAGS));
    const pending = loadTosTags({ fetchImpl: asFetch(fetchImpl), storage });
    await vi.advanceTimersByTimeAsync(4000);
    expect(await pending).toEqual({ tags: TAGS, stale: true });
  });

  it("gives an empty stale list with no cache at all", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("offline");
    });
    expect(await loadTosTags({ fetchImpl: asFetch(fetchImpl), storage: memoryStorage() })).toEqual({
      tags: [],
      stale: true,
    });
  });

  it("ignores a corrupt cache", async () => {
    const fetchImpl = vi.fn(async () => ({ ok: false }) as Response);
    const result = await loadTosTags({ fetchImpl: asFetch(fetchImpl), storage: memoryStorage("not json") });
    expect(result).toEqual({ tags: [], stale: true });
  });

  it("tolerates a storage that throws", async () => {
    const storage = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("denied");
      },
    } as unknown as Storage;
    const good = vi.fn(async () => ok(TAGS));
    expect(await loadTosTags({ fetchImpl: asFetch(good), storage })).toEqual({ tags: TAGS, stale: false });
    const bad = vi.fn(async () => ({ ok: false }) as Response);
    expect(await loadTosTags({ fetchImpl: asFetch(bad), storage })).toEqual({ tags: [], stale: true });
  });
});

describe("isSharedTag", () => {
  it("excludes reader-scoped and derived tags", () => {
    expect(isSharedTag({ id: "a", label: "A", category: "genre" })).toBe(true);
    expect(isSharedTag({ id: "a", label: "A", category: "agency", scope: "reader" })).toBe(false);
    expect(isSharedTag({ id: "audio", label: "Audio", category: "form", derivedFromType: "audiobook" })).toBe(false);
  });
});

describe("groupTags", () => {
  it("orders by ToS category and puts unknown ids under Other with the id as label", () => {
    const groups = groupTags(["epistolary", "zzz-unknown", "fantasy", "gift", "spicy"], TAGS);
    expect(groups.map((g) => g.category)).toEqual(["genre", "content", "provenance", "form", "other"]);
    expect(groups[0]).toEqual({ category: "genre", label: "Genre", tags: [{ id: "fantasy", label: "Fantasy" }] });
    expect(groups[4]).toEqual({
      category: "other",
      label: "Other",
      tags: [{ id: "zzz-unknown", label: "zzz-unknown" }],
    });
  });
  it("shows everything as Other when there is no tag list", () => {
    expect(groupTags(["fantasy"], [])).toEqual([
      { category: "other", label: "Other", tags: [{ id: "fantasy", label: "fantasy" }] },
    ]);
  });
});
