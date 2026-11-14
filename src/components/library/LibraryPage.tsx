import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import CoverBatchFooter from "@/components/covers/CoverBatchFooter";
import NothingFoundList from "@/components/covers/NothingFoundList";
import { useCoverFinder } from "@/contexts/CoverFinderContext";
import { useHousehold } from "@/contexts/HouseholdContext";
import { useCatalog } from "@/hooks/useCatalog";
import { useRestoreScroll } from "@/hooks/useRestoreScroll";
import { useTagging } from "@/contexts/TaggingContext";
import { ASK_MAX_BOOKS, ASK_MAX_PROMPT, askBookIds, askRows, filterView } from "@/lib/ask";
import { budgetUsedUp } from "@/lib/covers/cost";
import { editionLabels } from "@/lib/editions";
import { hasUnhauledCopy } from "@/lib/copy-flags";
import { dateAddedOptions } from "@/lib/date-added";
import { showsUnhauled } from "@/lib/filter-books";
import { currentLibraryView, useLibraryView } from "@/lib/library-view";
import type { AskResponse } from "@/lib/tagging/types";
import { navigate } from "@/lib/router";
import { seriesNames } from "@/lib/series";
import { loadTosTags, type TosTag } from "@/lib/tos-tags";
import AskResults from "./AskResults";
import CoverWall from "./CoverWall";
import LibraryFilters from "./LibraryFilters";
import MassEditSheet from "./MassEditSheet";

