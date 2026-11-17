import { useId, useMemo, useRef, useState } from "react";
import { Sheet } from "@/components/ui";
import EditionPicker from "@/components/edition/EditionPicker";
import LibraryTagPicker from "@/components/tags/LibraryTagPicker";
import RetagConfirm from "@/components/tags/RetagConfirm";
import { useReading } from "@/contexts/ReadingContext";
import { useTagging } from "@/contexts/TaggingContext";
import { localDay } from "@/lib/date-added";
import { isUnhauled } from "@/lib/copy-flags";
import { updateBook, updateCopyFields } from "@/lib/library-repo";
import {
  applyChangeSet,
  buildChangeSet,
  describeCounts,
  locationNames,
  retryTargets,
  type MassEdit,
  type MassEditResult,
  type MassEditTargets,
} from "@/lib/mass-edit";
import { setReadStatus } from "@/lib/reading/reading-repo";
import { MAX_SERIES, seriesNames } from "@/lib/series";
import { addLibraryTag, removeLibraryTag } from "@/lib/tagging/tagging-repo";
import type { BookWithCopies, Copy, HouseholdMember } from "@/lib/types";

type Flag = "" | "on" | "off";
/** A text field: no change, set to the typed value, or clear. */
type TextMode = "" | "set" | "clear";
/** Mark as: no change, or the state to give the signed-in member. */
type MarkMode = "" | "read" | "dnf" | "unread";

function ownerLabel(ownerUserId: string | null, members: HouseholdMember[]): string {
  if (ownerUserId === null) return "Shared";
  return members.find((m) => m.userId === ownerUserId)?.displayName ?? "Unknown";
}

function copyText(copy: Copy, members: HouseholdMember[]): string {
  return [
    ownerLabel(copy.ownerUserId, members),
    copy.editionNote ?? "No edition label",
    copy.deluxe && "Deluxe",
    copy.signed && "Signed",
    copy.location,
    isUnhauled(copy) && "Unhauled",
  ]
    .filter(Boolean)
    .join(" · ");
}

const flag = (f: Flag): boolean | undefined => (f === "" ? undefined : f === "on");

interface Props {
  /** The selected books, in list order. */
  selected: BookWithCopies[];
  /** The whole catalogue: suggestions and existing spellings come from it. */
  catalog: BookWithCopies[];
  labels: string[];
  members: HouseholdMember[];
  /** Reloads the catalogue behind the page; false when it couldn't. */
  refresh(): Promise<boolean>;
  onClose(): void;
  /** Every write went through; `summary` says what changed. */
  onDone(summary: string): void;
}

