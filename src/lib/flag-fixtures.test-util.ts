import type { BookWithCopies, Copy } from "./types";

export function copyFixture(over: Partial<Copy> = {}): Copy {
  return {
    id: Math.random().toString(),
    bookId: "b",
    ownerUserId: null,
    editionNote: null,
    copyNote: null,
    location: null,
    origin: "manual",
    libibId: null,
    photoPath: null,
    intakeItemId: null,
    unhauledAt: null,
    deluxe: false,
    signed: false,
    userEditedFields: [],
    createdAt: "2026-11-12T12:00:00",
    updatedAt: "",
    ...over,
  };
}

export function bookFixture(title: string, copies: Copy[], over: Partial<BookWithCopies> = {}): BookWithCopies {
  return {
    id: title,
    householdId: "h",
    title,
    authors: ["Author"],
    synopsis: null,
    coverUrl: null,
    isbn13: [],
    isbn10: [],
    openlibraryId: null,
    googleBooksId: null,
    pageCount: null,
    publisher: null,
    publishDate: null,
    seriesName: null,
    seriesVolume: null,
    onShelf: copies.length === 0 || copies.some((c) => c.unhauledAt === null),
    userEditedFields: [],
    createdAt: "",
    updatedAt: "",
    copies,
    ...over,
  };
}
