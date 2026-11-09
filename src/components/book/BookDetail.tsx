import { useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useHousehold } from "@/contexts/HouseholdContext";
import { useCopyPhotoUrls } from "@/hooks/useCopyPhotoUrls";
import { useCatalog } from "@/hooks/useCatalog";
import { addCopy, deleteBook, updateBook } from "@/lib/library-repo";
import { diffPatch, markEdited } from "@/lib/edited-fields";
import { normalizeBookInput } from "@/lib/normalize";
import { navigate } from "@/lib/router";
import type { BookInput, BookWithCopies } from "@/lib/types";
import BookForm from "./BookForm";
import CopyForm from "./CopyForm";
import CopyList from "./CopyList";

const EDITABLE: (keyof BookInput)[] = [
  "title",
  "authors",
  "synopsis",
  "coverUrl",
  "isbn13",
  "isbn10",
  "pageCount",
  "publisher",
  "publishDate",
];

function Cover({ book, photoUrl }: { book: BookWithCopies; photoUrl?: string }) {
  const [failed, setFailed] = useState(false);
  const [photoFailed, setPhotoFailed] = useState(false);
  return (
    <div className="mx-auto aspect-[2/3] w-40 overflow-hidden rounded bg-stone-200 shadow-sm">
      {book.coverUrl && !failed ? (
        <img
          src={book.coverUrl}
          alt={`${book.title} cover`}
          onError={() => setFailed(true)}
          className="h-full w-full object-cover"
        />
      ) : photoUrl && !photoFailed ? (
        <img
          src={photoUrl}
          alt={`${book.title}, photo of our copy`}
          onError={() => setPhotoFailed(true)}
          className="h-full w-full object-cover"
        />
      ) : (
        <div
          data-testid="cover-placeholder"
          className="flex h-full w-full items-center justify-center p-2 text-center text-sm font-semibold"
        >
          {book.title}
        </div>
      )}
    </div>
  );
}

export default function BookDetail({ id }: { id: string }) {
  const { members } = useHousehold();
  const { user } = useAuth();
  const { books, loading, error, reload } = useCatalog();
  const photoUrls = useCopyPhotoUrls(books);
  const [editing, setEditing] = useState(false);
  const [addingCopy, setAddingCopy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  if (loading) return <p className="p-6">Loading…</p>;
  if (error) {
    return (
      <div className="p-6">
        <p role="alert" className="mb-3 text-red-700">
          {error}
        </p>
        <button
          type="button"
          onClick={() => void reload()}
          className="rounded bg-stone-800 px-3 py-2 text-white"
        >
          Retry
        </button>
      </div>
    );
  }
  const book = books.find((b) => b.id === id);
  if (!book) {
    return (
      <div className="p-6">
        <p className="mb-3">Book not found</p>
        <a href="#/" className="underline">
          Back to library
        </a>
      </div>
    );
  }

  // Normalise like the form does, so untidy imported values don't read as user edits.
  const before: BookInput = normalizeBookInput({
    title: book.title,
    authors: book.authors,
    synopsis: book.synopsis,
    coverUrl: book.coverUrl,
    isbn13: book.isbn13,
    isbn10: book.isbn10,
    pageCount: book.pageCount,
    publisher: book.publisher,
    publishDate: book.publishDate,
  });

  async function removeBook() {
    if (!window.confirm("Delete this book and all its copies?")) return;
    setActionError(null);
    try {
      await deleteBook(id);
      await reload();
      navigate({ name: "library" });
    } catch (err) {
      console.error("Failed to delete book", err);
      setActionError("Couldn't delete the book.");
    }
  }

  return (
    <div className="space-y-4 p-4">
      <a href="#/" className="underline">
        Back to library
      </a>
      <Cover key={book.coverUrl ?? ""} book={book} photoUrl={photoUrls.get(book.id)} />
      {editing ? (
        <BookForm
          initial={before}
          submitLabel="Save book"
          onCancel={() => setEditing(false)}
          onSubmit={async (next) => {
            const { changed, patch } = diffPatch(before, next, EDITABLE);
            await updateBook(id, patch, markEdited(book.userEditedFields, changed));
            setEditing(false);
            await reload();
          }}
        />
      ) : (
        <div>
          <h2 className="text-xl font-semibold">{book.title}</h2>
          <p className="text-stone-700">{book.authors.join(", ")}</p>
          {book.synopsis && <p className="mt-2 text-sm">{book.synopsis}</p>}
          <div className="mt-2 flex gap-3 text-sm">
            <button type="button" onClick={() => setEditing(true)} className="underline">
              Edit book
            </button>
            <button type="button" onClick={() => void removeBook()} className="underline">
              Delete book
            </button>
          </div>
        </div>
      )}
      {actionError && (
        <p role="alert" className="text-red-700">
          {actionError}
        </p>
      )}
      <section>
        <h3 className="mb-2 font-semibold">Copies</h3>
        <CopyList
          copies={book.copies}
          members={members}
          onChanged={reload}
          onBookDeleted={() => {
            void reload();
            navigate({ name: "library" });
          }}
        />
        {addingCopy ? (
          <div className="mt-3">
            <CopyForm
              initial={{ ownerUserId: user?.id ?? null, editionNote: null, location: null }}
              members={members}
              submitLabel="Add copy"
              onCancel={() => setAddingCopy(false)}
              onSubmit={async (copy) => {
                await addCopy(id, copy);
                setAddingCopy(false);
                await reload();
              }}
            />
          </div>
        ) : (
          <button type="button" onClick={() => setAddingCopy(true)} className="mt-3 underline">
            Add copy
          </button>
        )}
      </section>
    </div>
  );
}
