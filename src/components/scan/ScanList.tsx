import { useState } from "react";
import { OWNED_BADGE } from "@/lib/scan/owners";
import { Button } from "../ui";

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
  /** The household already holds this ISBN: shows the badge and `explain` under it. */
  owned?: { explain: string };
  /** Discards this scan item now; offered only for a saved, still-open scan. */
  onRemove?: () => void;
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
      <ul aria-label="Scanned books" className="space-y-1.5 sm:space-y-2">
        {shown.map((r) => (
          <li key={r.key} className="flex gap-2 rounded-md border border-line bg-raised p-1.5 sm:gap-3 sm:p-2">
            {r.thumbUrl ? (
              <img
                src={r.thumbUrl}
                alt=""
                loading="lazy"
                decoding="async"
                className="h-16 w-11 shrink-0 rounded bg-control object-cover"
              />
            ) : (
              <div aria-hidden="true" className="h-16 w-11 shrink-0 rounded bg-control" />
            )}
            <div className="min-w-0 flex-1 text-[13px] sm:text-sm">
              <p className={`break-words ${r.error ? "text-danger" : ""}`}>{r.status}</p>
              {r.isbn && <p className="text-xs text-muted">{r.isbn}</p>}
              {r.owned && (
                <>
                  <p>
                    <span className="inline-block rounded bg-notice px-2 py-0.5 text-xs font-semibold text-fg">
                      {OWNED_BADGE}
                    </span>
                  </p>
                  <p className="text-xs text-fg">{r.owned.explain}</p>
                </>
              )}
              {r.ownedLines.map((line) => (
                <p key={line} className="text-xs text-fg">
                  {line}
                </p>
              ))}
              <div className="mt-1 flex flex-wrap gap-2">
                {r.notFound && (
                  <Button size="sm" onClick={() => onPhoto(r)}>
                    Take a photo
                  </Button>
                )}
                {r.onRetry && (
                  <Button size="sm" onClick={r.onRetry}>
                    Retry
                  </Button>
                )}
                {r.isbn && (
                  <Button size="sm" onClick={() => onAnother(r.isbn!)}>
                    Add another copy
                  </Button>
                )}
                {r.onRemove && (
                  <Button size="sm" onClick={r.onRemove}>
                    Remove
                  </Button>
                )}
              </div>
            </div>
          </li>
        ))}
      </ul>
      {rows.length === 0 && <p className="text-sm text-muted">No books scanned yet.</p>}
      {!all && rows.length > SHOWN && (
        <Button size="sm" onClick={() => setAll(true)} className="mt-2">
          {`Show all ${rows.length}`}
        </Button>
      )}
    </>
  );
}