/** Edits the copies and series of many books at once. Every field starts as no change. */
export default function MassEditSheet({ selected, catalog, labels, members, refresh, onClose, onDone }: Props) {
  const [ticked, setTicked] = useState<Set<string>>(
    () => new Set(selected.flatMap((b) => b.copies.filter((c) => !isUnhauled(c)).map((c) => c.id))),
  );
  /** undefined until a label (or None) is picked. */
  const [label, setLabel] = useState<string | null | undefined>(undefined);
  const [locationMode, setLocationMode] = useState<TextMode>("");
  const [location, setLocation] = useState("");
  const [owner, setOwner] = useState("");
  const [deluxe, setDeluxe] = useState<Flag>("");
  const [signed, setSigned] = useState<Flag>("");
  const [unhauled, setUnhauled] = useState<Flag>("");
  const [seriesMode, setSeriesMode] = useState<TextMode>("");
  const [series, setSeries] = useState("");
  const [addTags, setAddTags] = useState<string[]>([]);
  const [removeTags, setRemoveTags] = useState<string[]>([]);
  const [markMode, setMarkMode] = useState<MarkMode>("");
  const [finishDate, setFinishDate] = useState("");
  const tagging = useTagging();
  const reading = useReading();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<MassEditResult | null>(null);
  const [refreshFailed, setRefreshFailed] = useState(false);
  /** Changes written so far, across the first run and any retries. */
  const [totals, setTotals] = useState({ copies: 0, books: 0, tags: 0, reads: 0 });
  const locationList = useId();
  const seriesList = useId();

  const locations = useMemo(() => locationNames(catalog), [catalog]);
  const allSeries = useMemo(() => seriesNames(catalog), [catalog]);
  // Library tags are written only while tagging is available (the row is hidden otherwise).
  const tagsOn = tagging.available;
  const tagMap = tagging.libraryTagsByBook;
  const householdOf = useMemo(() => new Map(catalog.map((b) => [b.id, b.householdId])), [catalog]);
  const activeTags = tagging.vocabulary.filter((t) => t.active).map((t) => t.id);
  // Remove also offers retired tags a selected book still has.
  const removable = useMemo(() => {
    const ids = new Set(tagging.vocabulary.filter((t) => t.active).map((t) => t.id));
    for (const b of selected) for (const id of tagMap.get(b.id) ?? []) ids.add(id);
    return [...ids];
  }, [tagging.vocabulary, selected, tagMap]);

  const readOn = reading.available && reading.userId !== null;
  const edit: MassEdit = {
    editionNote: label,
    location: locationMode === "set" ? location : locationMode === "clear" ? null : undefined,
    ownerUserId: owner === "" ? undefined : owner === "shared" ? null : owner,
    deluxe: flag(deluxe),
    signed: flag(signed),
    unhauled: flag(unhauled),
    seriesName: seriesMode === "set" ? series : seriesMode === "clear" ? null : undefined,
    addLibraryTags: tagsOn && addTags.length > 0 ? addTags : undefined,
    removeLibraryTags: tagsOn && removeTags.length > 0 ? removeTags : undefined,
    markAs:
      readOn && markMode !== ""
        ? { state: markMode, finishedOn: markMode === "read" && finishDate !== "" ? finishDate : null }
        : undefined,
  };
  const blank =
    seriesMode === "set" && series.trim() === ""
      ? "Type a series name, or choose Clear series."
      : seriesMode === "set" && series.trim().length > MAX_SERIES
        ? `Series names are at most ${MAX_SERIES} characters.`
        : locationMode === "set" && location.trim() === ""
        ? "Type a location, or choose Clear location."
        : null;
  const targets: MassEditTargets = {
    copyIds: ticked,
    bookIds: new Set(selected.map((b) => b.id)),
  };
  // Counts only; the real timestamp is taken when saving.
  const today = localDay(new Date().toISOString());
  const preview = buildChangeSet(catalog, targets, edit, labels, "", tagMap, reading.byBook, reading.userId, today);
  const copyCount = preview.copies.length;
  const bookCount = preview.books.length;
  const tagCount = preview.libraryTags.length;
  const readCount = preview.reads.length;
  const nothing = copyCount + bookCount + tagCount + readCount === 0;

  function toggle(id: string) {
    setConfirming(false);
    setTicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function run(runTargets: MassEditTargets) {
    setBusy(true);
    try {
      const set = buildChangeSet(catalog, runTargets, edit, labels, new Date().toISOString(), tagMap, reading.byBook, reading.userId, today);
      const out = await applyChangeSet(set, {
        writeCopy: updateCopyFields,
        writeBook: updateBook,
        addLibraryTag: (bookId, tagId) => addLibraryTag(bookId, householdOf.get(bookId) ?? "", tagId),
        removeLibraryTag,
        // Straight to the repo: the provider's single-flight guard would drop every chunk after the first.
        setReadStatus: async (bookIds, state, finishedOn, keepDates) => {
          await setReadStatus(householdOf.get(bookIds[0]) ?? "", bookIds, state, finishedOn, keepDates);
        },
      });
      const [refreshed] = await Promise.all([
        refresh(),
        set.libraryTags.length > 0 ? tagging.reload() : Promise.resolve(),
        set.reads.length > 0 ? reading.reload() : Promise.resolve(),
      ]);
      const failed = out.failedCopies.length + out.failedBooks.length + out.failedTags.length + out.failedReads.length;
      const sum = {
        copies: totals.copies + out.changedCopies,
        books: totals.books + out.changedBooks,
        tags: totals.tags + out.changedTagBooks,
        reads: totals.reads + out.changedReadBooks,
      };
      if (failed === 0 && refreshed) {
        onDone(`Changed ${describeCounts(sum.copies, sum.books, sum.tags, sum.reads) || "nothing"}.`);
        return;
      }
      setTotals(sum);
      setRefreshFailed(!refreshed);
      setResult(out);
      setConfirming(false);
    } finally {
      setBusy(false);
    }
  }

  /** A retry builds on reloaded rows, so after a failed reload the person reloads first. */
  async function reloadAgain() {
    setBusy(true);
    try {
      setRefreshFailed(!(await refresh()));
    } finally {
      setBusy(false);
    }
  }

  const failures = result
    ? result.failedCopies.length + result.failedBooks.length + result.failedTags.length + result.failedReads.length
    : 0;
  const choice = "mt-1 block w-full rounded border p-2";
  const field = "block text-sm";

  // Focus starts on the dialog itself (as before), so Escape and Tab begin there rather than on the first field.
  const dialogRef = useRef<HTMLElement | null>(null);
  const footer = (
    <div className="w-full">
      {result ? (
        <button type="button" disabled={busy} onClick={onClose} className="min-h-11 sm:min-h-10 rounded border px-3">
          Close
        </button>
      ) : confirming && !nothing ? (
        <div role="group" aria-label="Confirm" className="space-y-2">
          <p className="text-sm font-medium">{`This will change ${describeCounts(copyCount, bookCount, tagCount, readCount)}. There is no undo.`}</p>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => void run(targets)}
              className="min-h-11 sm:min-h-10 rounded bg-accent px-3 text-on-accent disabled:bg-control disabled:text-muted"
            >
              {busy ? "Saving…" : "Confirm"}
            </button>
            <button type="button" disabled={busy} onClick={() => setConfirming(false)} className="min-h-11 sm:min-h-10 rounded border px-3">
              Back
            </button>
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={nothing || blank !== null}
            onClick={() => setConfirming(true)}
            className="min-h-11 sm:min-h-10 rounded bg-accent px-3 text-on-accent disabled:bg-control disabled:text-muted"
          >
            Save
          </button>
          <button type="button" onClick={onClose} className="min-h-11 sm:min-h-10 rounded border px-3">
            Cancel
          </button>
          <p className="text-sm text-muted">
            {blank ?? (nothing ? "Nothing to change yet." : describeCounts(copyCount, bookCount, tagCount, readCount))}
          </p>
        </div>
      )}
        </div>
  );

  return (
    <Sheet
      label="Edit selected books"
      onClose={() => {
        if (busy) return;
        if (confirming) setConfirming(false);
        else onClose();
      }}
      footer={footer}
      initialFocus={dialogRef}
      dismissOnScrim={false}
    >
      <div ref={(el) => { dialogRef.current = el?.closest<HTMLElement>('[role="dialog"]') ?? null; }}>
        <h2 className="text-lg font-semibold">{`Edit ${selected.length} ${selected.length === 1 ? "book" : "books"}`}</h2>
        <p className="mb-3 text-sm text-muted">Each field starts as no change. Only what you change is saved.</p>

        {result && (
          <div
            role={failures > 0 || refreshFailed ? "alert" : "status"}
            className={`mb-3 space-y-2 rounded border p-2 text-sm ${
              failures > 0 || refreshFailed ? "border-danger bg-danger-surface" : ""
            }`}
          >
            <p>
              {`Changed ${describeCounts(totals.copies, totals.books, totals.tags, totals.reads) || "nothing"}.`}
              {failures > 0 && ` ${failures} couldn't be changed:`}
            </p>
            {failures > 0 && (
              <ul aria-label="Not changed" className="list-disc pl-5">
                {result.failedCopies.map((c) => (
                  <li key={c.copy.id}>{`${c.book.title}: copy (${copyText(c.copy, members)})`}</li>
                ))}
                {result.failedBooks.map((b) => (
                  <li key={b.book.id}>{`${b.book.title}: series`}</li>
                ))}
                {result.failedTags.map((c) => (
                  <li key={`tags-${c.book.id}`}>{`${c.book.title}: tags`}</li>
                ))}
                {result.failedReads.map((c) => (
                  <li key={`reading-${c.book.id}`}>{`${c.book.title}: reading`}</li>
                ))}
              </ul>
            )}
            {refreshFailed && (
              <>
                <p>Couldn't reload the library, so the list may be out of date.</p>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void reloadAgain()}
                  className="min-h-11 sm:min-h-10 rounded border px-3 disabled:opacity-50"
                >
                  Reload
                </button>
              </>
            )}
            {failures > 0 && !refreshFailed && (
              <button
                type="button"
                disabled={busy}
                onClick={() => void run(retryTargets(result))}
                className="min-h-11 sm:min-h-10 rounded bg-accent px-3 text-on-accent disabled:bg-control disabled:text-muted"
              >
                {busy ? "Trying again…" : "Try again"}
              </button>
            )}
          </div>
        )}

        <fieldset disabled={busy || result !== null} className="space-y-3">
          <div>
            <EditionPicker
              label="Edition label"
              value={label ?? null}
              valueText={label === undefined ? "no change" : undefined}
              labels={labels}
              onChange={(l) => { setLabel(l); setConfirming(false); }}
            />
            {label !== undefined && (
              <p className="mt-1 text-xs text-muted">
                {label === null ? "Clears the label. " : ""}
                <button type="button" onClick={() => { setLabel(undefined); setConfirming(false); }} className="underline">
                  No change
                </button>
              </p>
            )}
          </div>

          <div className="grid grid-cols-3 gap-2">
            <label className={field}>
              Deluxe
              <select value={deluxe} onChange={(e) => { setDeluxe(e.target.value as Flag); setConfirming(false); }} className={choice}>
                <option value="">No change</option>
                <option value="on">On</option>
                <option value="off">Off</option>
              </select>
            </label>
            <label className={field}>
              Signed
              <select value={signed} onChange={(e) => { setSigned(e.target.value as Flag); setConfirming(false); }} className={choice}>
                <option value="">No change</option>
                <option value="on">On</option>
                <option value="off">Off</option>
              </select>
            </label>
            <label className={field}>
              Unhauled
              <select value={unhauled} onChange={(e) => { setUnhauled(e.target.value as Flag); setConfirming(false); }} className={choice}>
                <option value="">No change</option>
                <option value="on">Unhauled</option>
                <option value="off">On the shelf</option>
              </select>
            </label>
          </div>

          <label className={field}>
            Owner
            <select value={owner} onChange={(e) => { setOwner(e.target.value); setConfirming(false); }} className={choice}>
              <option value="">No change</option>
              {members.map((m) => (
                <option key={m.userId} value={m.userId}>
                  {m.displayName}
                </option>
              ))}
              <option value="shared">Shared</option>
            </select>
          </label>

          <label className={field}>
            Location
            <select
              value={locationMode}
              onChange={(e) => { setLocationMode(e.target.value as TextMode); setConfirming(false); }}
              className={choice}
            >
              <option value="">No change</option>
              <option value="set">Set location</option>
              <option value="clear">Clear location</option>
            </select>
          </label>
          {locationMode === "set" && (
            <label className={field}>
              Location name
              <input
                type="text"
                value={location}
                list={locationList}
                onChange={(e) => { setLocation(e.target.value); setConfirming(false); }}
                className={choice}
              />
              <datalist id={locationList}>
                {locations.map((l) => (
                  <option key={l} value={l} />
                ))}
              </datalist>
            </label>
          )}

          <label className={field}>
            Series
            <select
              value={seriesMode}
              onChange={(e) => { setSeriesMode(e.target.value as TextMode); setConfirming(false); }}
              className={choice}
            >
              <option value="">No change</option>
              <option value="set">Set series</option>
              <option value="clear">Clear series</option>
            </select>
          </label>
          {seriesMode === "set" && (
            <label className={field}>
              Series name
              <input
                type="text"
                value={series}
                list={seriesList}
                maxLength={MAX_SERIES}
                onChange={(e) => { setSeries(e.target.value); setConfirming(false); }}
                className={choice}
              />
              <datalist id={seriesList}>
                {allSeries.map((s) => (
                  <option key={s} value={s} />
                ))}
              </datalist>
            </label>
          )}
          {seriesMode !== "" && <p className="text-xs text-muted">Applies to every selected book. Volumes stay as they are.</p>}

          {tagsOn && (
            <div>
              <h3 className="text-sm font-medium">Library tags</h3>
              <p className="text-xs text-muted">Applies to every selected book.</p>
              <div className="mt-2 space-y-2">
                <LibraryTagPicker
                  label="Add tags"
                  vocabulary={tagging.vocabulary}
                  offered={activeTags.filter((id) => !removeTags.includes(id))}
                  selected={addTags}
                  onChange={(ids) => { setAddTags(ids); setConfirming(false); }}
                />
                <LibraryTagPicker
                  label="Remove tags"
                  vocabulary={tagging.vocabulary}
                  offered={removable.filter((id) => !addTags.includes(id))}
                  selected={removeTags}
                  onChange={(ids) => { setRemoveTags(ids); setConfirming(false); }}
                />
              </div>
            </div>
          )}

          {readOn && (
            <div>
              <label className={field}>
                Mark as… (for you)
                <select
                  value={markMode}
                  onChange={(e) => { setMarkMode(e.target.value as MarkMode); setConfirming(false); }}
                  className={choice}
                >
                  <option value="">No change</option>
                  <option value="read">Read</option>
                  <option value="dnf">Did not finish</option>
                  <option value="unread">Unread</option>
                </select>
              </label>
              {markMode === "read" && (
                <>
                  <label className={`${field} mt-2`}>
                    Finish date
                    <input
                      type="date"
                      value={finishDate}
                      onChange={(e) => { setFinishDate(e.target.value); setConfirming(false); }}
                      className={choice}
                    />
                  </label>
                  <p className="mt-1 text-xs text-muted">Blank keeps existing dates; books without one get today.</p>
                </>
              )}
            </div>
          )}

          <div>
            <h3 className="text-sm font-medium">Copies</h3>
            <p className="text-xs text-muted">
              Copy changes apply to ticked copies. Copies already unhauled start unticked.
            </p>
            <div className="mt-2 space-y-2">
              {selected.map((b) => (
                <fieldset key={b.id} className="rounded border p-2">
                  <legend className="px-1 text-sm font-medium">{b.title}</legend>
                  {b.copies.length === 0 ? (
                    <p className="text-sm text-muted">No copies.</p>
                  ) : (
                    b.copies.map((c) => (
                      <label key={c.id} className={`flex min-h-10 items-center gap-2 text-sm ${isUnhauled(c) ? "text-muted" : ""}`}>
                        <input type="checkbox" checked={ticked.has(c.id)} onChange={() => toggle(c.id)} className="h-5 w-5 accent-accent" />
                        <span>{copyText(c, members)}</span>
                      </label>
                    ))
                  )}
                </fieldset>
              ))}
            </div>
          </div>
        </fieldset>

        {tagsOn && (
          <div className="mt-3 space-y-2">
            <h3 className="text-sm font-medium">Retag</h3>
            <RetagConfirm
              label="Retag selected"
              bookIds={selected.map((b) => b.id)}
              budget={tagging.budgets.tagging}
              disabled={busy || result !== null}
              onRetag={tagging.retagMany}
            />
          </div>
        )}
      </div>

    </Sheet>
  );
}
