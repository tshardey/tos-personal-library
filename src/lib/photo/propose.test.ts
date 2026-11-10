import { describe, expect, it } from "vitest";
import type { BookWithCopies, Copy } from "../types";
import { titleKey } from "../libib/match-keys";
import type { Extraction, IntakeItem, LookupResult } from "./types";
import { trigramSimilarity } from "./similarity";
import { bulkEligible, itemConfidence, proposeMatch, sameOwner, type ProposeInput } from "./propose";

const A = "member-a";
const B = "member-b";

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
const item = (over: Partial<IntakeItem> = {}, ex: Partial<Extraction> | null = {}): IntakeItem => ({
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
  extraction: ex === null ? null : extraction(ex),
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
  updatedAt: "2026-01-01T00:00:00Z",
  copies: [copy({ bookId: id })],
  ...over,
});
const lookup = (over: Partial<LookupResult> = {}): LookupResult => ({
  source: "openlibrary",
  agrees: true,
  title: "Salt Road",
  authors: ["Ana Vale"],
  matchIsbns: [],
  coverUrl: null,
  synopsis: null,
  pageCount: null,
  publishDate: null,
  openlibraryId: null,
  googleBooksId: null,
  ...over,
});
const input = (
  it: IntakeItem,
  catalog: BookWithCopies[] = [],
  more: IntakeItem[] = [],
  over: Partial<ProposeInput> = {},
): ProposeInput => ({ item: it, catalog, openItems: [it, ...more], ...over });
const run = (i: ProposeInput) => proposeMatch(i);
const sim = (a: string, b: string) => trigramSimilarity(titleKey(a), titleKey(b));

describe("sameOwner", () => {
  it("is equal ids or both null", () => {
    expect(sameOwner(A, A)).toBe(true);
    expect(sameOwner(null, null)).toBe(true);
    expect(sameOwner(A, B)).toBe(false);
    expect(sameOwner(null, A)).toBe(false);
    expect(sameOwner(A, null)).toBe(false);
  });
});

describe("query", () => {
  it("prefers overrides and ignores the lookup's title", () => {
    const it = item({ lookup: lookup({ title: "Other Name" }) });
    expect(run(input(it)).query.title).toBe("Salt Road");
    expect(
      run(input(it, [], [], { titleOverride: "Glass Orchard", authorsOverride: ["Bo Lin"] })).query,
    ).toMatchObject({ title: "Glass Orchard", authors: ["Bo Lin"] });
    expect(run(input(it, [], [], { titleOverride: "   " })).query.title).toBe("Salt Road");
  });
});

