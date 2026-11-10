import { useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useHousehold } from "@/contexts/HouseholdContext";
import { editionLabels } from "@/lib/editions";
import { useCatalog } from "@/hooks/useCatalog";
import { createBook } from "@/lib/library-repo";
import { navigate } from "@/lib/router";
import type { BookInput } from "@/lib/types";
import BookForm from "./BookForm";
import CopyForm from "./CopyForm";

const EMPTY: BookInput = {
  title: "",
  authors: [],
  synopsis: null,
  coverUrl: null,
  isbn13: [],
  isbn10: [],
  pageCount: null,
  publisher: null,
  publishDate: null,
};

/** Two-step manual add: book details, then the first copy. */
export default function AddBook() {
  const { household, members } = useHousehold();
  const { user } = useAuth();
  const { books, reload } = useCatalog();
  const [book, setBook] = useState<BookInput | null>(null);
  if (!household) return null;
  const householdId = household.id;

  return (
    <div className="p-4">
      <h2 className="mb-3 text-lg font-semibold">Add a book</h2>
      {book === null ? (
        <BookForm
          initial={EMPTY}
          submitLabel="Next"
          onSubmit={async (v) => setBook(v)}
          onCancel={() => navigate({ name: "library" })}
        />
      ) : (
        <>
          <p className="mb-2 text-sm">First copy of {book.title}</p>
          <CopyForm
            initial={{ ownerUserId: user?.id ?? null, editionNote: null, copyNote: null, location: null }}
            members={members}
            labels={editionLabels(books, [])}
            submitLabel="Add book"
            onSubmit={async (copy) => {
              const created = await createBook(householdId, book, copy);
              await reload();
              navigate({ name: "book", id: created.id });
            }}
            onCancel={() => setBook(null)}
          />
        </>
      )}
    </div>
  );
}
