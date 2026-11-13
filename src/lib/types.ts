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
  seriesName: string | null;
  seriesVolume: number | null;
  /** Computed by the database: true when the book has a copy that hasn't been unhauled. */
  onShelf: boolean;
  userEditedFields: string[];
  createdAt: string;
  updatedAt: string;
}

export type CopyOrigin = "libib" | "photo" | "manual" | "scan";

export interface Copy {
  id: string;
  bookId: string;
  /** null = shared household copy */
  ownerUserId: string | null;
  editionNote: string | null;
  copyNote: string | null;
  location: string | null;
  origin: CopyOrigin;
  libibId: string | null;
  photoPath: string | null;
  intakeItemId: string | null;
  /** When the household let this copy go; null = still on the shelf. */
  unhauledAt: string | null;
  deluxe: boolean;
  signed: boolean;
  userEditedFields: string[];
  createdAt: string;
  updatedAt: string;
}

export interface CopyFlagsPatch {
  unhauledAt?: string | null;
  deluxe?: boolean;
  signed?: boolean;
}

/** Editable copy fields and flags together, for one write. */
export type CopyPatch = Partial<CopyInput> & CopyFlagsPatch;

export type BookWithCopies = Book & { copies: Copy[] };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Row = Record<string, any>;

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
  seriesName: "series_name",
  seriesVolume: "series_volume",
  onShelf: "on_shelf",
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
    seriesName: row.series_name ?? null,
    seriesVolume: row.series_volume ?? null,
    onShelf: row.on_shelf !== false,
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
    copyNote: row.copy_note ?? null,
    location: row.location ?? null,
    origin: row.origin,
    libibId: row.libib_id ?? null,
    photoPath: row.photo_path ?? null,
    intakeItemId: row.intake_item_id ?? null,
    unhauledAt: row.unhauled_at ?? null,
    deluxe: row.deluxe ?? false,
    signed: row.signed ?? false,
    userEditedFields: row.user_edited_fields ?? [],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Book keys callers may write; ids, household and bookkeeping columns are never patched from here. */
const BOOK_EDITABLE: readonly (keyof Book)[] = [
  "title",
  "authors",
  "synopsis",
  "coverUrl",
  "isbn13",
  "isbn10",
  "openlibraryId",
  "googleBooksId",
  "pageCount",
  "publisher",
  "publishDate",
  "seriesName",
  "seriesVolume",
];

/** Maps a camelCase partial book to snake_case columns, skipping undefined values. */
export function fromBookPatch(patch: Partial<Book>): Row {
  const out: Row = {};
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    if (!BOOK_EDITABLE.includes(key as keyof Book)) continue;
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
  copyNote: string | null;
  location: string | null;
}

const COPY_COLUMNS = {
  ownerUserId: "owner_user_id",
  editionNote: "edition_note",
  copyNote: "copy_note",
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