describe("isbn matching", () => {
  const ISBN13 = "9780000000002";
  it("matches isbn13 and the equivalent isbn10", () => {
    const it = item({}, { title: "Unrelated Words", isbn: ISBN13 });
    const c13 = [book("b13", "Zzz One", { isbn13: [ISBN13] })];
    expect(run(input(it, c13)).candidates).toEqual([{ bookId: "b13", reason: "isbn", score: 1 }]);
    const c10 = [book("b10", "Zzz Two", { isbn10: ["0000000000"] })];
    expect(run(input(it, c10)).candidates[0]).toMatchObject({ bookId: "b10", reason: "isbn" });
  });
  it("accepts an isbn10 on the photo", () => {
    const it = item({}, { title: "Unrelated Words", isbn: "0-00-000000-0" });
    const p = run(input(it, [book("b13", "Zzz One", { isbn13: [ISBN13] })]));
    expect(p.query.isbns).toEqual([ISBN13]);
    expect(p.candidates[0].reason).toBe("isbn");
  });
  it("ignores an invalid-checksum photo isbn", () => {
    const it = item({}, { title: "Unrelated Words", isbn: "9780000000003" });
    const p = run(input(it, [book("b13", "Zzz One", { isbn13: ["9780000000003"] })]));
    expect(p.query.isbns).toEqual([]);
    expect(p.candidates).toEqual([]);
  });
  it("uses lookup isbns only when the lookup agrees", () => {
    const cat = [book("b13", "Zzz One", { isbn13: [ISBN13] })];
    const no = item({ lookup: lookup({ agrees: false, matchIsbns: [ISBN13] }) }, { title: "Unrelated Words" });
    expect(run(input(no, cat)).candidates).toEqual([]);
    expect(run(input(no, cat)).query.isbns).toEqual([]);
    const yes = item(
      { lookup: lookup({ title: "Unrelated Words", matchIsbns: [ISBN13, "bogus"] }) },
      { title: "Unrelated Words" },
    );
    const p = run(input(yes, cat));
    expect(p.query.isbns).toEqual([ISBN13]);
    expect(p.candidates[0]).toMatchObject({ bookId: "b13", reason: "isbn" });
  });
  it("ignores the ISBNs of a lookup that agrees only fuzzily", () => {
    const cat = [book("b13", "Zzz One", { isbn13: [ISBN13] })];
    const fuzzy = item(
      { lookup: lookup({ title: "Unrelated Word", matchIsbns: [ISBN13] }) },
      { title: "Unrelated Words" },
    );
    expect(run(input(fuzzy, cat)).query.isbns).toEqual([]);
    expect(run(input(fuzzy, cat)).candidates).toEqual([]);
  });
  it("keeps a fuzzy lookup's sibling volume from becoming the default", () => {
    // The lookup agreed on the sibling (similar title, same author) and carries its ISBNs.
    const SIBLING = "9780000000019";
    const owned = book("v1", "Ember Road: Book 1", {
      isbn13: [SIBLING],
      copies: [copy({ bookId: "v1", ownerUserId: A })],
    });
    const photo = item(
      { lookup: lookup({ title: "Ember Road: Book 1", matchIsbns: [SIBLING] }) },
      { title: "Ember Road: Book 2" },
    );
    const p = run(input(photo, [owned]));
    expect(p.query.isbns).toEqual([]);
    expect(p.candidates.every((c) => c.reason !== "isbn")).toBe(true);
    expect(p.defaultAction).toEqual({ kind: "new_book" });
  });
});

describe("defaults (D7)", () => {
  const cat = (owner: string | null) => [
    book("x", "Salt Road", { copies: [copy({ bookId: "x", ownerUserId: owner })] }),
  ];
  it("adds a copy when the item's owner has none", () => {
    const p = run(input(item({ ownerUserId: A }), cat(B)));
    expect(p.candidates[0].reason).toBe("same_title");
    expect(p.defaultAction).toEqual({ kind: "add_copy", bookId: "x" });
  });
  it("is already recorded when the owner has a copy", () => {
    expect(run(input(item({ ownerUserId: A }), cat(A))).defaultAction).toEqual({
      kind: "already_recorded",
      bookId: "x",
    });
  });
  it("treats shared with shared as recorded, shared with a member's copy as add", () => {
    expect(run(input(item({ ownerUserId: null }), cat(null))).defaultAction.kind).toBe("already_recorded");
    expect(run(input(item({ ownerUserId: null }), cat(A))).defaultAction.kind).toBe("add_copy");
  });
  it("is already recorded for a libib book of the partner, add_copy for the other owner", () => {
    const c = [
      book("x", "Salt Road", {
        copies: [copy({ bookId: "x", ownerUserId: B, origin: "libib", libibId: "L1" })],
      }),
    ];
    const partner = run(input(item({ ownerUserId: B }), c));
    expect(partner.candidates[0].reason).toBe("same_title");
    expect(partner.defaultAction).toEqual({ kind: "already_recorded", bookId: "x" });
    expect(run(input(item({ ownerUserId: A }), c)).defaultAction).toEqual({ kind: "add_copy", bookId: "x" });
  });
  it("is already recorded after a photo confirm, and never bulk eligible", () => {
    const c = [
      book("x", "Salt Road", { copies: [copy({ bookId: "x", ownerUserId: A, origin: "photo" })] }),
    ];
    const i = input(item({ ownerUserId: A }), c);
    const p = run(i);
    expect(p.candidates[0].reason).toBe("same_title");
    expect(p.defaultAction.kind).toBe("already_recorded");
    expect(bulkEligible(i, p)).toBe(false);
  });
});

