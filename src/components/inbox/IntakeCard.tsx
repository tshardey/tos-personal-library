import { useId, useMemo, useRef, useState } from "react";
import { splitAuthors } from "@/lib/normalize";
import type { ConfirmForm } from "@/lib/photo/confirm";
import { proposeMatch, type IntakeAction } from "@/lib/photo/propose";
import { LEASE_MS, MAX_ATTEMPTS, type IntakeErrorCode, type IntakeItem } from "@/lib/photo/types";
import type { BookWithCopies, HouseholdMember } from "@/lib/types";

const SAVE_FAILED = "Couldn't save this. Try again.";

const FAILED_TEXT: Record<IntakeErrorCode, string> = {
  vision_refused: "Couldn't read this photo.",
  vision_rejected: "Couldn't read this photo.",
  vision_unreadable: "Couldn't read this photo.",
  vision_unavailable: "Photo reading is busy right now.",
  photo_missing: "The photo didn't upload completely.",
  attempts_exhausted: "Couldn't read this photo after 3 tries.",
};

const SHARED = "shared";

function ownerName(members: HouseholdMember[], ownerUserId: string | null): string {
  if (ownerUserId === null) return "Shared";
  return members.find((m) => m.userId === ownerUserId)?.displayName ?? "Former member";
}

const keyOf = (a: IntakeAction): string => (a.kind === "new_book" ? "new" : `${a.kind}:${a.bookId}`);

function statusLine(item: IntakeItem, now: number, lookupHidden: boolean): string | null {
  if (item.status === "pending") return "Waiting to be read";
  if (item.status === "processing") {
    const stale = item.claimedAt !== null && now - new Date(item.claimedAt).getTime() > LEASE_MS;
    return stale ? "Taking longer than expected. It will be retried." : "Reading the cover…";
  }
  if (item.status === "ready" && item.lookup === null && (item.extraction?.title ?? "").trim() !== "" && !lookupHidden) {
    return "Looking it up online…";
  }
  return null;
}

interface Props {
  item: IntakeItem;
  catalog: BookWithCopies[];
  openItems: IntakeItem[];
  members: HouseholdMember[];
  thumbUrl: string | undefined;
  lookupPaused: boolean;
  /** This item's lookup failed this session, so no lookup is under way. */
  lookupFailed: boolean;
  /** A refresh failed: the proposal may rest on stale data, so Confirm waits for a good read. */
  stale: boolean;
  onConfirm(item: IntakeItem, action: IntakeAction, form: ConfirmForm): Promise<void>;
  onRetry(itemId: string): Promise<void>;
  onOwner(itemId: string, ownerUserId: string | null): void;
}

