import type { MouseEvent } from "react";
import type { BookWithCopies } from "@/lib/types";
import { useCopyPhotoUrls } from "@/hooks/useCopyPhotoUrls";
import { saveScrollAnchor } from "@/lib/library-view";
import BookCard from "./BookCard";

/** Select mode: which books are ticked, and how a tap toggles one. */
export interface WallSelection {
  ids: ReadonlySet<string>;
  toggle(bookId: string): void;
}

export default function CoverWall({
  books,
  viewKey,
  selection,
}: {
  books: BookWithCopies[];
  viewKey: string;
  selection?: WallSelection;
}) {
  const photoUrls = useCopyPhotoUrls(books);
  // D9: where the clicked card sits, so going back can put it there again. A tap in select mode
  // ticks the card and opens nothing, so there is nowhere to come back from.
  function onClickCapture(e: MouseEvent<HTMLDivElement>) {
    if (selection) return;
    const card = (e.target as Element).closest("[data-book-id]");
    const bookId = card?.getAttribute("data-book-id");
    if (!card || !bookId) return;
    saveScrollAnchor({ bookId, top: card.getBoundingClientRect().top, scrollY: window.scrollY, viewKey });
  }
  return (
    <div onClickCapture={onClickCapture} className="grid grid-cols-2 gap-3 p-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
      {books.map((b) => (
        <BookCard
          key={b.id}
          book={b}
          photoUrl={photoUrls.get(b.id)}
          selection={selection ? { selected: selection.ids.has(b.id), onToggle: () => selection.toggle(b.id) } : undefined}
        />
      ))}
    </div>
  );
}
