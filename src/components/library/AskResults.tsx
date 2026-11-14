import type { MouseEvent } from "react";
import { askRows } from "@/lib/ask";
import { saveScrollAnchor, type AskView } from "@/lib/library-view";
import { routeToHash } from "@/lib/router";
import type { AskResponse } from "@/lib/tagging/types";
import type { BookWithCopies } from "@/lib/types";

const ASK_FAILED = "Ask couldn't answer. Try again.";

/** D11's copy for an outcome that isn't `ok`. */
function errorCopy(outcome: Exclude<AskResponse["outcome"], "ok">): string {
  switch (outcome) {
    case "budget":
      return "This month's Ask budget is used up.";
    case "misconfigured":
      return "Ask isn't set up yet.";
    case "billing":
      return "Ask stopped: the Claude account's spending limit is reached.";
    case "too_large":
      return "Too many books to ask about at once. Narrow the filters.";
    default:
      return ASK_FAILED;
  }
}

/** D11: the Ask results in place of the wall. Rows link to the book and save the scroll anchor as wall cards do. */
export default function AskResults({
  view,
  books,
  viewKey,
  onClear,
}: {
  view: AskView;
  books: BookWithCopies[];
  viewKey: string;
  onClear(): void;
}) {
  const rows = askRows(view, books);
  const r = view.response;
  let message: string | null = null;
  if (view.status === "done") {
    if (r === null) message = ASK_FAILED;
    else if (r.outcome !== "ok") message = errorCopy(r.outcome);
    else if (!r.answerable) message = r.note ?? ASK_FAILED;
    else if (rows.length === 0) message = "No books on your shelf fit this prompt.";
  }
  function onClickCapture(e: MouseEvent<HTMLElement>) {
    const row = (e.target as Element).closest("[data-book-id]");
    const bookId = row?.getAttribute("data-book-id");
    if (!row || !bookId) return;
    saveScrollAnchor({ bookId, top: row.getBoundingClientRect().top, scrollY: window.scrollY, viewKey });
  }
  return (
    <section className="p-4">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="text-base font-medium">{`Books for "${view.prompt}"`}</h2>
        <button type="button" onClick={onClear} className="min-h-10 rounded border px-3 text-sm">
          Clear
        </button>
      </div>
      {view.status === "asking" && (
        <p role="status" className="text-sm text-stone-600">
          Asking…
        </p>
      )}
      {message !== null && (
        <p role="status" className="text-sm text-stone-700">
          {message}
        </p>
      )}
      {rows.length > 0 && (
        <ul onClickCapture={onClickCapture} className="divide-y">
          {rows.map(({ match, book }) => (
            <li key={book.id}>
              <a href={routeToHash({ name: "book", id: book.id })} data-book-id={book.id} className="flex items-start gap-3 py-2">
                <div className="h-16 w-11 shrink-0 overflow-hidden rounded bg-stone-200">
                  {book.coverUrl && <img src={book.coverUrl} alt="" loading="lazy" className="h-full w-full object-cover" />}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="flex items-baseline justify-between gap-2">
                    <span className="line-clamp-2 text-sm font-medium">{book.title}</span>
                    <span className="shrink-0 text-sm text-stone-600">{`${match.confidence}%`}</span>
                  </p>
                  <p className="text-sm text-stone-700">{match.reason}</p>
                </div>
              </a>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
