import { useHousehold } from "@/contexts/HouseholdContext";
import { useReading } from "@/contexts/ReadingContext";
import { useTagging } from "@/contexts/TaggingContext";
import { readCatalogCache } from "@/lib/catalog-cache";
import { localDay } from "@/lib/date-added";
import { readingStats } from "@/lib/reading/stats";
import { useEffect, useId, useMemo, useRef, useState } from "react";

interface Props {
  email: string | undefined;
  onSignOut(): void;
}

/** A disclosure button holding the signed-in email and Sign out. Closes on outside click and Escape. */
export default function AccountMenu({ email, onSignOut }: Props) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const { available: taggingAvailable } = useTagging();
  const { household } = useHousehold();
  const { available: readingAvailable, byBook, userId } = useReading();

  // Computed only while the menu is open, from the cached catalogue (no fetch).
  const summary = useMemo(() => {
    if (!open || !readingAvailable || userId === null) return null;
    const cache = readCatalogCache(household?.id ?? null);
    if (cache === null) return null;
    const s = readingStats(cache.books, byBook, userId, { today: localDay(new Date().toISOString()), since: null });
    return s.owned === 0 ? null : s;
  }, [open, readingAvailable, byBook, userId, household?.id]);

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setOpen(false);
      button.current?.focus();
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={root} className="relative">
      <button
        ref={button}
        type="button"
        aria-label="Account"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((o) => !o)}
        className="flex h-10 w-10 items-center justify-center rounded border"
      >
        <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="8" r="4" />
          <path d="M4 21a8 8 0 0 1 16 0" />
        </svg>
      </button>
      {open && (
        <div id={panelId} className="absolute right-0 z-20 mt-1 w-64 rounded border bg-raised p-3 shadow">
          <p className="mb-2 break-words text-sm text-muted">{email}</p>
          {summary && (
            <p className="mb-2 text-sm text-muted">
              {`You've read ${summary.read} of ${summary.owned} (${summary.pct}%)`}
            </p>
          )}
          <a
            href="#/editions"
            onClick={() => setOpen(false)}
            className="mb-2 flex min-h-10 w-full items-center justify-center rounded border px-3 py-2"
          >
            Edition labels
          </a>
          {taggingAvailable && (
          <a
            href="#/tags"
            onClick={() => setOpen(false)}
            className="mb-2 flex min-h-10 w-full items-center justify-center rounded border px-3 py-2"
          >
            Tag suggestions
          </a>
          )}
          {readingAvailable && (
          <a
            href="#/reading"
            onClick={() => setOpen(false)}
            className="mb-2 flex min-h-10 w-full items-center justify-center rounded border px-3 py-2"
          >
            Reading history
          </a>
          )}
          <button type="button" onClick={onSignOut} className="min-h-10 w-full rounded border px-3 py-2">
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}