describe("series and fuzzy", () => {
  it("series sibling defaults to new_book and is not bulk eligible", () => {
    const i = input(item({}, { title: "Ember Road: Book 2" }), [book("s3", "Ember Road: Book 3")]);
    const p = run(i);
    expect(p.candidates[0]).toMatchObject({ bookId: "s3", reason: "series_sibling" });
    expect(p.defaultAction).toEqual({ kind: "new_book" });
    expect(bulkEligible(i, p)).toBe(false);
  });
  it("flags a misspelling as similar_title, with or without authors", () => {
    const cat = [book("g", "The Glass Orchard")];
    const p = run(input(item({}, { title: "The Glass Orhcard" }), cat));
    expect(p.candidates[0]).toMatchObject({ bookId: "g", reason: "similar_title" });
    expect(p.defaultAction).toEqual({ kind: "new_book" });
    const none = run(input(item({}, { title: "The Glass Orhcard", authors: [] }), cat));
    expect(none.candidates[0]).toMatchObject({ bookId: "g", reason: "similar_title" });
  });
  it("needs 0.8 when authors differ", () => {
    const q = "glass orchard keeper";
    const mid = "glass orchard keepers tale"; // 0.5 to 0.8
    const hi = "glass orchard keeper tale"; // 0.8 or more
    expect(sim(q, mid)).toBeGreaterThanOrEqual(0.5);
    expect(sim(q, mid)).toBeLessThan(0.8);
    expect(sim(q, hi)).toBeGreaterThanOrEqual(0.8);
    const it = () => item({}, { title: q, authors: ["Bo Lin"] });
    expect(run(input(it(), [book("mid", mid)])).candidates).toEqual([]);
    expect(run(input(it(), [book("hi", hi)])).candidates[0]).toMatchObject({
      bookId: "hi",
      reason: "similar_title",
    });
  });
  it("pins the 0.5 threshold with the same author", () => {
    // Find a pair at exactly 0.5 and one just under it, from generated words.
    const words = ["bark", "barn", "bard", "park", "dark", "mark", "bank", "band", "bare", "barks", "barkx"];
    let at: [string, string] | null = null;
    let below: [string, string] | null = null;
    for (const x of words)
      for (const y of words) {
        const s = sim(x, y);
        if (x !== y && s === 0.5) at ??= [x, y];
        if (x !== y && s > 0.4 && s < 0.5) below ??= [x, y];
      }
    expect(at).not.toBeNull();
    expect(below).not.toBeNull();
    const [ax, ay] = at!;
    expect(sim(ax, ay)).toBe(0.5);
    const hit = run(input(item({}, { title: ax }), [book("at", ay)]));
    expect(hit.candidates[0]).toMatchObject({ bookId: "at", reason: "similar_title", score: 0.5 });
    const [bx, by] = below!;
    expect(sim(bx, by)).toBeLessThan(0.5);
    expect(run(input(item({}, { title: bx }), [book("below", by)])).candidates).toEqual([]);
  });
});

describe("empty keys", () => {
  it("needs a title when the key is empty, and an override fixes it", () => {
    const it = item({}, { title: "!!!" });
    const i = input(it, [book("x", "Salt Road")]);
    const p = run(i);
    expect(p.needsTitle).toBe(true);
    expect(p.candidates).toEqual([]);
    expect(bulkEligible(i, p)).toBe(false);
    expect(run(input(it, [], [], { titleOverride: "Salt Road" })).needsTitle).toBe(false);
  });
  it("needs a title when there is no extraction title", () => {
    expect(run(input(item({}, { title: null }))).needsTitle).toBe(true);
  });
});

