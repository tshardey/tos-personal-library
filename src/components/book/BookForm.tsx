import { useState } from "react";
import { Button } from "@/components/ui";
import type { BookInput } from "@/lib/types";
import { normalizeBookInput, splitAuthors, splitList } from "@/lib/normalize";

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
    if (!title.trim() || splitAuthors(authors).length === 0) {
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
          authors: splitAuthors(authors),
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

  const input = "mt-1 block w-full min-h-11 sm:min-h-9 rounded-md border border-field bg-control px-3 text-sm text-fg";
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
        <textarea value={synopsis} onChange={(e) => setSynopsis(e.target.value)} className={input + " py-2"} rows={4} />
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
        <p role="alert" className="rounded-md bg-danger-surface p-3 text-danger">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <Button type="submit" variant="primary" disabled={busy}>
          {submitLabel}
        </Button>
        {onCancel && (
          <Button variant="ghost" onClick={onCancel} className="underline">
            Cancel
          </Button>
        )}
      </div>
    </form>
  );
}
