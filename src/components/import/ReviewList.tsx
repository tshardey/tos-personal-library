import type { BookWithCopies } from "@/lib/types";
import type { ReviewDecision, ReviewItem, ReviewReason } from "@/lib/libib/plan";

const REASON_TEXT: Record<ReviewReason, string> = {
  rescan: "This may be a copy you already have, recorded again under a new id.",
  existing_copy: "You already have a copy of this book that wasn't imported from libib.",
  same_title: "A book with this title and author is already in the library.",
  similar_title: "A book with a similar title and the same author is already in the library.",
  several_isbn_matches: "Several books in the library share this ISBN.",
};

function decisionKey(d: ReviewDecision): string {
  if (d.action === "link") return `link:${d.copyId}`;
  if (d.action === "add_copy") {
    return `add_copy:${d.book.kind === "existing" ? d.book.bookId : `pending:${d.book.libibId}`}`;
  }
  return "new_book";
}

function optionLabel(d: ReviewDecision, titles: Map<string, string>, thisTitle: string): string {
  if (d.action === "link") return "Same copy I already have";
  if (d.action === "new_book") return "Separate book";
  if (d.book.kind === "existing") {
    return `Another copy of "${titles.get(d.book.bookId) ?? thisTitle}"`;
  }
  return "Another copy of the new book from this file";
}

interface Props {
  items: ReviewItem[];
  catalog: BookWithCopies[];
  onChoose(libibId: string, decision: ReviewDecision): void;
}

export default function ReviewList({ items, catalog, onChoose }: Props) {
  if (items.length === 0) return null;
  const titles = new Map(catalog.map((b) => [b.id, b.title]));
  return (
    <section aria-labelledby="import-review" className="mb-4">
      <h3 id="import-review" className="mb-2 font-semibold">
        To review
      </h3>
      <ul className="space-y-3">
        {items.map((item) => (
          <li key={item.libibId} className="rounded border p-3">
            <p className="font-medium">{item.title}</p>
            {item.authors.length > 0 && <p className="text-sm text-stone-600">{item.authors.join(", ")}</p>}
            <p className="mb-2 text-sm text-stone-600">{REASON_TEXT[item.reason]}</p>
            <fieldset>
              <legend className="sr-only">{`Choice for ${item.title}`}</legend>
              {item.options.map((option) => {
                const key = decisionKey(option);
                return (
                  <label key={key} className="flex items-start gap-2 py-1">
                    <input
                      type="radio"
                      name={`review-${item.libibId}`}
                      checked={key === decisionKey(item.chosen)}
                      onChange={() => onChoose(item.libibId, option)}
                      className="mt-1"
                    />
                    <span>{optionLabel(option, titles, item.title)}</span>
                  </label>
                );
              })}
            </fieldset>
          </li>
        ))}
      </ul>
    </section>
  );
}