describe("ranking", () => {
  const ISBN13 = "9780000000002";
  it("orders isbn, same_title, series_sibling, similar_title and caps at 3", () => {
    const cat = [
      book("sim", "Ember Roads"),
      book("ser", "Ember Road: Dawn"),
      book("same", "Ember Road"),
      book("isbn", "Whatever Else", { isbn13: [ISBN13] }),
    ];
    const p = run(input(item({}, { title: "Ember Road", isbn: ISBN13 }), cat));
    expect(p.candidates.map((c) => c.reason)).toEqual(["isbn", "same_title", "series_sibling"]);
    const noIsbn = run(input(item({}, { title: "Ember Road" }), cat));
    expect(noIsbn.candidates.map((c) => c.reason)).toEqual(["same_title", "series_sibling", "similar_title"]);
    const four = run(input(item({}, { title: "Ember Road" }), [...cat, book("sim2", "Ember Roadz")]));
    expect(four.candidates).toHaveLength(3);
  });
  it("lists a book once under its highest reason", () => {
    const it = item({}, { title: "Salt Road", isbn: ISBN13 });
    const p = run(input(it, [book("x", "Salt Road", { isbn13: [ISBN13] })]));
    expect(p.candidates).toEqual([{ bookId: "x", reason: "isbn", score: 1 }]);
  });
  it("is ambiguous with two same_title books, and defaults to the oldest", () => {
    const cat = [
      book("new", "Salt Road", { createdAt: "2026-03-01T00:00:00Z", copies: [] }),
      book("old", "Salt Road", { createdAt: "2026-01-01T00:00:00Z", copies: [] }),
    ];
    const p = run(input(item(), cat));
    expect(p.ambiguous).toBe(true);
    expect(p.candidates.map((c) => c.bookId)).toEqual(["old", "new"]);
    expect(p.defaultAction).toEqual({ kind: "add_copy", bookId: "old" });
    expect(run(input(item(), [cat[0]])).ambiguous).toBe(false);
  });
  it("ranks similar titles by similarity first, then age", () => {
    const it = item({}, { title: "Glass Orchard Keeper" });
    const cat = [
      book("far", "Glass Orchard Keeper Tale", { createdAt: "2026-01-01T00:00:00Z" }),
      book("near", "Glass Orchard Keepers", { createdAt: "2026-02-01T00:00:00Z" }),
    ];
    expect(run(input(it, cat)).candidates.map((c) => c.bookId)).toEqual(["near", "far"]);
  });
});

describe("in-batch twins", () => {
  it("lists each other and blocks bulk", () => {
    const a = item({}, { title: "Salt Road" });
    const b = item({}, { title: "Salt Road" });
    const ia = input(a, [], [b]);
    const ib = input(b, [], [a]);
    expect(run(ia).inBatchTwins).toEqual([b.id]);
    expect(run(ib).inBatchTwins).toEqual([a.id]);
    expect(bulkEligible(ia, run(ia))).toBe(false);
    expect(bulkEligible(ib, run(ib))).toBe(false);
  });
  it("treats an article difference as a twin", () => {
    const a = item({}, { title: "Glass Orchard" });
    const b = item({}, { title: "The Glass Orchard" });
    expect(run(input(a, [], [b])).inBatchTwins).toEqual([b.id]);
    expect(run(input(b, [], [a])).inBatchTwins).toEqual([a.id]);
  });
  it("treats a near-identical title (0.8 or more) with overlapping authors as a twin", () => {
    const a = item({}, { title: "The Glass Orchard" });
    const b = item({}, { title: "The Glass Orchards" });
    expect(run(input(a, [], [b])).inBatchTwins).toEqual([b.id]);
    const c = item({}, { title: "The Glass Orchards", authors: ["Bo Lin"] });
    expect(run(input(a, [], [c])).inBatchTwins).toEqual([]);
  });
  it("skips items without an extraction, empty keys and closed items", () => {
    const a = item({}, { title: "Salt Road" });
    const none = item({}, null);
    const empty = item({}, { title: "!!!" });
    const done = item({ status: "confirmed" }, { title: "Salt Road" });
    expect(run(input(a, [], [none, empty, done])).inBatchTwins).toEqual([]);
  });
  it("uses the typed override for this item", () => {
    const a = item({}, { title: "!!!" });
    const b = item({}, { title: "Salt Road" });
    expect(run(input(a, [], [b], { titleOverride: "Salt Road" })).inBatchTwins).toEqual([b.id]);
  });
});

