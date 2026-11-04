import { useMemo, useState } from "react";
import { useHousehold } from "@/contexts/HouseholdContext";
import { useCatalog } from "@/hooks/useCatalog";
import { filterBooks, type OwnerFilter } from "@/lib/filter-books";
import { navigate } from "@/lib/router";
import CoverWall from "./CoverWall";
import LibraryFilters from "./LibraryFilters";

export default function LibraryPage() {
  const { members } = useHousehold();
  const { books, loading, error, reload } = useCatalog();
  const [query, setQuery] = useState("");
  const [owner, setOwner] = useState<OwnerFilter>("all");
  const visible = useMemo(() => filterBooks(books, { query, owner }), [books, query, owner]);

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
  if (books.length === 0) {
    return (
      <div className="p-6 text-center">
        <p className="mb-3">No books yet</p>
        <button
          type="button"
          onClick={() => navigate({ name: "add" })}
          className="rounded bg-stone-800 px-3 py-2 text-white"
        >
          Add a book
        </button>
      </div>
    );
  }
  return (
    <div>
      <LibraryFilters
        query={query}
        owner={owner}
        members={members}
        onQuery={setQuery}
        onOwner={setOwner}
      />
      {visible.length === 0 ? (
        <p className="p-6 text-center">No matching books</p>
      ) : (
        <CoverWall books={visible} />
      )}
    </div>
  );
}
