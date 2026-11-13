import { useEffect, useMemo, useRef, useState } from "react";
import CoverBatchFooter from "@/components/covers/CoverBatchFooter";
import NothingFoundList from "@/components/covers/NothingFoundList";
import { useCoverFinder } from "@/contexts/CoverFinderContext";
import { useHousehold } from "@/contexts/HouseholdContext";
import { useCatalog } from "@/hooks/useCatalog";
import { useRestoreScroll } from "@/hooks/useRestoreScroll";
import { applyCoverFilter } from "@/lib/covers/eligibility";
import { editionLabels } from "@/lib/editions";
import { hasUnhauledCopy } from "@/lib/copy-flags";
import { dateAddedOptions } from "@/lib/date-added";
import { filterBooks, showsUnhauled } from "@/lib/filter-books";
import { useLibraryView } from "@/lib/library-view";
import { navigate } from "@/lib/router";
import { seriesNames } from "@/lib/series";
import { loadTosTags, type TosTag } from "@/lib/tos-tags";
import CoverWall from "./CoverWall";
import LibraryFilters from "./LibraryFilters";

export default function LibraryPage({ series: routeSeries }: { series?: string } = {}) {
  const { household, members } = useHousehold();
  const { books, tags, loading, error, tagsError, reload } = useCatalog();
  // D9: the view outlives this page, so going back from a book finds the search and filters intact.
  const [view, patch] = useLibraryView(household?.id ?? null);
  const { query, owner, edition, tags: tagFilter, coverFilter, unhauled, deluxe, signed, addedDay, publishedFrom, publishedTo } =
    view;
  const [series, setSeries] = useState<string | null>(routeSeries ?? null);
  const { available: coversAvailable, marks, latest } = useCoverFinder();
  const [tosTags, setTosTags] = useState<TosTag[]>([]);
  // The series stays in the route; the anchor's key covers both.
  const viewKey = JSON.stringify({ ...view, series: routeSeries ?? null });
  const pageRef = useRef<HTMLDivElement>(null);
  useRestoreScroll(!loading, viewKey, pageRef);
  useEffect(() => {
    setSeries(routeSeries ?? null);
  }, [routeSeries]);
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
    const filtered = filterBooks(books, {
      query,
      owner,
      edition,
      tags: tagFilter,
      tagsByBook: tags,
      series,
      unhauled,
      deluxe,
      signed,
      addedDay,
      publishedFrom,
      publishedTo,
    });
    const found = coversAvailable ? applyCoverFilter(filtered, coverFilter, marks, latest) : filtered;
    if (!series) return found;
    // D5: within a series, volume order (nulls last), so 2.5 sorts between 2 and 3.
    return [...found].sort(
      (a, b) =>
        (a.seriesVolume ?? Infinity) - (b.seriesVolume ?? Infinity) || a.title.localeCompare(b.title),
    );
  }, [
    books,
    query,
    owner,
    edition,
    tagFilter,
    tags,
    series,
    unhauled,
    deluxe,
    signed,
    addedDay,
    publishedFrom,
    publishedTo,
    coversAvailable,
    coverFilter,
    marks,
    latest,
  ]);
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
  function changeSeries(next: string | null) {
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
  const showNothingFound = coversAvailable && coverFilter === "nothing_found";
  const showFooter = coversAvailable && (coverFilter === "no_cover" || coverFilter === "marked");
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
      />
      <p aria-live="polite" className={visible.length === 0 ? "p-6 text-center" : "px-4 pt-3 text-sm text-stone-600"}>
        {visible.length === 0 ? "No matching books" : `${visible.length} ${visible.length === 1 ? "book" : "books"}`}
      </p>
      {visible.length === 0 ? null : showNothingFound ? (
        <NothingFoundList books={visible} />
      ) : (
        <div className={showFooter ? "pb-32" : undefined}>
          <CoverWall books={visible} viewKey={viewKey} />
        </div>
      )}
      {showFooter && <CoverBatchFooter books={visible} />}
    </div>
  );
}