describe("bulkEligible", () => {
  it("is true for a clean ready high-confidence item", () => {
    const i = input(item({ status: "ready" }, { confidence: "high" }));
    expect(bulkEligible(i, run(i))).toBe(true);
  });
  it("is false when each condition is flipped alone", () => {
    const no = (i: ProposeInput) => expect(bulkEligible(i, run(i))).toBe(false);
    no(input(item({}, { confidence: "medium" })));
    no(input(item({ status: "failed" })));
    no(input(item({}, { title: null })));
    no(input(item({}, null)));
    no(input(item(), [], [item()]));
    const ISBN13 = "9780000000002";
    const reasons: Array<[string, Partial<Extraction>, Partial<BookWithCopies>]> = [
      ["Salt Road", {}, {}],
      ["Salt Road: Part Two", {}, {}],
      ["Salt Roads", {}, {}],
      ["Elsewhere Entirely", { isbn: ISBN13 }, { isbn13: [ISBN13] }],
    ];
    for (const [title, ex, over] of reasons) {
      const i = input(item({}, ex), [book("x", title, over)]);
      expect(run(i).candidates.length).toBeGreaterThan(0);
      no(i);
    }
  });
});

describe("purity", () => {
  it("is deterministic and does not mutate inputs", () => {
    const a = item({}, { title: "Salt Road" });
    const b = item({}, { title: "Salt Road" });
    const i = input(a, [book("x", "Salt Roads"), book("y", "Salt Road")], [b], {
      authorsOverride: ["Ana Vale"],
    });
    const before = structuredClone(i);
    const p1 = run(i);
    expect(run(i)).toEqual(p1);
    expect(bulkEligible(i, p1)).toBe(false);
    expect(i).toEqual(before);
  });
  it("still holds with scans, scanned ISBNs, edition labels and extra copies", () => {
    const s = scan({ extraCopy: true, editionLabel: "Invented foil" });
    const twin = scan({ batchId: s.batchId });
    const photo = item(
      { scannedIsbn: SCANNED, lookup: lookup({ byIsbn: true, title: "Other Name" }) },
      { title: "Glass Orchard" },
    );
    const cat = [book("x", "Salt Road", { isbn13: [SCANNED] })];
    for (const it of [s, photo]) {
      const i = input(it, cat, [twin, it === s ? photo : s]);
      const before = structuredClone(i);
      const p1 = run(i);
      expect(run(i)).toEqual(p1);
      expect(itemConfidence(i.item, p1)).toBe(itemConfidence(i.item, run(i)));
      expect(bulkEligible(i, p1)).toBe(false);
      expect(i).toEqual(before);
    }
  });
});

const SCANNED = "9780000000002";
const OTHER = "9780000000019";
/** A scan: no extraction, no photo; by default a found byIsbn lookup "Salt Road" by "A. Writer". */
function scan(over: Partial<IntakeItem> = {}): IntakeItem {
  return item(
    {
      source: "scan",
      coverPath: null,
      sourceHash: null,
      scannedIsbn: SCANNED,
      lookup: lookup({ byIsbn: true, title: "Salt Road", authors: ["A. Writer"], matchIsbns: [SCANNED] }),
      ...over,
    },
    null,
  );
}
const notFound = (): LookupResult =>
  lookup({ source: "none", agrees: false, title: null, authors: [], matchIsbns: [] });

