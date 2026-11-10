import { useId, useMemo, useRef, useState } from "react";
import EditionPicker from "@/components/edition/EditionPicker";
import { splitAuthors } from "@/lib/normalize";
import type { ConfirmForm } from "@/lib/photo/confirm";
import { needsLookup } from "@/lib/photo/lookup";
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

const keyOf = (a: IntakeAction): string =>
  a.kind === "new_book" ? "new" : a.kind === "discard" ? "discard" : `${a.kind}:${a.bookId}`;
const DISCARD: IntakeAction = { kind: "discard" };

function statusLine(item: IntakeItem, now: number, lookupHidden: boolean): string | null {
  if (item.status === "pending") return "Waiting to be read";
  if (item.status === "processing") {
    const stale = item.claimedAt !== null && now - new Date(item.claimedAt).getTime() > LEASE_MS;
    return stale ? "Taking longer than expected. It will be retried." : "Reading the cover…";
  }
  if (needsLookup(item) && !lookupHidden) {
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
  /** D12: the household's edition labels for the picker. */
  labels: string[];
  /** Saves the item's edition label as soon as it is picked. */
  onEdition(itemId: string, label: string | null): void;
}

/** D9: what a found ISBN lookup says the book is; a not-found one (agrees false) says nothing. */
function foundByIsbn(item: IntakeItem) {
  const l = item.lookup;
  return l !== null && l.byIsbn === true && l.agrees && l.title?.trim() ? l : null;
}

export default function IntakeCard(props: Props) {
  const { item, catalog, openItems, members, thumbUrl, lookupPaused } = props;
  const uid = useId();
  const isScan = item.source === "scan";
  const found = foundByIsbn(item);
  // D9: what the item stands for untouched: Claude's reading, else what its scanned ISBN found.
  const extracted = item.extraction?.title?.trim() || found?.title?.trim() || "";
  const ownAuthors =
    item.extraction && item.extraction.authors.length > 0 ? item.extraction.authors : (found?.authors ?? []);
  const books = useMemo(() => new Map(catalog.map((b) => [b.id, b])), [catalog]);
  // While a scan's lookup is due its lookup is null; after it, a scan with no title wasn't found.
  const untitled = isScan ? (item.lookup === null ? "Scanned book" : "Not found online") : "Untitled photo";
  let heading = extracted || untitled;
  if (item.status === "confirmed") {
    // The book it was added to, as the person named it; the extraction may have had no title.
    heading = (item.resultBookId ? books.get(item.resultBookId)?.title : undefined) || extracted || untitled;
  } else if (item.status === "discarded") {
    heading = extracted || (isScan ? "Scan removed" : "Photo removed");
  }
  const [choice, setChoice] = useState<IntakeAction | null>(null);
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState<string | null>(null);
  const [authorsText, setAuthorsText] = useState<string | null>(null);
  const [copyNote, setCopyNote] = useState("");
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

  const chosenBookId = choice !== null && "bookId" in choice ? choice.bookId : null;
  // A chosen book that has left the catalog is no longer a choice; the default shows instead.
  if (chosenBookId !== null && !books.has(chosenBookId)) setChoice(null);
  // A chosen book still in the catalog stays offered, even if a reload pushed it out of the top 3.
  const shownBookIds = proposal.candidates.map((c) => c.bookId).filter((id) => books.has(id));
  if (chosenBookId !== null && books.has(chosenBookId) && !shownBookIds.includes(chosenBookId)) {
    shownBookIds.push(chosenBookId);
  }
  const notABook = item.extraction?.isBook === false;
  const options: IntakeAction[] = [];
  for (const id of shownBookIds) {
    options.push({ kind: "add_copy", bookId: id });
    if ((books.get(id)?.copies.length ?? 0) > 0) options.push({ kind: "already_recorded", bookId: id });
  }
  options.push({ kind: "new_book" });
  if (notABook) options.push(DISCARD);
  // Not a book: Discard is preselected, never performed until the person presses a button.
  const defaultAction = notABook ? DISCARD : proposal.defaultAction;
  const choiceKey = choice === null ? null : keyOf(choice);
  const chosenKey =
    choiceKey !== null && options.some((o) => keyOf(o) === choiceKey) ? choiceKey : keyOf(defaultAction);
  const chosen = options.find((o) => keyOf(o) === chosenKey) ?? { kind: "new_book" as const };

  if (item.status === "confirmed" || item.status === "discarded") {
    return (
      <article aria-label={heading} className="flex gap-2 rounded border p-2 text-[13px] sm:gap-3 sm:p-3 sm:text-sm">
        <p className="font-medium">{heading}</p>
        <p className="text-stone-600">
          {item.status === "confirmed"
            ? "Added to the library."
            : isScan
              ? "Not added."
              : "Not added. The photo was removed."}
        </p>
      </article>
    );
  }

  const line = statusLine(item, Date.now(), lookupPaused || props.lookupFailed);
  // A scan has no photo: its thumbnail is the lookup's cover.
  const thumbSrc = isScan ? (item.lookup?.coverUrl ?? undefined) : thumbUrl;
  const thumb = thumbSrc ? (
    <img
      src={thumbSrc}
      alt={isScan ? `Cover of ${heading}` : `Photo of ${heading}`}
      className="h-24 w-16 shrink-0 rounded object-cover"
    />
  ) : (
    <div aria-hidden className="h-24 w-16 shrink-0 rounded bg-stone-200" />
  );

  if (item.status === "pending" || item.status === "processing") {
    return (
      <article aria-label={heading} className="flex gap-2 rounded border p-2 text-[15px] sm:gap-3 sm:p-3 sm:text-base">
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
  const effectiveAuthors = authorsOverride ?? ownAuthors;
  const showDetails = editing || failed || proposal.needsTitle;
  const owner = item.ownerUserId;
  const clues = isScan ? [] : (item.extraction?.editionClues ?? []).filter((c) => c.trim() !== "");
  const writes = chosen.kind === "add_copy" || chosen.kind === "new_book";

  async function submit(action: IntakeAction) {
    if (busyRef.current) return;
    if (props.stale && action.kind !== "discard") return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    try {
      await props.onConfirm(item, action, {
        title: effectiveTitle.trim(),
        authors: effectiveAuthors,
        copy: {
          ownerUserId: owner,
          // D12: the picked label only; Claude's clues never prefill it.
          editionNote: item.editionLabel,
          copyNote: copyNote.trim() || null,
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
      onChange={() => setChoice(action)}
      className="mt-1"
    />
  );

  return (
    <article aria-label={heading} className="rounded border p-2 text-[15px] sm:p-3 sm:text-base">
      <div className="mb-2 flex gap-2 sm:gap-3">
        {thumb}
        <div className="min-w-0">
          <p className="font-medium">{extracted || (isScan ? heading : "No title read")}</p>
          {ownAuthors.length > 0 && <p className="text-sm text-stone-600">{ownAuthors.join(", ")}</p>}
          {item.scannedIsbn && <p className="text-sm text-stone-600">{`Scanned ISBN ${item.scannedIsbn}`}</p>}
          {line && <p className="text-sm text-stone-600">{line}</p>}
          {clues.length > 0 && <p className="text-sm text-stone-600">{`Claude saw: ${clues.join(", ")}`}</p>}
        </div>
      </div>
      <div className="mb-2">
        <EditionPicker
          value={item.editionLabel}
          labels={props.labels}
          disabled={busy}
          onChange={(label) => props.onEdition(item.id, label)}
        />
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
      {notABook && <p className="mb-2 text-sm">This doesn't look like a book.</p>}
      {!failed && proposal.needsTitle && !notABook && line === null && (
        <p className="mb-2 text-sm">No title found. Type it to continue.</p>
      )}
      {proposal.ambiguous && <p className="mb-2 text-sm">More than one book matches. Check which one.</p>}
      {proposal.isbnConflict && (
        <p className="mb-2 text-sm">The photo and the barcode don't match. Check which book this is.</p>
      )}
      {proposal.inBatchTwins.length > 0 && (
        <p className="mb-2 text-sm">
          {proposal.repeatScan
            ? "You scanned this book more than once in this session."
            : "Another photo in this batch looks like the same book."}
        </p>
      )}

      <fieldset className="mb-2">
        <legend className="sr-only">{`Choice for ${heading}`}</legend>
        {shownBookIds.map((id) => {
          const b = books.get(id);
          if (!b) return null;
          const addLabel = `Add a copy to ${b.title}`;
          return (
            <div key={b.id} className="py-0.5 sm:py-1">
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
                <label className="ml-6 flex min-h-10 items-start gap-2 py-1">
                  {radio({ kind: "already_recorded", bookId: b.id }, "Already recorded")}
                  <span>Already recorded</span>
                </label>
              )}
            </div>
          );
        })}
        <label className="flex min-h-10 items-start gap-2 py-1">
          {radio({ kind: "new_book" }, "Add as a new book")}
          <span>Add as a new book</span>
        </label>
        {notABook && (
          <label className="flex min-h-10 items-start gap-2 py-1">
            {radio(DISCARD, "Discard the photo")}
            <span>Discard the photo</span>
          </label>
        )}
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
              onChange={(e) => {
                setTitle(e.target.value);
                // Keep the form open once a missing title is being typed.
                setEditing(true);
              }}
              className="w-full rounded border px-2 py-1"
            />
          </div>
          <div>
            <label htmlFor={`${uid}-authors`} className="block">
              Authors
            </label>
            <input
              id={`${uid}-authors`}
              value={authorsText ?? ownAuthors.join(", ")}
              onChange={(e) => setAuthorsText(e.target.value)}
              className="w-full rounded border px-2 py-1"
            />
          </div>
          <div>
            <label htmlFor={`${uid}-copy-note`} className="block">
              Copy note
            </label>
            <textarea
              id={`${uid}-copy-note`}
              value={copyNote}
              maxLength={2000}
              onChange={(e) => setCopyNote(e.target.value)}
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
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy || props.stale || (writes && effectiveTitle.trim() === "")}
          onClick={() => void submit(chosen)}
          className="rounded bg-stone-800 min-h-10 px-3 py-2 text-white disabled:opacity-50"
        >
          Confirm
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => void submit(DISCARD)}
          className="min-h-10 rounded border px-3 py-2 disabled:opacity-50"
        >
          {isScan ? "Discard scan" : "Discard photo"}
        </button>
      </div>
    </article>
  );
}
