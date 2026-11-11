import { describe, expect, it } from "vitest";
import type { BookWithCopies, Copy, HouseholdMember } from "../types";
import type { Extraction, IntakeItem } from "../photo/types";
import { ELSEWHERE_LINE, ownedExplainLine, ownedInfo, scanFlashKind } from "./owners";

const ISBN = "9780000000002";
const A = "member-a";
const B = "member-b";
const members: HouseholdMember[] = [
  { householdId: "h1", userId: A, displayName: "Avery", createdAt: "2026-01-01T00:00:00Z" },
  { householdId: "h1", userId: B, displayName: "Blake", createdAt: "2026-01-02T00:00:00Z" },
];

let seq = 0;
const copy = (ownerUserId: string | null): Copy => ({
  id: `copy-${++seq}`,
  bookId: "b1",
  ownerUserId,
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
});
const book = (owners: (string | null)[], over: Partial<BookWithCopies> = {}): BookWithCopies => ({
  id: `book-${++seq}`,
  householdId: "h1",
  title: "Salt Road",
  authors: ["Ana Vale"],
  synopsis: null,
  coverUrl: null,
  isbn13: [ISBN],
  isbn10: [],
  openlibraryId: null,
  googleBooksId: null,
  pageCount: null,
  publisher: null,
  publishDate: null,
  seriesName: null,
  seriesVolume: null,
  userEditedFields: [],
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
  copies: owners.map(copy),
  ...over,
});
const extraction = (isbn: string): Extraction => ({
  isBook: true,
  title: "Salt Road",
  subtitle: null,
  authors: [],
  editionClues: [],
  publisher: null,
  isbn,
  confidence: "high",
});
const photoItem = (batchId: string, over: Partial<IntakeItem> = {}): IntakeItem => ({
  id: `item-${++seq}`,
  householdId: "h1",
  uploadedBy: A,
  batchId,
  ownerUserId: null,
  coverPath: "h1/x/cover.jpg",
  titlePagePath: null,
  sourceHash: "hash",
  source: "photo",
  scannedIsbn: null,
  editionLabel: null,
  extraCopy: false,
  discardReason: null,
  status: "ready",
  attempts: 1,
  claimedAt: null,
  retryAt: null,
  extraction: extraction(ISBN),
  lookup: null,
  errorCode: null,
  resultBookId: null,
  createdAt: "2026-01-01T00:00:00Z",
  ...over,
});

const line = (catalog: BookWithCopies[]) => ownedInfo(ISBN, catalog, members, [], "batch-1").line;

describe("ownedInfo", () => {
  it("names a single owner", () => {
    expect(line([book([A])])).toBe("Already in library — Avery's copy");
    expect(line([book([null])])).toBe("Already in library — shared copy");
  });

  it("joins owners in member order, then shared", () => {
    expect(line([book([null, A])])).toBe("Already in library — Avery's and shared copies");
    expect(line([book([B, A])])).toBe("Already in library — Avery's and Blake's copies");
    expect(line([book([null, B, A])])).toBe("Already in library — Avery's, Blake's and shared copies");
  });

  it("names an unknown owner as a former member", () => {
    expect(line([book(["someone-gone"])])).toBe("Already in library — a former member's copy");
  });

  it("is null when the ISBN isn't in the library", () => {
    expect(line([book([A], { isbn13: ["9780000000019"] })])).toBeNull();
    expect(line([])).toBeNull();
  });

  it("matches an ISBN-10 stored on the book", () => {
    expect(line([book([A], { isbn13: [], isbn10: ["0000000000"] })])).toBe("Already in library — Avery's copy");
  });

  it("flags an open item of the same ISBN in another batch only", () => {
    const other = photoItem("batch-2");
    expect(ownedInfo(ISBN, [], members, [other], "batch-1")).toMatchObject({ line: null, elsewhere: true });
    expect(ownedInfo(ISBN, [], members, [photoItem("batch-1")], "batch-1").elsewhere).toBe(false);
    const closed = photoItem("batch-2", { status: "confirmed" });
    expect(ownedInfo(ISBN, [], members, [closed], "batch-1").elsewhere).toBe(false);
    const scan = photoItem("batch-2", { source: "scan", extraction: null, scannedIsbn: ISBN });
    expect(ownedInfo(ISBN, [], members, [scan], "batch-1").elsewhere).toBe(true);
    expect(ELSEWHERE_LINE).toBe("Also waiting in the inbox from another session.");
  });
});

describe("owned wording and flash", () => {
  it("knows whether the scanning owner has a recorded copy", () => {
    expect(ownedInfo(ISBN, [book([A])], members, [], "batch-1", A).recordedForOwner).toBe(true);
    expect(ownedInfo(ISBN, [book([B])], members, [], "batch-1", A).recordedForOwner).toBe(false);
    expect(ownedInfo(ISBN, [book([null])], members, [], "batch-1", null).recordedForOwner).toBe(true);
  });

  it("explains what review does in each case", () => {
    expect(ownedExplainLine(true)).toMatch(/Already recorded.*won't be added/);
    expect(ownedExplainLine(false)).toMatch(/add one for this owner/);
  });

  it("picks the amber flash for owned or elsewhere, green otherwise", () => {
    expect(scanFlashKind({ line: "Already in library � Avery's copy", elsewhere: false })).toBe("notice");
    expect(scanFlashKind({ line: null, elsewhere: true })).toBe("notice");
    expect(scanFlashKind({ line: null, elsewhere: false })).toBe("accept");
  });
});