describe("scan query (D9)", () => {
  it("a found scan with an empty catalog proposes a high-confidence, bulk-eligible new book", () => {
    const i = input(scan());
    const p = run(i);
    expect(p.query).toEqual({ title: "Salt Road", authors: ["A. Writer"], isbns: [SCANNED] });
    expect(p.defaultAction).toEqual({ kind: "new_book" });
    expect(p.needsTitle).toBe(false);
    expect(p.isbnConflict).toBe(false);
    expect(p.repeatScan).toBe(false);
    expect(itemConfidence(i.item, p)).toBe("high");
    expect(bulkEligible(i, p)).toBe(true);
  });
  it("a not-found scan needs a title, is low and never eligible", () => {
    const i = input(scan({ lookup: notFound() }));
    const p = run(i);
    expect(p.needsTitle).toBe(true);
    expect(itemConfidence(i.item, p)).toBe("low");
    expect(bulkEligible(i, p)).toBe(false);
  });
  it("a scan not yet looked up isn't eligible", () => {
    const i = input(scan({ lookup: null }));
    const p = run(i);
    expect(itemConfidence(i.item, p)).toBe("low");
    expect(bulkEligible(i, p)).toBe(false);
  });
  it("a typed title still wins over the lookup's", () => {
    expect(run(input(scan(), [], [], { titleOverride: "Glass Orchard" })).query.title).toBe("Glass Orchard");
  });
  it("a photo's lookup title is still ignored unless the lookup was by ISBN", () => {
    const it = item({ lookup: lookup({ title: "Other Name" }) }, { title: null });
    expect(run(input(it)).needsTitle).toBe(true);
  });
});

describe("the ISBN wins (D9)", () => {
  it("a scan of a catalog book's ISBN matches by isbn", () => {
    const p = run(input(scan(), [book("b1", "Zzz Unrelated", { isbn13: [SCANNED] })]));
    expect(p.candidates[0]).toEqual({ bookId: "b1", reason: "isbn", score: 1 });
  });
  it("a photo's scanned ISBN comes first and matches over a different title and extraction ISBN", () => {
    const it = item({ scannedIsbn: SCANNED }, { title: "Copper Lantern", isbn: OTHER });
    const p = run(input(it, [book("b1", "Zzz Unrelated", { isbn13: [SCANNED] })]));
    expect(p.query.isbns[0]).toBe(SCANNED);
    expect(p.candidates[0]).toMatchObject({ bookId: "b1", reason: "isbn" });
  });
  it("ranks the scanned ISBN's book above an older book matching the extraction ISBN", () => {
    const it = item({ scannedIsbn: SCANNED, ownerUserId: A }, { title: "Copper Lantern", isbn: OTHER });
    const cat = [
      book("old", "Zzz Older", { isbn13: [OTHER], createdAt: "2025-01-01T00:00:00Z", copies: [] }),
      book("scanned", "Zzz Newer", { isbn13: [SCANNED], createdAt: "2026-06-01T00:00:00Z", copies: [] }),
    ];
    for (const order of [cat, [...cat].reverse()]) {
      const p = run(input(it, order));
      expect(p.query.isbns).toEqual([SCANNED, OTHER]);
      expect(p.candidates.map((c) => c.bookId)).toEqual(["scanned", "old"]);
      expect(p.defaultAction).toEqual({ kind: "add_copy", bookId: "scanned" });
    }
  });
});

