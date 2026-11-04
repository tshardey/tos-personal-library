import type { BookWithCopies } from "@/lib/types";
import BookCard from "./BookCard";

export default function CoverWall({ books }: { books: BookWithCopies[] }) {
  return (
    <div className="grid grid-cols-2 gap-3 p-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
      {books.map((b) => (
        <BookCard key={b.id} book={b} />
      ))}
    </div>
  );
}
