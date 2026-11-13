import { useEffect, useMemo, useState } from "react";
import CoverBatchFooter from "@/components/covers/CoverBatchFooter";
import NothingFoundList from "@/components/covers/NothingFoundList";
import { useCoverFinder } from "@/contexts/CoverFinderContext";
import { useHousehold } from "@/contexts/HouseholdContext";
import { useCatalog } from "@/hooks/useCatalog";
import { applyCoverFilter, type CoverFilter } from "@/lib/covers/eligibility";
import { editionLabels } from "@/lib/editions";
import { filterBooks, type OwnerFilter } from "@/lib/filter-books";
import { navigate } from "@/lib/router";
import { seriesNames } from "@/lib/series";
import { loadTosTags, type TosTag } from "@/lib/tos-tags";
import CoverWall from "./CoverWall";
import LibraryFilters from "./LibraryFilters";

export default function LibraryPage({ series: routeSeries }: { series?: string } = {}) {
  const { members } = useHousehold();
  const { books, tags, loading, error, tagsError, reload } = useCatalog();
  const [query, setQuery] = useState("");
  const [owner, setOwner] = useState<OwnerFilter>("all");
  const [edition, setEdition] = useState<string | null>(null);
  const [tagFilter, setTagFilter] = useState<string[]>([]);
  const [series, setSeries] = useState<string | null>(routeSeries ?? null);
  const [coverFilter, setCoverFilter] = useState<CoverFilter>("all");
  const { available: coversAvailable, marks, latest } = useCoverFinder();
  const [tosTags, setTosTags] = useState<TosTag[]>([]);
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
    const filtered = filterBooks(books, { query, owner, edition, tags: tagFilter, tagsByBook: tags, series });
    const found = coversAvailable ? applyCoverFilter(filtered, coverFilter, marks, latest) : filtered;
    if (!series) return found;
    // D5: within a series, volume order (nulls last), so 2.5 sorts between 2 and 3.
    return [...found].sort(
      (a, b) =>
        (a.seriesVolume ?? Infinity) - (b.seriesVolume ?? Infinity) || a.title.localeCompare(b.title),
    );
  }, [books, query, owner, edition, tagFilter, tags, series, coversAvailable, coverFilter, marks, latest]);
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
    <div>
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
        onQuery={setQuery}
        onOwner={setOwner}
        onEdition={setEdition}
        onTagFilter={setTagFilter}
        onSeries={changeSeries}
        tagsUnavailable={tagsError !== null}
        coverFilter={coverFilter}
        coversAvailable={coversAvailable}
        onCoverFilter={setCoverFilter}
      />
      {visible.length === 0 ? (
        <p className="p-6 text-center">No matching books</p>
      ) : showNothingFound ? (
        <NothingFoundList books={visible} />
      ) : (
        <div className={showFooter ? "pb-32" : undefined}>
          <CoverWall books={visible} />
        </div>
      )}
      {showFooter && <CoverBatchFooter books={visible} />}
    </div>
  );
}