describe("isbnConflict (Review Focus 4)", () => {
  it("is set when Claude's title disagrees with the byIsbn lookup, capping confidence at medium", () => {
    const it = item(
      { scannedIsbn: SCANNED, lookup: lookup({ byIsbn: true, title: "Salt Road", matchIsbns: [SCANNED] }) },
      { title: "Glass Orchard", confidence: "high" },
    );
    const i = input(it);
    const p = run(i);
    expect(p.isbnConflict).toBe(true);
    expect(itemConfidence(it, p)).toBe("medium");
    expect(bulkEligible(i, p)).toBe(false);
  });
  it("is not set when the byIsbn lookup agrees with Claude's title", () => {
    const it = item(
      { scannedIsbn: SCANNED, lookup: lookup({ byIsbn: true, title: "The Glass Orchard", matchIsbns: [SCANNED] }) },
      { title: "Glass Orchard" },
    );
    const i = input(it);
    const p = run(i);
    expect(p.isbnConflict).toBe(false);
    expect(itemConfidence(it, p)).toBe("high");
    expect(bulkEligible(i, p)).toBe(true);
  });
  it("uses the catalog book matched by isbn when there is no byIsbn lookup", () => {
    const it = item({ scannedIsbn: SCANNED, lookup: null }, { title: "Glass Orchard" });
    const p = run(input(it, [book("b1", "Salt Road", { isbn13: [SCANNED] })]));
    expect(p.candidates[0]).toMatchObject({ bookId: "b1", reason: "isbn" });
    expect(p.isbnConflict).toBe(true);
    const same = run(input(it, [book("b1", "The Glass Orchard", { isbn13: [SCANNED] })]));
    expect(same.isbnConflict).toBe(false);
  });
  it("is not set when Claude read no title, or there is no scanned ISBN", () => {
    const blank = item(
      { scannedIsbn: SCANNED, lookup: lookup({ byIsbn: true, title: "Salt Road" }) },
      { title: "   " },
    );
    expect(run(input(blank)).isbnConflict).toBe(false);
    const noScan = item({}, { title: "Glass Orchard", isbn: SCANNED });
    expect(run(input(noScan, [book("b1", "Salt Road", { isbn13: [SCANNED] })])).isbnConflict).toBe(false);
  });
  it("is never set for a scan", () => {
    expect(run(input(scan(), [book("b1", "Glass Orchard", { isbn13: [SCANNED] })])).isbnConflict).toBe(false);
  });
});

describe("ISBN twins and repeat scans (D9)", () => {
  it("two open scans of one ISBN in different batches are twins, and neither is eligible", () => {
    const a = scan({ batchId: "batch-1" });
    const b = scan({ batchId: "batch-2" });
    const ia = input(a, [], [b]);
    const ib = input(b, [], [a]);
    expect(run(ia).inBatchTwins).toEqual([b.id]);
    expect(run(ib).inBatchTwins).toEqual([a.id]);
    expect(run(ia).repeatScan).toBe(false);
    expect(bulkEligible(ia, run(ia))).toBe(false);
    expect(bulkEligible(ib, run(ib))).toBe(false);
  });
  it("a same-batch twin where either is extraCopy is a repeat scan", () => {
    const a = scan();
    const b = scan({ extraCopy: true });
    expect(run(input(a, [], [b])).repeatScan).toBe(true);
    expect(run(input(b, [], [a])).repeatScan).toBe(true);
    expect(run(input(a, [], [scan()])).repeatScan).toBe(false);
    expect(run(input(scan({ batchId: "batch-2", extraCopy: true }), [], [a])).repeatScan).toBe(false);
  });
  it("a photo whose extraction ISBN equals an open scan's ISBN is a twin", () => {
    const s = scan({ lookup: notFound() });
    const photo = item({}, { title: "Copper Lantern", isbn: SCANNED });
    expect(run(input(photo, [], [s])).inBatchTwins).toEqual([s.id]);
    expect(run(input(s, [], [photo])).inBatchTwins).toEqual([photo.id]);
  });
  it("ignores closed items and different ISBNs", () => {
    const a = scan();
    const replaced = scan({ status: "discarded", discardReason: "replaced_by_photo" });
    const other = scan({
      scannedIsbn: OTHER,
      lookup: lookup({ byIsbn: true, title: "Copper Lantern", matchIsbns: [OTHER] }),
    });
    expect(run(input(a, [], [replaced, other])).inBatchTwins).toEqual([]);
  });
  it("a found scan and a photo of the same title are twins both ways", () => {
    const s = scan({ lookup: lookup({ byIsbn: true, title: "Salt Road", matchIsbns: [SCANNED] }) });
    const photo = item({}, { title: "Salt Road" });
    expect(run(input(s, [], [photo])).inBatchTwins).toEqual([photo.id]);
    expect(run(input(photo, [], [s])).inBatchTwins).toEqual([s.id]);
  });
});

