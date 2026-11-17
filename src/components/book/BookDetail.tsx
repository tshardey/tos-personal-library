import { useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useHousehold } from "@/contexts/HouseholdContext";
import { useCopyPhotoUrls } from "@/hooks/useCopyPhotoUrls";
import { useCatalog } from "@/hooks/useCatalog";
import { addCopy, deleteBook, updateBook } from "@/lib/library-repo";
import { diffPatch, markEdited } from "@/lib/edited-fields";
import { editionLabels } from "@/lib/editions";
import { seriesNames } from "@/lib/series";
import { loadTosTags, type TosTag } from "@/lib/tos-tags";
import { listOpenEditionLabels } from "@/lib/photo/intake-repo";
import { normalizeBookInput } from "@/lib/normalize";
import { navigate } from "@/lib/router";
import type { BookInput, BookWithCopies } from "@/lib/types";
import { isUnhauled } from "@/lib/copy-flags";
import BookForm from "./BookForm";
import CopyForm from "./CopyForm";
import CopyList from "./CopyList";
import FindCoverPanel from "@/components/covers/FindCoverPanel";
import { useCoverFinder } from "@/contexts/CoverFinderContext";
import SeriesPicker from "@/components/series/SeriesPicker";
import TosTagsSection from "./TosTagsSection";
import LibraryTagsSection from "@/components/tags/LibraryTagsSection";
import { useTagging } from "@/contexts/TaggingContext";
import { YourReadingControl } from "@/components/reading/YourReadingSection";
import MarkReadButton from "@/components/reading/MarkReadButton";
import { useYourReading } from "@/components/reading/useYourReading";
import { Button, DotsIcon, Menu, Tabs } from "@/components/ui";
import { useDevicePref } from "@/lib/device-prefs";

export const BOOK_TABS = ["overview", "copies", "tags", "tos"] as const;
type BookTab = (typeof BOOK_TABS)[number];

const EDITABLE: (keyof BookInput)[] = [
  "title",
  "authors",
  "synopsis",
  "coverUrl",
  "isbn13",
  "isbn10",
  "pageCount",
  "publisher",
  "publishDate",
];

const NO_IDS: string[] = [];

function Cover({ book, photoUrl }: { book: BookWithCopies; photoUrl?: string }) {
  const [failed, setFailed] = useState(false);
  const [photoFailed, setPhotoFailed] = useState(false);
  return (
    <div className="mx-auto aspect-[2/3] w-40 overflow-hidden md:mx-0 md:w-full rounded bg-control shadow-sm">
      {book.coverUrl && !failed ? (
        <img
          src={book.coverUrl}
          alt={`${book.title} cover`}
          onError={() => setFailed(true)}
          className="h-full w-full object-cover"
        />
      ) : photoUrl && !photoFailed ? (
        <img
          src={photoUrl}
          alt={`${book.title}, photo of our copy`}
          onError={() => setPhotoFailed(true)}
          className="h-full w-full object-cover"
        />
      ) : (
        <div
          data-testid="cover-placeholder"
          className="flex h-full w-full items-center justify-center p-2 text-center text-sm font-semibold"
        >
          {book.title}
        </div>
      )}
    </div>
  );
}

