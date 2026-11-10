import { useState } from "react";

/** One row of the session list, already worded by ScanPage. */
export interface ScanRowView {
  key: string;
  /** The ISBN this row stands for; photo rows without one show none and offer no second copy. */
  isbn: string | null;
  thumbUrl: string | null;
  status: string;
  error: boolean;
  /** ownedInfo's line and the "also waiting elsewhere" line, when either applies. */
  ownedLines: string[];
  /** A not-found scan: offers `Take a photo` (D8). */
  notFound: boolean;
  /** A failed photo upload: offers `Retry`. */
  onRetry?: () => void;
}

const SHOWN = 20;

interface Props {
  rows: ScanRowView[];
  onPhoto(row: ScanRowView): void;
  onAnother(isbn: string): void;
}

/** Newest first, as given. The first 20, then `Show all {n}`. */
export default function ScanList({ rows, onPhoto, onAnother }: Props) {
  const [all, setAll] = useState(false);
  const shown = all ? rows : rows.slice(0, SHOWN);
  return (
    <>
      <ul aria-label="Scanned books" className="space-y-2">
        {shown.map((r) => (
          <li key={r.key} className="flex gap-3 rounded border p-2">
            {r.thumbUrl ? (
              <img
                src={r.thumbUrl}
                alt=""
                loading="lazy"
                decoding="async"
                className="h-16 w-11 shrink-0 rounded bg-stone-100 object-cover"
              />
            ) : (
              <div aria-hidden="true" className="h-16 w-11 shrink-0 rounded bg-stone-100" />
            )}
            <div className="min-w-0 flex-1 text-sm">
              <p className={`break-words ${r.error ? "text-red-700" : ""}`}>{r.status}</p>
              {r.isbn && <p className="text-xs text-stone-500">{r.isbn}</p>}
              {r.ownedLines.map((line) => (
                <p key={line} className="text-xs text-amber-800">
                  {line}
                </p>
              ))}
              <div className="mt-1 flex flex-wrap gap-2">
                {r.notFound && (
                  <button type="button" onClick={() => onPhoto(r)} className="rounded border px-2 py-1">
                    Take a photo
                  </button>
                )}
                {r.onRetry && (
                  <button type="button" onClick={r.onRetry} className="rounded border px-2 py-1">
                    Retry
                  </button>
                )}
                {r.isbn && (
                  <button type="button" onClick={() => onAnother(r.isbn!)} className="rounded border px-2 py-1">
                    Add another copy
                  </button>
                )}
              </div>
            </div>
          </li>
        ))}
      </ul>
      {rows.length === 0 && <p className="text-sm text-stone-600">No books scanned yet.</p>}
      {!all && rows.length > SHOWN && (
        <button type="button" onClick={() => setAll(true)} className="mt-2 rounded border px-3 py-2 text-sm">
          {`Show all ${rows.length}`}
        </button>
      )}
    </>
  );
}