describe("extraCopy default (Review Focus 5)", () => {
  const owned = () => [
    book("x", "Salt Road", { isbn13: [SCANNED], copies: [copy({ bookId: "x", ownerUserId: A })] }),
  ];
  it("an extraCopy scan for an owner who has a copy defaults to add_copy", () => {
    const i = input(scan({ ownerUserId: A, extraCopy: true }), owned());
    const p = run(i);
    expect(p.candidates[0].reason).toBe("isbn");
    expect(p.defaultAction).toEqual({ kind: "add_copy", bookId: "x" });
    expect(bulkEligible(i, p)).toBe(false);
  });
  it("the same scan without extraCopy is already recorded", () => {
    expect(run(input(scan({ ownerUserId: A }), owned())).defaultAction).toEqual({
      kind: "already_recorded",
      bookId: "x",
    });
  });
  it("extraCopy doesn't turn a same_title match into add_copy", () => {
    const c = [book("x", "Salt Road", { copies: [copy({ bookId: "x", ownerUserId: A })] })];
    expect(run(input(item({ ownerUserId: A, extraCopy: true }), c)).defaultAction.kind).toBe("already_recorded");
  });
});

describe("itemConfidence", () => {
  it("is a photo's extraction confidence, and low without an extraction", () => {
    for (const c of ["high", "medium", "low"] as const) {
      const it = item({}, { confidence: c });
      expect(itemConfidence(it, run(input(it)))).toBe(c);
    }
    const none = item({}, null);
    expect(itemConfidence(none, run(input(none)))).toBe("low");
  });
  it("leaves low at low when there is a conflict", () => {
    const it = item(
      { scannedIsbn: SCANNED, lookup: lookup({ byIsbn: true, title: "Salt Road" }) },
      { title: "Glass Orchard", confidence: "low" },
    );
    expect(itemConfidence(it, run(input(it)))).toBe("low");
  });
});

describe("unresolved scanned ISBN (Review Focus 4)", () => {
  it("caps a high photo at medium when its scanned ISBN was not found and no catalog book owns it", () => {
    const it = item({ scannedIsbn: SCANNED, lookup: notFound() }, { title: "Glass Orchard", confidence: "high" });
    const i = input(it);
    const p = run(i);
    expect(p.isbnConflict).toBe(false);
    expect(p.scannedIsbnUnresolved).toBe(true);
    expect(itemConfidence(it, p)).toBe("medium");
    expect(bulkEligible(i, p)).toBe(false);
    const noLookup = item({ scannedIsbn: SCANNED, lookup: null }, { title: "Glass Orchard", confidence: "high" });
    expect(itemConfidence(noLookup, run(input(noLookup, [book("b1", "Glass Orchard")])))).toBe("medium");
  });
  it("is unchanged once a byIsbn lookup agrees", () => {
    const it = item(
      { scannedIsbn: SCANNED, lookup: lookup({ byIsbn: true, title: "Glass Orchard", matchIsbns: [SCANNED] }) },
      { title: "Glass Orchard", confidence: "high" },
    );
    const i = input(it);
    const p = run(i);
    expect(p.scannedIsbnUnresolved).toBe(false);
    expect(itemConfidence(it, p)).toBe("high");
    expect(bulkEligible(i, p)).toBe(true);
  });
  it("is resolved by a catalog book that owns the scanned ISBN", () => {
    const it = item({ scannedIsbn: SCANNED, lookup: notFound() }, { title: "Glass Orchard", confidence: "high" });
    const p = run(input(it, [book("b1", "Glass Orchard", { isbn13: [SCANNED] })]));
    expect(p.scannedIsbnUnresolved).toBe(false);
    expect(itemConfidence(it, p)).toBe("high");
  });
  it("does not apply to a photo without a scanned ISBN, or to a scan", () => {
    const plain = item({}, { confidence: "high" });
    expect(run(input(plain)).scannedIsbnUnresolved).toBe(false);
    expect(run(input(scan({ lookup: notFound() }))).scannedIsbnUnresolved).toBe(false);
  });
});