export default function LibraryPage({ series: routeSeries }: { series?: string } = {}) {
  const { household, members } = useHousehold();
  const { books, tags, loading, error, tagsError, reload, refresh } = useCatalog();
  // D9: the view outlives this page, so going back from a book finds the search and filters intact.
  const householdId = household?.id ?? null;
  const [storedView, patch] = useLibraryView(householdId);
  const tagging = useTagging();
  // Library tags can only filter while tagging is available; a stale choice is ignored, not applied to empty lookups.
  const view = useMemo(
    () => (tagging.available || storedView.libraryTags.length === 0 ? storedView : { ...storedView, libraryTags: [] }),
    [storedView, tagging.available],
  );
  const { query, owner, edition, tags: tagFilter, coverFilter, unhauled, deluxe, signed, addedDay, publishedFrom, publishedTo } =
    view;
  const [series, setSeries] = useState<string | null>(routeSeries ?? null);
  const { available: coversAvailable, marks, latest } = useCoverFinder();
  const cover = useMemo(() => ({ available: coversAvailable, marks, latest }), [coversAvailable, marks, latest]);
  // One Ask at a time: the ref stops a double tap before the next render, the state shows it.
  const askingRef = useRef(false);
  const [asking, setAsking] = useState(false);
  const [tosTags, setTosTags] = useState<TosTag[]>([]);
  // Select mode: plain state, so the ticks stay while scrolling and changing the search or filters.
  const [selecting, setSelecting] = useState(false);
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(new Set());
  const [editing, setEditing] = useState(false);
  const [editStatus, setEditStatus] = useState<string | null>(null);
  // The series stays in the route; the anchor's key covers both.
  const viewKey = JSON.stringify({ ...view, series: routeSeries ?? null });
  const pageRef = useRef<HTMLDivElement>(null);
  useRestoreScroll(!loading, viewKey, pageRef);
  // D11: the series is part of the view, so changing it clears Ask results (and drops an in-flight answer).
  const clearAsk = useCallback(() => {
    if (currentLibraryView(householdId).ask !== null) patch({ ask: null });
  }, [householdId, patch]);
  const routeSeriesRef = useRef(routeSeries ?? null);
  useEffect(() => {
    const next = routeSeries ?? null;
    if (next === routeSeriesRef.current) return;
    routeSeriesRef.current = next;
    setSeries(next);
    clearAsk();
  }, [routeSeries, clearAsk]);
  useEffect(() => {
    let cancelled = false;
    void loadTosTags().then((r) => {
      if (!cancelled) setTosTags(r.tags);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  const labels = useMemo(() => editionLabels(books, []), [books]);
  const names = useMemo(() => seriesNames(books), [books]);
  const visible = useMemo(() => {
    const found = filterView(books, view, {
      tagsByBook: tags,
      libraryTagsByBook: tagging.libraryTagsByBook,
      series,
      cover,
    });
    if (!series) return found;
    // D5: within a series, volume order (nulls last), so 2.5 sorts between 2 and 3.
    return [...found].sort(
      (a, b) =>
        (a.seriesVolume ?? Infinity) - (b.seriesVolume ?? Infinity) || a.title.localeCompare(b.title),
    );
  }, [books, view, tags, tagging.libraryTagsByBook, series, cover]);
  // D11: the Ask set is the view as if the box were empty.
  const askIds = useMemo(
    () => (tagging.available ? askBookIds(books, view, tags, tagging.libraryTagsByBook, series, cover) : []),
    [tagging.available, books, view, tags, tagging.libraryTagsByBook, series, cover],
  );
  const askBudgetUsedUp = tagging.budgets.ask !== null && budgetUsedUp(tagging.budgets.ask);
  const askTooMany = askIds.length > ASK_MAX_BOOKS;
  const askDisabled =
    query.trim() === "" || asking || view.ask?.status === "asking" || askBudgetUsedUp || askTooMany;
  const askNote = askBudgetUsedUp
    ? "This month's Ask budget is used up."
    : askTooMany
      ? "Too many books to ask about at once. Narrow the filters."
      : null;
  // D8: the Date added menu comes from the books the unhauled rule lets through, before the other filters.
  const showUnhauled = showsUnhauled({ query, unhauled });
  const addedOptions = useMemo(() => {
    const pool = unhauled
      ? books.filter(hasUnhauledCopy)
      : query.trim() !== ""
        ? books
        : books.filter((b) => b.onShelf);
    return dateAddedOptions(pool, showUnhauled, addedDay);
  }, [books, unhauled, query, showUnhauled, addedDay]);
  // Books in catalogue order; a book deleted meanwhile drops out.
  const selectedBooks = useMemo(() => books.filter((b) => selectedIds.has(b.id)), [books, selectedIds]);
  function toggleSelected(bookId: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(bookId)) next.delete(bookId);
      else next.add(bookId);
      return next;
    });
  }
  function startSelecting() {
    setEditStatus(null);
    setSelecting(true);
  }
  function stopSelecting() {
    setSelecting(false);
    setEditing(false);
    setSelectedIds(new Set());
  }
  async function runAsk() {
    const prompt = query.trim().slice(0, ASK_MAX_PROMPT);
    if (askingRef.current || prompt === "" || askDisabled) return;
    askingRef.current = true;
    setAsking(true);
    patch({ ask: { prompt, status: "asking", response: null } });
    let response: AskResponse;
    try {
      response = await tagging.ask(prompt, askIds);
    } catch {
      response = { outcome: "failed" };
    } finally {
      askingRef.current = false;
      setAsking(false);
    }
    // A view change meanwhile (typing, a filter, Clear) cleared this Ask; its answer is dropped.
    const now = currentLibraryView(householdId).ask;
    if (now?.status === "asking" && now.prompt === prompt) patch({ ask: { prompt, status: "done", response } });
  }
  function changeSeries(next: string | null) {
    if (next !== series) clearAsk();
    setSeries(next);
    navigate({ name: "library", series: next ?? undefined });
  }

  if (loading) return <p className="p-6">Loading…</p>;
  if (error) {
    return (
      <div className="p-6">
        <p role="alert" className="mb-3 text-red-700">
          {error}
        </p>
        <button
          type="button"
          onClick={() => void reload()}
          className="rounded bg-stone-800 px-3 py-2 text-white"
        >
          Retry
        </button>
      </div>
    );
  }
  if (books.length === 0) {
    return (
      <div className="p-6 text-center">
        <p className="mb-3">No books yet</p>
        <button
          type="button"
          onClick={() => navigate({ name: "add" })}
          className="rounded bg-stone-800 px-3 py-2 text-white"
        >
          Add a book
        </button>
        <a href="#/inbox" className="ml-3 underline">
          Add from photos
        </a>
        <a href="#/import" className="ml-3 underline">
          Import from libib
        </a>
      </div>
    );
  }
  // D11: Ask results replace the wall, and hide select mode and the cover footer while they're up.
  const askView = tagging.available ? view.ask : null;
  const askCount = askView ? askRows(askView, books).length : 0;
  const showSelecting = selecting && askView === null;
  const showNothingFound = coversAvailable && coverFilter === "nothing_found";
  // The cover batch footer and the selection bar share the bottom edge; selecting wins.
  const showFooter =
    !selecting && askView === null && coversAvailable && (coverFilter === "no_cover" || coverFilter === "marked");
  const allShownSelected = visible.length > 0 && visible.every((b) => selectedIds.has(b.id));
  return (
    <div ref={pageRef}>
      <LibraryFilters
        query={query}
        owner={owner}
        edition={edition}
        tagFilter={tagFilter}
        series={series}
        tosTags={tosTags}
        seriesNames={names}
        labels={labels}
        members={members}
        onQuery={(query) => patch({ query })}
        onOwner={(owner) => patch({ owner })}
        onEdition={(edition) => patch({ edition })}
        onTagFilter={(tags) => patch({ tags })}
        onSeries={changeSeries}
        tagsUnavailable={tagsError !== null}
        coverFilter={coverFilter}
        coversAvailable={coversAvailable}
        onCoverFilter={(coverFilter) => patch({ coverFilter })}
        unhauled={unhauled}
        deluxe={deluxe}
        signed={signed}
        addedDay={addedDay}
        addedOptions={addedOptions}
        publishedFrom={publishedFrom}
        publishedTo={publishedTo}
        onChange={patch}
        libraryTagFilter={
          tagging.available
            ? { vocabulary: tagging.vocabulary, selected: view.libraryTags, onChange: (libraryTags) => patch({ libraryTags }) }
            : undefined
        }
        ask={tagging.available ? { disabled: askDisabled, note: askNote, onAsk: () => void runAsk() } : undefined}
      />
      {editStatus && (
        <p role="status" className="px-4 pt-3 text-sm">
          {editStatus}
        </p>
      )}
      {askView !== null ? (
        <>
          {askView.status === "done" && askCount > 0 && (
            <p aria-live="polite" className="px-4 pt-3 text-sm text-stone-600">
              {`${askCount} ${askCount === 1 ? "match" : "matches"}`}
            </p>
          )}
          <AskResults view={askView} books={books} viewKey={viewKey} onClear={() => patch({ ask: null })} />
        </>
      ) : (
        <>
      <div className={visible.length === 0 ? "p-6 text-center" : "flex items-center justify-between gap-2 px-4 pt-3"}>
        <p aria-live="polite" className={visible.length === 0 ? undefined : "text-sm text-stone-600"}>
          {visible.length === 0 ? "No matching books" : `${visible.length} ${visible.length === 1 ? "book" : "books"}`}
        </p>
        {visible.length > 0 && !showNothingFound && (
          <div className="flex gap-2">
            {selecting ? (
              <button
                type="button"
                disabled={allShownSelected}
                onClick={() => setSelectedIds((prev) => new Set([...prev, ...visible.map((b) => b.id)]))}
                className="min-h-10 rounded border px-3 text-sm disabled:opacity-50"
              >
                Select all
              </button>
            ) : (
              <button type="button" onClick={startSelecting} className="min-h-10 rounded border px-3 text-sm">
                Select
              </button>
            )}
          </div>
        )}
      </div>
      {visible.length === 0 ? null : showNothingFound ? (
        <NothingFoundList books={visible} />
      ) : (
        <div className={showFooter || selecting ? "pb-32" : undefined}>
          <CoverWall
            books={visible}
            viewKey={viewKey}
            selection={selecting ? { ids: selectedIds, toggle: toggleSelected } : undefined}
          />
        </div>
      )}
        </>
      )}
      {showFooter && <CoverBatchFooter books={visible} />}
      {showSelecting && (
        <div
          role="region"
          aria-label="Selection"
          className="fixed inset-x-0 bottom-0 z-10 border-t bg-white p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]"
        >
          <div className="mx-auto flex max-w-3xl items-center justify-between gap-2">
            <p className="text-sm font-medium">{`${selectedBooks.length} selected`}</p>
            <div className="flex gap-2">
              {selectedBooks.length > 0 && (
                <button type="button" onClick={() => setSelectedIds(new Set())} className="min-h-10 rounded border px-3">
                  Clear
                </button>
              )}
              <button type="button" onClick={stopSelecting} className="min-h-10 rounded border px-3">
                Done
              </button>
              <button
                type="button"
                disabled={selectedBooks.length === 0}
                onClick={() => setEditing(true)}
                className="min-h-10 rounded bg-stone-800 px-3 text-white disabled:opacity-50"
              >
                Edit
              </button>
            </div>
          </div>
        </div>
      )}
      {editing && showSelecting && selectedBooks.length > 0 && (
        <MassEditSheet
          selected={selectedBooks}
          catalog={books}
          labels={labels}
          members={members}
          refresh={refresh}
          onClose={() => setEditing(false)}
          onDone={(summary) => {
            setEditStatus(summary);
            stopSelecting();
          }}
        />
      )}
    </div>
  );
}
