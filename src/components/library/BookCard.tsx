import type { BookWithCopies } from "@/lib/types";
import { routeToHash } from "@/lib/router";

export default function BookCard({ book }: { book: BookWithCopies }) {
  return (
    <a
      href={routeToHash({ name: "book", id: book.id })}
      className="block aspect-[2/3] overflow-hidden rounded bg-stone-200 shadow-sm"
    >
      {book.coverUrl ? (
        <img
          src={book.coverUrl}
          alt={`${book.title} cover`}
          loading="lazy"
          className="h-full w-full object-cover"
        />
      ) : (
        <div className="flex h-full w-full flex-col items-center justify-center gap-1 p-2 text-center">
          <span className="line-clamp-4 text-sm font-semibold">{book.title}</span>
          {book.authors[0] && (
            <span className="line-clamp-2 text-xs text-stone-600">{book.authors[0]}</span>
          )}
        </div>
      )}
    </a>
  );
}
