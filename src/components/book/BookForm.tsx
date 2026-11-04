import { useState } from "react";
import type { BookInput } from "@/lib/types";
import { normalizeBookInput, splitList } from "@/lib/normalize";

const list = splitList;

export default function BookForm({
  initial,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  initial: BookInput;
  submitLabel: string;
  onSubmit(value: BookInput): Promise<void>;
  onCancel?(): void;
}) {
  const [title, setTitle] = useState(initial.title);
  const [authors, setAuthors] = useState(initial.authors.join(", "));
  const [synopsis, setSynopsis] = useState(initial.synopsis ?? "");
  const [coverUrl, setCoverUrl] = useState(initial.coverUrl ?? "");
  const [isbn13, setIsbn13] = useState(initial.isbn13.join(", "));
  const [isbn10, setIsbn10] = useState(initial.isbn10.join(", "));
  const [pageCount, setPageCount] = useState(initial.pageCount?.toString() ?? "");
  const [publisher, setPublisher] = useState(initial.publisher ?? "");
  const [publishDate, setPublishDate] = useState(initial.publishDate ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim() || list(authors).length === 0) {
      setError("Title and at least one author are required.");
      return;
    }
    const pages = pageCount.trim() ? Number(pageCount) : null;
    if (pages !== null && (!Number.isInteger(pages) || pages < 0)) {
      setError("Page count must be a whole number.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onSubmit(
        normalizeBookInput({
          title,
          authors: list(authors),
          synopsis,
          coverUrl,
          isbn13: list(isbn13),
          isbn10: list(isbn10),
          pageCount: pages,
          publisher,
          publishDate,
        }),
      );
    } catch (err) {
      console.error("Failed to save book", err);
      setError("Couldn't save the book.");
    } finally {
      setBusy(false);
    }
  }

  const input = "mt-1 block w-full rounded border p-2";
  return (
    <form onSubmit={submit} className="space-y-2">
      <label className="block text-sm">
        Title
        <input value={title} onChange={(e) => setTitle(e.target.value)} className={input} />
      </label>
      <label className="block text-sm">
        Authors (comma separated)
        <input value={authors} onChange={(e) => setAuthors(e.target.value)} className={input} />
      </label>
      <label className="block text-sm">
        Synopsis
        <textarea value={synopsis} onChange={(e) => setSynopsis(e.target.value)} className={input} rows={4} />
      </label>
      <label className="block text-sm">
        Cover URL
        <input value={coverUrl} onChange={(e) => setCoverUrl(e.target.value)} className={input} />
      </label>
      <label className="block text-sm">
        ISBN-13 (comma separated)
        <input value={isbn13} onChange={(e) => setIsbn13(e.target.value)} className={input} />
      </label>
      <label className="block text-sm">
        ISBN-10 (comma separated)
        <input value={isbn10} onChange={(e) => setIsbn10(e.target.value)} className={input} />
      </label>
      <label className="block text-sm">
        Page count
        <input value={pageCount} onChange={(e) => setPageCount(e.target.value)} inputMode="numeric" className={input} />
      </label>
      <label className="block text-sm">
        Publisher
        <input value={publisher} onChange={(e) => setPublisher(e.target.value)} className={input} />
      </label>
      <label className="block text-sm">
        Publish date
        <input value={publishDate} onChange={(e) => setPublishDate(e.target.value)} className={input} />
      </label>
      {error && (
        <p role="alert" className="text-red-700">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <button type="submit" disabled={busy} className="rounded bg-stone-800 px-3 py-2 text-white">
          {submitLabel}
        </button>
        {onCancel && (
          <button type="button" onClick={onCancel} className="underline">
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}
