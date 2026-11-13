import { useCoverFinder } from "@/contexts/CoverFinderContext";
import type { BookWithCopies } from "@/lib/types";

export default function NothingFoundList({ books }: { books: BookWithCopies[] }) {
  const { latest, retry } = useCoverFinder();
  return (
    <ul className="divide-y p-4">
      {books.map((b) => {
        const s = latest.get(b.id);
        return (
          <li key={b.id} className="flex items-center gap-3 py-2">
            <div className="h-16 w-11 shrink-0 overflow-hidden rounded bg-stone-200">
              {b.coverUrl && <img src={b.coverUrl} alt="" loading="lazy" className="h-full w-full object-cover" />}
            </div>
            <div className="min-w-0 flex-1">
              <p className="line-clamp-2 text-sm font-medium">{b.title}</p>
              {s && (
                <p className="text-xs text-stone-600">
                  <span>{s.status === "failed" ? "Search failed" : "Nothing good found"}</span>
                  {" · "}
                  <span>{new Date(s.createdAt).toLocaleDateString()}</span>
                </p>
              )}
            </div>
            <button type="button" onClick={() => void retry(b.id)} className="shrink-0 rounded border px-3 py-1 text-sm">
              Try again
            </button>
          </li>
        );
      })}
    </ul>
  );
}
