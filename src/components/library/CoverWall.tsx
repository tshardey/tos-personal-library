import type { CSSProperties, MouseEvent } from "react";
import type { BookWithCopies } from "@/lib/types";
import { useCopyPhotoUrls } from "@/hooks/useCopyPhotoUrls";
import { COVER_STEPS, DEFAULT_COVER_SIZE, type CoverSize } from "@/lib/cover-size";
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
  size = DEFAULT_COVER_SIZE,
}: {
  books: BookWithCopies[];
  viewKey: string;
  selection?: WallSelection;
  size?: CoverSize;
}) {
  const step = COVER_STEPS[size];
  // D4: index.css's .cover-grid reads these (phone columns below 640px, a min card width from 640px).
  const gridVars = {
    "--cover-cols": String(step.phoneCols),
    "--cover-min": `${step.minPx}px`,
    "--cover-gap": `${step.gapPx}px`,
  } as CSSProperties;
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
    <div
      onClickCapture={onClickCapture}
      data-cover-size={size}
      style={gridVars}
      className="cover-grid px-4 py-3 sm:px-6"
    >
      {books.map((b) => (
        <BookCard
          key={b.id}
          book={b}
          photoUrl={photoUrls.get(b.id)}
          showText={step.showText}
          selection={selection ? { selected: selection.ids.has(b.id), onToggle: () => selection.toggle(b.id) } : undefined}
        />
      ))}
    </div>
  );
}
