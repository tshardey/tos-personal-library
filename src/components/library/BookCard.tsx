import { useState } from "react";
import type { BookWithCopies } from "@/lib/types";
import { bookBadges } from "@/lib/copy-flags";
import { routeToHash } from "@/lib/router";
import { Badge } from "@/components/ui";

/** In select mode a card is a tickbox instead of a link to the book. */
export interface CardSelection {
  selected: boolean;
  onToggle(): void;
}

export default function BookCard({
  book,
  photoUrl,
  selection,
  readState,
  showText = true,
}: {
  book: BookWithCopies;
  photoUrl?: string;
  selection?: CardSelection;
  /** The viewer's own read state; unread books show nothing. */
  readState?: "read" | "dnf";
  /** False at the smallest cover size: the text is visually hidden but still names the link. */
  showText?: boolean;
}) {
  const [failed, setFailed] = useState(false);
  const [photoFailed, setPhotoFailed] = useState(false);
  const author = book.authors[0];
  const badges = bookBadges(book);
  const badgeLabels = [badges.unhauled && "Unhauled", badges.deluxe && "Deluxe", badges.signed && "Signed"].filter(
    (l): l is string => !!l,
  );
  const body = (
    <>
      <div
        className={`relative aspect-[2/3] overflow-hidden rounded bg-control shadow-sm ${
          selection?.selected ? "ring-2 ring-accent ring-offset-2 ring-offset-surface" : ""
        }`}
      >
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
            {author && <span className="line-clamp-2 text-xs text-muted">{author}</span>}
          </div>
        )}
        {badgeLabels.length > 0 && (
          <div className="absolute bottom-1.5 left-1.5 right-1.5 flex flex-wrap gap-1">
            {badgeLabels.map((l) => (
              <Badge key={l}>{l}</Badge>
            ))}
          </div>
        )}
        {readState && (
          <div className="absolute right-1.5 top-1.5">
            <Badge tone={readState === "read" ? "success" : "muted"}>{readState === "read" ? "✓ Read" : "DNF"}</Badge>
          </div>
        )}
      </div>
      <div className={showText ? "mt-1.5" : "sr-only"}>
        <p className={`${showText ? "line-clamp-1" : "sr-only"} text-sm font-medium leading-tight`}>{book.title}</p>
        {author && <p className={`${showText ? "line-clamp-1" : "sr-only"} text-xs text-muted`}>{author}</p>}
      </div>
    </>
  );
  if (selection) {
    return (
      <label data-book-id={book.id} className="relative block cursor-pointer">
        <input
          type="checkbox"
          checked={selection.selected}
          onChange={selection.onToggle}
          aria-label={`Select ${book.title}`}
          className="absolute left-1.5 top-1.5 z-[1] size-6 accent-accent"
        />
        {body}
      </label>
    );
  }
  return (
    <a href={routeToHash({ name: "book", id: book.id })} data-book-id={book.id} className="block">
      {body}
    </a>
  );
}
