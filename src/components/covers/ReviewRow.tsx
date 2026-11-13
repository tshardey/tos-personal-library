import { routeToHash } from "@/lib/router";
import type { ReviewRow as Row, RowChoice } from "@/lib/covers/review";
import { REASON_LABELS } from "@/lib/covers/types";

interface Props {
  row: Row;
  /** The effective choice, with failed tiles already skipped. */
  choice: RowChoice | null;
  failed: ReadonlySet<string>;
  /** The last Search again on this row failed. */
  retryFailed?: boolean;
  onChoose(choice: RowChoice): void;
  onTileError(url: string): void;
  onRetry(): void;
}

const tile = "relative h-32 w-24 shrink-0 overflow-hidden rounded border bg-stone-100 text-xs";
const ring = "ring-2 ring-stone-800 ring-offset-1";

export default function ReviewRow({ row, choice, failed, retryFailed = false, onChoose, onTileError, onRetry }: Props) {
  const { search, book } = row;
  const visible = search.results.filter((r) => !failed.has(r.url));
  const reasons = search.reasons.map((r) => REASON_LABELS[r]).join(" · ");

  return (
    <li aria-label={book.title} className="space-y-1.5 border-b py-3">
      <a href={routeToHash({ name: "book", id: book.id })} className="font-medium underline">
        {book.title}
      </a>
      {(reasons || search.note) && (
        <p className="text-sm text-stone-600">
          {reasons}
          {reasons && search.note ? " " : ""}
          {search.note ? `“${search.note}”` : ""}
        </p>
      )}
      {row.kind === "nothing_found" && <p className="text-sm">Nothing good found.</p>}
      {row.kind === "failed" && <p className="text-sm">The search failed.</p>}
      {row.kind === "results" && (
        <>
          {row.coverChanged && <p className="text-sm text-amber-800">This cover was changed after the search.</p>}
          {visible.length === 0 ? (
            <div className="flex items-center gap-3 text-sm">
              <p>These covers no longer load.</p>
              <button type="button" onClick={onRetry} className="rounded border px-2 py-1">
                Search again
              </button>
            </div>
          ) : null}
          {visible.length === 0 && retryFailed && (
            <p role="alert" className="text-sm text-red-700">
              Couldn't search again. Try again.
            </p>
          )}
          <div className="flex gap-2 overflow-x-auto pb-1">
            <button
              type="button"
              aria-label="Current"
              aria-pressed={choice === "keep"}
              onClick={() => onChoose("keep")}
              className={`${tile} ${choice === "keep" ? ring : ""}`}
            >
              {book.coverUrl ? (
                <img src={book.coverUrl} alt="" className="h-full w-full object-cover" />
              ) : (
                <span className="flex h-full items-center justify-center text-stone-500">none</span>
              )}
              <span className="absolute inset-x-0 bottom-0 bg-white/90 py-0.5 text-center">Current</span>
            </button>
            {visible.map((r) => (
              <button
                key={r.url}
                type="button"
                aria-label={`Option ${search.results.indexOf(r) + 1}`}
                aria-pressed={choice === r.url}
                onClick={() => onChoose(r.url)}
                className={`${tile} ${choice === r.url ? ring : ""}`}
              >
                <img
                  src={r.url}
                  alt=""
                  onError={() => onTileError(r.url)}
                  className="h-full w-full object-cover"
                />
              </button>
            ))}
          </div>
        </>
      )}
    </li>
  );
}
