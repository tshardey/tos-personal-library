import { useEffect, useMemo, useState } from "react";
import { signedPhotoUrls } from "@/lib/photo/intake-repo";
import type { BookWithCopies } from "@/lib/types";

const REFRESH_MS = 50 * 60 * 1000;

/** Oldest photographed copy's path for each book that has no stock cover. */
function photoPathsByBook(books: BookWithCopies[]): [string, string][] {
  const out: [string, string][] = [];
  for (const book of books) {
    if (book.coverUrl) continue;
    let oldest: { path: string; createdAt: string } | null = null;
    for (const c of book.copies) {
      if (c.photoPath && (!oldest || c.createdAt < oldest.createdAt)) {
        oldest = { path: c.photoPath, createdAt: c.createdAt };
      }
    }
    if (oldest) out.push([book.id, oldest.path]);
  }
  return out;
}

/** Signed URLs of our copies' photos, keyed by book id, for books lacking a stock cover. */
export function useCopyPhotoUrls(books: BookWithCopies[]): Map<string, string> {
  // Keyed by content so a new array with the same photos does not refetch.
  const key = useMemo(() => JSON.stringify(photoPathsByBook(books)), [books]);
  const [urls, setUrls] = useState<Map<string, string>>(new Map());
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const pairs = JSON.parse(key) as [string, string][];
    if (pairs.length === 0) {
      setUrls((prev) => (prev.size === 0 ? prev : new Map()));
      return;
    }
    let cancelled = false;
    signedPhotoUrls(pairs.map(([, path]) => path))
      .then((signed) => {
        if (cancelled) return;
        const next = new Map<string, string>();
        for (const [bookId, path] of pairs) {
          const url = signed.get(path);
          if (url) next.set(bookId, url);
        }
        setUrls(next);
      })
      .catch((err) => {
        console.error("Failed to load copy photos", err);
      });
    const timer = setTimeout(() => setTick((t) => t + 1), REFRESH_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [key, tick]);

  return urls;
}
