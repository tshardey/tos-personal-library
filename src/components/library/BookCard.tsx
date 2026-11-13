import { useState } from "react";
import type { BookWithCopies } from "@/lib/types";
import { bookBadges } from "@/lib/copy-flags";
import { routeToHash } from "@/lib/router";

export default function BookCard({ book, photoUrl }: { book: BookWithCopies; photoUrl?: string }) {
  const [failed, setFailed] = useState(false);
  const [photoFailed, setPhotoFailed] = useState(false);
  const author = book.authors[0];
  const badges = bookBadges(book);
  const badgeLabels = [badges.unhauled && "Unhauled", badges.deluxe && "Deluxe", badges.signed && "Signed"].filter(
    (l): l is string => !!l,
  );
  return (
    <a href={routeToHash({ name: "book", id: book.id })} data-book-id={book.id} className="block">
      <div className="aspect-[2/3] overflow-hidden rounded bg-stone-200 shadow-sm">
        {book.coverUrl && !failed ? (
          <img
            src={book.coverUrl}
            alt={`${book.title} cover`}
            loading="lazy"
            onError={() => setFailed(true)}
            className="h-full w-full object-cover"
          />
        ) : photoUrl && !photoFailed ? (
          <img
            src={photoUrl}
            alt={`${book.title}, photo of our copy`}
            loading="lazy"
            onError={() => setPhotoFailed(true)}
            className="h-full w-full object-cover"
          />
        ) : (
          <div
            data-testid="cover-placeholder"
            className="flex h-full w-full flex-col items-center justify-center gap-1 p-2 text-center"
          >
            <span className="line-clamp-4 text-sm font-semibold">{book.title}</span>
            {author && <span className="line-clamp-2 text-xs text-stone-600">{author}</span>}
          </div>
        )}
      </div>
      <div className="mt-1">
        <p className="line-clamp-2 text-sm font-medium leading-tight">{book.title}</p>
        {author && <p className="line-clamp-1 text-xs text-stone-600">{author}</p>}
        {badgeLabels.length > 0 && (
          <p className="mt-0.5 flex flex-wrap gap-1 text-[11px] text-stone-600">
            {badgeLabels.map((l) => (
              <span key={l} className="rounded bg-stone-100 px-1.5">
                {l}
              </span>
            ))}
          </p>
        )}
      </div>
    </a>
  );
}
