import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import CoverBatchFooter from "@/components/covers/CoverBatchFooter";
import NothingFoundList from "@/components/covers/NothingFoundList";
import { BottomBar } from "@/components/ui";
import { useCoverFinder } from "@/contexts/CoverFinderContext";
import { useHousehold } from "@/contexts/HouseholdContext";
import { useCatalog } from "@/hooks/useCatalog";
import { useRestoreScroll } from "@/hooks/useRestoreScroll";
import { useTagging } from "@/contexts/TaggingContext";
import { ASK_MAX_BOOKS, ASK_MAX_PROMPT, askBookIds, askRows, filterView } from "@/lib/ask";
import { useReading } from "@/contexts/ReadingContext";
import { readStatusOptions } from "@/lib/reading/filter-options";
import { remainingMicro } from "@/lib/covers/cost";
import { editionLabels } from "@/lib/editions";
import { hasUnhauledCopy } from "@/lib/copy-flags";
import { dateAddedOptions } from "@/lib/date-added";
import { showsUnhauled } from "@/lib/filter-books";
import { COVER_SIZES, DEFAULT_COVER_SIZE } from "@/lib/cover-size";
import { useDevicePref } from "@/lib/device-prefs";
import { activeFilterChips, clearAllPatch, type FilterChip } from "@/lib/filter-chips";
import { currentLibraryView, useLibraryView } from "@/lib/library-view";
import type { AskResponse } from "@/lib/tagging/types";
import { navigate } from "@/lib/router";
import { seriesNames } from "@/lib/series";
import { SORT_KEYS, sortBooks } from "@/lib/sort-books";
import { loadTosTags, type TosTag } from "@/lib/tos-tags";
import AskResults from "./AskResults";
import CoverWall from "./CoverWall";
import FilterChipsRow from "./FilterChipsRow";
import LibraryFilters from "./LibraryFilters";
import LibraryToolbar from "./LibraryToolbar";
import MassEditSheet from "./MassEditSheet";