export default function BookDetail({ id }: { id: string }) {
  const { household, members } = useHousehold();
  const { user } = useAuth();
  const { books, tags, loading, error, tagsError, reload, refresh } = useCatalog();
  const photoUrls = useCopyPhotoUrls(books);
  const { available: coverFinderAvailable } = useCoverFinder();
  const { available: taggingAvailable, tagsVersion } = useTagging();
  const [editing, setEditing] = useState(false);
  const [addingCopy, setAddingCopy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [savingSeries, setSavingSeries] = useState(false);
  const reading = useYourReading(id);
  const [tab, setTab] = useDevicePref<BookTab>("tpl_book_tab", BOOK_TABS, "overview");
  // Set by Mark read; the effect below focuses the group once the Overview tab has rendered it.
  const [focusReading, setFocusReading] = useState(false);
  const [openLabels, setOpenLabels] = useState<string[]>([]);
  const [tosTags, setTosTags] = useState<{ tags: TosTag[]; stale: boolean }>({ tags: [], stale: false });
  const householdId = household?.id;
  useEffect(() => {
    if (!householdId) return;
    let cancelled = false;
    listOpenEditionLabels(householdId).then(
      (l) => {
        if (!cancelled) setOpenLabels(l);
      },
      (err: unknown) => {
        console.error("Failed to load open edition labels", err instanceof Error ? err.name : "unknown");
      },
    );
    return () => {
      cancelled = true;
    };
  }, [householdId]);
  const labels = useMemo(() => editionLabels(books, openLabels), [books, openLabels]);
  const series = useMemo(() => seriesNames(books), [books]);
  useEffect(() => {
    let cancelled = false;
    void loadTosTags().then((r) => {
      if (!cancelled) setTosTags(r);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // A finished tagging job changes the ToS tags; reload them behind what is shown.
  const seenTagsVersion = useRef(tagsVersion);
  useEffect(() => {
    if (seenTagsVersion.current === tagsVersion) return;
    seenTagsVersion.current = tagsVersion;
    void refresh();
  }, [tagsVersion, refresh]);

  const groupRef = reading.groupRef;
  useEffect(() => {
    if (!focusReading) return;
    groupRef.current?.focus();
    setFocusReading(false);
  }, [focusReading, groupRef]);

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
  const book = books.find((b) => b.id === id);
  if (!book) {
    return (
      <div className="p-6">
        <p className="mb-3">Book not found</p>
        <a href="#/" className="underline">
          Back to library
        </a>
      </div>
    );
  }

  // Normalise like the form does, so untidy imported values don't read as user edits.
  const before: BookInput = normalizeBookInput({
    title: book.title,
    authors: book.authors,
    synopsis: book.synopsis,
    coverUrl: book.coverUrl,
    isbn13: book.isbn13,
    isbn10: book.isbn10,
    pageCount: book.pageCount,
    publisher: book.publisher,
    publishDate: book.publishDate,
  });

  const unhauledCount = book.copies.filter(isUnhauled).length;

  async function removeBook() {
    if (!window.confirm("Delete this book and all its copies?")) return;
    setActionError(null);
    try {
      await deleteBook(id);
      await reload();
      navigate({ name: "library" });
    } catch (err) {
      console.error("Failed to delete book", err);
      setActionError("Couldn't delete the book.");
    }
  }

  async function saveSeries(name: string | null, volume: number | null) {
    if (!book || savingSeries) return;
    setActionError(null);
    setSavingSeries(true);
    try {
      await updateBook(
        id,
        { seriesName: name, seriesVolume: volume },
        markEdited(book.userEditedFields, ["seriesName", "seriesVolume"]),
      );
      await reload();
    } catch (err) {
      console.error("Failed to save series", err instanceof Error ? err.name : "unknown");
      setActionError("Couldn't save the series.");
    } finally {
      setSavingSeries(false);
    }
  }

  function showReading() {
    setTab("overview");
    setFocusReading(true);
  }

  function startAddCopy() {
    setTab("copies");
    setAddingCopy(true);
  }

  const tabs = [
    { id: "overview", label: "Overview" },
    { id: "copies", label: `Copies (${book.copies.length})` },
    { id: "tags", label: "Tags" },
    { id: "tos", label: "Tome of Secrets" },
  ] as const satisfies readonly { id: BookTab; label: string }[];

  function panel(which: BookTab, b: BookWithCopies) {
    if (which === "overview") {
      return (
        <div className="space-y-4 pt-4">
          {b.synopsis && <p className="text-base">{b.synopsis}</p>}
          <YourReadingControl reading={reading} />
        </div>
      );
    }
    if (which === "copies") {
      return (
        <section className="pt-4">
          {unhauledCount > 0 && (
            <p className="text-sm text-muted">
              {b.copies.length - unhauledCount} on the shelf · {unhauledCount} unhauled
            </p>
          )}
          {!b.onShelf && b.copies.length > 0 && (
            <p className="mt-1 text-sm">
              Unhauled. This book is hidden from the library unless you search for it or use the Unhauled filter.
            </p>
          )}
          <CopyList
            copies={b.copies}
            members={members}
            labels={labels}
            onChanged={reload}
            onBookDeleted={() => {
              void reload();
              navigate({ name: "library" });
            }}
          />
          {addingCopy ? (
            <div className="mt-3">
              <CopyForm
                initial={{ ownerUserId: user?.id ?? null, editionNote: null, copyNote: null, location: null }}
                members={members}
                labels={labels}
                submitLabel="Add copy"
                onCancel={() => setAddingCopy(false)}
                onSubmit={async (copy) => {
                  await addCopy(id, copy);
                  setAddingCopy(false);
                  await reload();
                }}
              />
            </div>
          ) : (
            <Button className="mt-3" onClick={() => setAddingCopy(true)}>
              Add copy
            </Button>
          )}
        </section>
      );
    }
    if (which === "tags") {
      return (
        <div className="pt-4">
          {taggingAvailable ? (
            <LibraryTagsSection bookId={b.id} />
          ) : (
            <p className="text-sm text-muted">Library tags aren't available yet.</p>
          )}
        </div>
      );
    }
    return (
      <div className="pt-4">
        {householdId && (
          <TosTagsSection
            bookId={b.id}
            householdId={householdId}
            tagIds={tags.get(b.id) ?? NO_IDS}
            tosTags={tosTags.tags}
            stale={tosTags.stale}
            unavailable={tagsError !== null}
            onChange={() => {
              // The section keeps its own copy; a reload would unmount it and close the editor.
            }}
          />
        )}
      </div>
    );
  }

  return (
    <div className="mx-auto grid max-w-5xl gap-6 p-4 md:grid-cols-[240px_1fr] md:gap-8">
      <div className="space-y-3">
        <Cover key={book.coverUrl ?? ""} book={book} photoUrl={photoUrls.get(book.id)} />
        <div className="mx-auto flex w-40 flex-col gap-2 md:w-full">
          <Button variant="secondary" onClick={() => setEditing(true)}>
            Edit book
          </Button>
          {coverFinderAvailable && <FindCoverPanel book={book} />}
          <MarkReadButton reading={reading} onShowReading={showReading} />
          <Menu label="More actions" button={<DotsIcon />}>
            {(close) => (
              <div className="flex flex-col gap-1">
                <Button
                  variant="ghost"
                  onClick={() => {
                    close();
                    startAddCopy();
                  }}
                >
                  Add copy
                </Button>
                <Button
                  variant="danger"
                  onClick={() => {
                    close();
                    void removeBook();
                  }}
                >
                  Delete book
                </Button>
              </div>
            )}
          </Menu>
        </div>
      </div>
      <div className="min-w-0 space-y-4">
        <a href="#/" className="underline">
          Back to library
        </a>
        {editing ? (
          <BookForm
            initial={before}
            submitLabel="Save book"
            onCancel={() => setEditing(false)}
            onSubmit={async (next) => {
              const { changed, patch } = diffPatch(before, next, EDITABLE);
              await updateBook(id, patch, markEdited(book.userEditedFields, changed));
              setEditing(false);
              await reload();
            }}
          />
        ) : (
          <div>
            <h2 className="text-2xl font-semibold text-fg-strong md:text-3xl">{book.title}</h2>
            <p className="text-muted">{book.authors.join(", ")}</p>
          </div>
        )}
        {actionError && (
          <p role="alert" className="text-danger">
            {actionError}
          </p>
        )}
        <div className="space-y-1">
          <SeriesPicker
            value={book.seriesName}
            volume={book.seriesVolume}
            names={series}
            disabled={savingSeries}
            onChange={(name, volume) => void saveSeries(name, volume)}
          />
          {book.seriesName && (
            <button
              type="button"
              onClick={() => navigate({ name: "library", series: book.seriesName ?? undefined })}
              className="text-sm underline"
            >
              Show the rest of this series
            </button>
          )}
        </div>
        {!editing && (
          <Tabs label="Book sections" tabs={tabs} value={tab} onChange={setTab} panel={(t) => panel(t, book)} />
        )}
      </div>
    </div>
  );
}
