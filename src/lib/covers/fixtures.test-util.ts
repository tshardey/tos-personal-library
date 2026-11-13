import type { BookWithCopies } from "../types";
import type { CoverSearch, CoverSearchStatus } from "./types";

export function mkBook(id: string, over: Partial<BookWithCopies> = {}): BookWithCopies {
  return {
    id,
    householdId: "h1",
    title: "The Salt Road",
    authors: ["Member A"],
    synopsis: null,
    coverUrl: "https://covers.openlibrary.org/b/id/1000001-L.jpg",
    isbn13: [],
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
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    copies: [],
    ...over,
  };
}

export function mkSearch(
  id: string,
  bookId: string,
  status: CoverSearchStatus,
  over: Partial<CoverSearch> = {},
): CoverSearch {
  return {
    id,
    householdId: "h1",
    bookId,
    requestedBy: null,
    batchId: "b1",
    reasons: [],
    note: null,
    coverAtRequest: null,
    status,
    attempts: 0,
    claimedAt: null,
    retryAt: null,
    candidates: null,
    results: [],
    errorCode: null,
    seenAt: null,
    createdAt: "2026-11-01T00:00:00Z",
    book: null,
    ...over,
  };
}
