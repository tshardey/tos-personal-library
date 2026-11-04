export interface Household {
  id: string;
  name: string;
  inviteCode: string;
  createdAt: string;
}

export interface HouseholdMember {
  householdId: string;
  userId: string;
  displayName: string;
  createdAt: string;
}

export interface Book {
  id: string;
  householdId: string;
  title: string;
  authors: string[];
  synopsis: string | null;
  coverUrl: string | null;
  isbn13: string[];
  isbn10: string[];
  openlibraryId: string | null;
  googleBooksId: string | null;
  pageCount: number | null;
  publisher: string | null;
  publishDate: string | null;
  userEditedFields: string[];
  createdAt: string;
  updatedAt: string;
}

export type CopyOrigin = "libib" | "photo" | "manual";

export interface Copy {
  id: string;
  bookId: string;
  /** null = shared household copy */
  ownerUserId: string | null;
  editionNote: string | null;
  location: string | null;
  origin: CopyOrigin;
  libibId: string | null;
  photoPath: string | null;
  userEditedFields: string[];
  createdAt: string;
  updatedAt: string;
}

export type BookWithCopies = Book & { copies: Copy[] };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;

const BOOK_COLUMNS = {
  id: "id",
  householdId: "household_id",
  title: "title",
  authors: "authors",
  synopsis: "synopsis",
  coverUrl: "cover_url",
  isbn13: "isbn13",
  isbn10: "isbn10",
  openlibraryId: "openlibrary_id",
  googleBooksId: "google_books_id",
  pageCount: "page_count",
  publisher: "publisher",
  publishDate: "publish_date",
  userEditedFields: "user_edited_fields",
  createdAt: "created_at",
  updatedAt: "updated_at",
} as const satisfies Record<keyof Book, string>;

export function toBook(row: Row): Book {
  return {
    id: row.id,
    householdId: row.household_id,
    title: row.title,
    authors: row.authors ?? [],
    synopsis: row.synopsis ?? null,
    coverUrl: row.cover_url ?? null,
    isbn13: row.isbn13 ?? [],
    isbn10: row.isbn10 ?? [],
    openlibraryId: row.openlibrary_id ?? null,
    googleBooksId: row.google_books_id ?? null,
    pageCount: row.page_count ?? null,
    publisher: row.publisher ?? null,
    publishDate: row.publish_date ?? null,
    userEditedFields: row.user_edited_fields ?? [],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function toCopy(row: Row): Copy {
  return {
    id: row.id,
    bookId: row.book_id,
    ownerUserId: row.owner_user_id ?? null,
    editionNote: row.edition_note ?? null,
    location: row.location ?? null,
    origin: row.origin,
    libibId: row.libib_id ?? null,
    photoPath: row.photo_path ?? null,
    userEditedFields: row.user_edited_fields ?? [],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Maps a camelCase partial book to snake_case columns, skipping undefined values. */
export function fromBookPatch(patch: Partial<Book>): Row {
  const out: Row = {};
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    const column = BOOK_COLUMNS[key as keyof Book];
    if (column) out[column] = value;
  }
  return out;
}

export interface BookInput {
  title: string;
  authors: string[];
  synopsis: string | null;
  coverUrl: string | null;
  isbn13: string[];
  isbn10: string[];
  pageCount: number | null;
  publisher: string | null;
  publishDate: string | null;
}

export interface CopyInput {
  ownerUserId: string | null;
  editionNote: string | null;
  location: string | null;
}

const COPY_COLUMNS = {
  ownerUserId: "owner_user_id",
  editionNote: "edition_note",
  location: "location",
} as const satisfies Record<keyof CopyInput, string>;

/** Maps a camelCase partial copy to snake_case columns, skipping undefined values. */
export function fromCopyPatch(patch: Partial<CopyInput>): Row {
  const out: Row = {};
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    const column = COPY_COLUMNS[key as keyof CopyInput];
    if (column) out[column] = value;
  }
  return out;
}