export default function LibraryPage({ series: routeSeries }: { series?: string } = {}) {
  const { household, members } = useHousehold();
  const { books, tags, loading, error, tagsError, reload, refresh } = useCatalog();
  // D9: the view outlives this page, so going back from a book finds the search and filters intact.
  const householdId = household?.id ?? null;
  const [storedView, patch] = useLibraryView(householdId);
  const tagging = useTagging();
  // Library tags can only filter while tagging is available; a stale choice is ignored, not applied to empty lookups.
  const reading = useReading();
  const readOptions = useMemo(
    () => (reading.available && reading.userId ? readStatusOptions(members, reading.userId) : null),
    [reading.available, reading.userId, members],
  );
  // A stored read status only applies while reading is available and its member is still here.
  const readOption = useMemo(() => {
    const rs = storedView.readStatus;
    return rs ? readOptions?.find((o) => o.readStatus?.userId === rs.userId && o.readStatus.state === rs.state) ?? null : null;
  }, [storedView.readStatus, readOptions]);
  const view = useMemo(() => {
    const libraryTags = tagging.available ? storedView.libraryTags : [];
    const readStatus = readOption ? storedView.readStatus : null;
    return libraryTags === storedView.libraryTags && readStatus === storedView.readStatus
      ? storedView
      : { ...storedView, libraryTags, readStatus };
  }, [storedView, tagging.available, readOption]);
  const readStatusByBook = reading.byBook;
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
  // D5/D4: per-device view preferences. Sort is not part of the view: it never clears Ask or enters viewKey.
  const [sort, setSort] = useDevicePref("tpl_library_sort", SORT_KEYS, "title");
  const [coverSize, setCoverSize] = useDevicePref("tpl_cover_size", COVER_SIZES, DEFAULT_COVER_SIZE);
  // D6: the panel's open state is local, so it is closed again on coming back from a book.
  const [filtersOpen, setFiltersOpen] = useState(false);
  const filtersId = useId();
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
      readStatusByBook,
    });
    // D5: within a series sortBooks always gives volume order (nulls last), whatever the sort.
    return sortBooks(found, sort, { series });
  }, [books, view, tags, tagging.libraryTagsByBook, series, cover, readStatusByBook, sort]);
  // D6: chips come from the effective view, so a dropped library-tag or read-status choice never shows.
  const chips = useMemo(
    () =>
      activeFilterChips(view, {
        series,
        members,
        tosTags,
        libraryVocabulary: tagging.available ? tagging.vocabulary : [],
        readOptions,
        coversAvailable,
      }),
    [view, series, members, tosTags, tagging.available, tagging.vocabulary, readOptions, coversAvailable],
  );
  // D11: the Ask set is the view as if the box were empty.
  const askIds = useMemo(
    () =>
      tagging.available
        ? askBookIds(books, view, {
            tagsByBook: tags,
            libraryTagsByBook: tagging.libraryTagsByBook,
            series,
            cover,
            readStatusByBook,
          })
        : [],
    [tagging.available, books, view, tags, tagging.libraryTagsByBook, series, cover, readStatusByBook],
  );
  // ToS reserves per Ask call (reserveMicro is 0), so the cap is simply nothing left.
  const askBudgetUsedUp = tagging.budgets.ask !== null && remainingMicro(tagging.budgets.ask) <= 0;
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
  function removeChip(chip: FilterChip) {
    if (chip.clear === "series") changeSeries(null);
    else patch(chip.clear);
  }
  // D6: every filter back to its default except the search text; the series leaves the route.
  function clearAllFilters() {
    patch(clearAllPatch());
    if (series !== null) changeSeries(null);
  }

  if (loading) return <p className="p-6">Loading…</p>;
  if (error) {
    return (
      <div className="p-6">
        <p role="alert" className="mb-3 text-danger">
          {error}
        </p>
        <button
          type="button"
          onClick={() => void reload()}
          className="rounded bg-accent px-3 py-2 text-on-accent"
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
          className="rounded bg-accent px-3 py-2 text-on-accent"
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
  const canSelect = askView === null && visible.length > 0 && !showNothingFound;
  // Ruling D: the page's single live count. While Ask results show, it carries their matches count.
  const countText =
    askView !== null
      ? askView.status === "done" && askCount > 0
        ? `${askCount} ${askCount === 1 ? "match" : "matches"}`
        : ""
      : visible.length === 0
        ? "No matching books"
        : `${visible.length} ${visible.length === 1 ? "book" : "books"}`;
  return (
    <div ref={pageRef}>
      {/* No backdrop-filter: it would trap the fixed sheets and bars inside this block. */}
      <div className="sticky top-[var(--toolbar-top)] z-20 bg-surface/95 border-b border-line">
        <LibraryToolbar
          query={query}
          onQuery={(query) => patch({ query })}
          ask={tagging.available ? { disabled: askDisabled, note: askNote, onAsk: () => void runAsk() } : undefined}
          filtersCount={chips.length}
          filtersOpen={filtersOpen}
          onToggleFilters={() => setFiltersOpen((o) => !o)}
          filtersId={filtersId}
          sort={sort}
          onSort={setSort}
          seriesOrder={series !== null}
          size={coverSize}
          onSize={setCoverSize}
          selecting={selecting}
          canSelect={canSelect}
          allShownSelected={allShownSelected}
          onSelect={startSelecting}
          onSelectAll={() => setSelectedIds((prev) => new Set([...prev, ...visible.map((b) => b.id)]))}
        />
        <FilterChipsRow
          chips={chips}
          count={
            <p aria-live="polite" className="text-sm text-muted">
              {countText}
            </p>
          }
          onRemove={removeChip}
          onClearAll={clearAllFilters}
        />
        {/* Task 11 replaces this slot with the filters panel; until then LibraryFilters opens here. */}
        {filtersOpen && (
          <div id={filtersId} className="max-h-[60vh] overflow-y-auto border-t border-line">
            <LibraryFilters
              owner={owner}
              edition={edition}
              tagFilter={tagFilter}
              series={series}
              tosTags={tosTags}
              seriesNames={names}
              labels={labels}
              members={members}
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
              readStatusFilter={
                readOptions
                  ? {
                      options: readOptions,
                      value: readOption?.value ?? "any",
                      onChange: (v) => patch({ readStatus: readOptions.find((o) => o.value === v)?.readStatus ?? null }),
                    }
                  : undefined
              }
            />
          </div>
        )}
      </div>
      {editStatus && (
        <p role="status" className="px-4 pt-3 text-sm">
          {editStatus}
        </p>
      )}
      {askView !== null ? (
        <AskResults view={askView} books={books} viewKey={viewKey} onClear={() => patch({ ask: null })} />
      ) : visible.length === 0 ? null : showNothingFound ? (
        <NothingFoundList books={visible} />
      ) : (
        <div className={showFooter || selecting ? "pb-32" : undefined}>
          <CoverWall
            books={visible}
            viewKey={viewKey}
            size={coverSize}
            selection={selecting ? { ids: selectedIds, toggle: toggleSelected } : undefined}
          />
        </div>
      )}
      {showFooter && <CoverBatchFooter books={visible} />}
      {showSelecting && (
        <BottomBar label="Selection">
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
                className="min-h-10 rounded bg-accent px-3 text-on-accent disabled:bg-control disabled:text-muted"
              >
                Edit
              </button>
            </div>
          </div>
        </BottomBar>
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