export default function IntakeCard(props: Props) {
  const { item, catalog, openItems, members, thumbUrl, lookupPaused } = props;
  const uid = useId();
  const extracted = item.extraction?.title?.trim() || "";
  const heading = extracted || "Untitled photo";
  const [choice, setChoice] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState<string | null>(null);
  const [authorsText, setAuthorsText] = useState<string | null>(null);
  const [editionNote, setEditionNote] = useState<string | null>(null);
  const [location, setLocation] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const busyRef = useRef(false);

  const authorsOverride = useMemo(
    () => (authorsText === null ? undefined : splitAuthors(authorsText)),
    [authorsText],
  );
  // D5: recomputed against the current catalog and open items on every change.
  const proposal = useMemo(
    () => proposeMatch({ item, catalog, openItems, titleOverride: title ?? undefined, authorsOverride }),
    [item, catalog, openItems, title, authorsOverride],
  );

  const books = useMemo(() => new Map(catalog.map((b) => [b.id, b])), [catalog]);
  const options: IntakeAction[] = [];
  for (const c of proposal.candidates) {
    options.push({ kind: "add_copy", bookId: c.bookId });
    if ((books.get(c.bookId)?.copies.length ?? 0) > 0) options.push({ kind: "already_recorded", bookId: c.bookId });
  }
  options.push({ kind: "new_book" });
  const chosenKey = choice !== null && options.some((o) => keyOf(o) === choice) ? choice : keyOf(proposal.defaultAction);
  const chosen = options.find((o) => keyOf(o) === chosenKey) ?? { kind: "new_book" as const };

  if (item.status === "confirmed" || item.status === "discarded") {
    return (
      <article aria-label={heading} className="flex gap-3 rounded border p-3 text-sm">
        <p className="font-medium">{heading}</p>
        <p className="text-stone-600">
          {item.status === "confirmed" ? "Added to the library." : "Not added. The photo was removed."}
        </p>
      </article>
    );
  }

  const line = statusLine(item, Date.now(), lookupPaused || props.lookupFailed);
  const thumb = thumbUrl ? (
    <img src={thumbUrl} alt={`Photo of ${heading}`} className="h-24 w-16 shrink-0 rounded object-cover" />
  ) : (
    <div aria-hidden className="h-24 w-16 shrink-0 rounded bg-stone-200" />
  );

  if (item.status === "pending" || item.status === "processing") {
    return (
      <article aria-label={heading} className="flex gap-3 rounded border p-3">
        {thumb}
        <div>
          {extracted && <p className="font-medium">{extracted}</p>}
          <p className="text-sm text-stone-600">{line}</p>
        </div>
      </article>
    );
  }

  const failed = item.status === "failed";
  const effectiveTitle = title ?? extracted;
  const effectiveAuthors = authorsOverride ?? item.extraction?.authors ?? [];
  const showDetails = editing || failed || proposal.needsTitle;
  const owner = item.ownerUserId;
  const defaultNote = (item.extraction?.editionClues ?? []).join("; ");

  async function onConfirm() {
    if (busyRef.current || props.stale) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    try {
      await props.onConfirm(item, chosen, {
        title: effectiveTitle.trim(),
        authors: effectiveAuthors,
        copy: {
          ownerUserId: owner,
          editionNote: (editionNote ?? defaultNote) || null,
          location: location || null,
        },
      });
    } catch (e) {
      console.error("Confirm failed", e instanceof Error ? e.name : "unknown");
      setError(SAVE_FAILED);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  async function onRetry() {
    try {
      await props.onRetry(item.id);
    } catch (e) {
      console.error("Retry failed", e instanceof Error ? e.name : "unknown");
      setError(SAVE_FAILED);
    }
  }

  const radioName = `${uid}-choice`;
  const radio = (action: IntakeAction, label: string) => (
    <input
      type="radio"
      name={radioName}
      aria-label={label}
      checked={keyOf(action) === chosenKey}
      onChange={() => setChoice(keyOf(action))}
      className="mt-1"
    />
  );

  return (
    <article aria-label={heading} className="rounded border p-3">
      <div className="mb-2 flex gap-3">
        {thumb}
        <div className="min-w-0">
          <p className="font-medium">{extracted || "No title read"}</p>
          {(item.extraction?.authors.length ?? 0) > 0 && (
            <p className="text-sm text-stone-600">{item.extraction!.authors.join(", ")}</p>
          )}
          {line && <p className="text-sm text-stone-600">{line}</p>}
        </div>
      </div>

      {failed && (
        <div className="mb-2 text-sm">
          <p className="text-red-700">{`${FAILED_TEXT[item.errorCode ?? "vision_unreadable"]} Type the title to add it.`}</p>
          {item.attempts < MAX_ATTEMPTS && (
            <button type="button" onClick={() => void onRetry()} className="mt-1 rounded border px-3 py-1">
              Try again
            </button>
          )}
        </div>
      )}
      {!failed && proposal.needsTitle && <p className="mb-2 text-sm">No title found. Type it to continue.</p>}
      {proposal.ambiguous && <p className="mb-2 text-sm">More than one book matches. Check which one.</p>}
      {proposal.inBatchTwins.length > 0 && (
        <p className="mb-2 text-sm">Another photo in this batch looks like the same book.</p>
      )}

      <fieldset className="mb-2">
        <legend className="sr-only">{`Choice for ${heading}`}</legend>
        {proposal.candidates.map((c) => {
          const b = books.get(c.bookId);
          if (!b) return null;
          const addLabel = `Add a copy to ${b.title}`;
          return (
            <div key={c.bookId} className="py-1">
              <label className="flex items-start gap-2">
                {radio({ kind: "add_copy", bookId: b.id }, addLabel)}
                {b.coverUrl ? (
                  <img src={b.coverUrl} alt="" className="h-12 w-8 shrink-0 rounded object-cover" />
                ) : (
                  <span aria-hidden className="h-12 w-8 shrink-0 rounded bg-stone-200" />
                )}
                <span className="min-w-0">
                  <span className="block">{addLabel}</span>
                  {b.authors.length > 0 && <span className="block text-sm text-stone-600">{b.authors.join(", ")}</span>}
                  {b.copies.map((cp) => (
                    <span key={cp.id} className="block text-sm text-stone-600">
                      {cp.editionNote ? `${ownerName(members, cp.ownerUserId)} · ${cp.editionNote}` : ownerName(members, cp.ownerUserId)}
                    </span>
                  ))}
                </span>
              </label>
              {b.copies.length > 0 && (
                <label className="ml-6 flex items-start gap-2 py-1">
                  {radio({ kind: "already_recorded", bookId: b.id }, "Already recorded")}
                  <span>Already recorded</span>
                </label>
              )}
            </div>
          );
        })}
        <label className="flex items-start gap-2 py-1">
          {radio({ kind: "new_book" }, "Add as a new book")}
          <span>Add as a new book</span>
        </label>
      </fieldset>

      {!showDetails && (
        <button type="button" onClick={() => setEditing(true)} className="mb-2 text-sm underline">
          Edit details
        </button>
      )}
      {showDetails && (
        <div className="mb-2 space-y-2 text-sm">
          <div>
            <label htmlFor={`${uid}-title`} className="block">
              Title
            </label>
            <input
              id={`${uid}-title`}
              value={effectiveTitle}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full rounded border px-2 py-1"
            />
          </div>
          <div>
            <label htmlFor={`${uid}-authors`} className="block">
              Authors
            </label>
            <input
              id={`${uid}-authors`}
              value={authorsText ?? (item.extraction?.authors ?? []).join(", ")}
              onChange={(e) => setAuthorsText(e.target.value)}
              className="w-full rounded border px-2 py-1"
            />
          </div>
          <div>
            <label htmlFor={`${uid}-edition`} className="block">
              Edition note
            </label>
            <input
              id={`${uid}-edition`}
              value={editionNote ?? defaultNote}
              onChange={(e) => setEditionNote(e.target.value)}
              className="w-full rounded border px-2 py-1"
            />
          </div>
          <div>
            <label htmlFor={`${uid}-owner`} className="block">
              Owner
            </label>
            <select
              id={`${uid}-owner`}
              value={owner ?? SHARED}
              onChange={(e) => props.onOwner(item.id, e.target.value === SHARED ? null : e.target.value)}
              className="w-full rounded border px-2 py-1"
            >
              {members.map((m) => (
                <option key={m.userId} value={m.userId}>
                  {m.displayName}
                </option>
              ))}
              <option value={SHARED}>Shared</option>
            </select>
          </div>
          <div>
            <label htmlFor={`${uid}-location`} className="block">
              Location
            </label>
            <input
              id={`${uid}-location`}
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              className="w-full rounded border px-2 py-1"
            />
          </div>
        </div>
      )}

      {error && (
        <p role="alert" className="mb-2 text-sm text-red-700">
          {error}
        </p>
      )}
      <button
        type="button"
        disabled={busy || props.stale || effectiveTitle.trim() === ""}
        onClick={() => void onConfirm()}
        className="rounded bg-stone-800 px-3 py-2 text-white disabled:opacity-50"
      >
        Confirm
      </button>
    </article>
  );
}
