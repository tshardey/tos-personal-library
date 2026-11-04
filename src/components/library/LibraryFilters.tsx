import type { OwnerFilter } from "@/lib/filter-books";
import type { HouseholdMember } from "@/lib/types";

interface Props {
  query: string;
  owner: OwnerFilter;
  members: HouseholdMember[];
  onQuery(q: string): void;
  onOwner(o: OwnerFilter): void;
}

export default function LibraryFilters({ query, owner, members, onQuery, onOwner }: Props) {
  const chips: { value: OwnerFilter; label: string }[] = [
    { value: "all", label: "All" },
    { value: "shared", label: "Shared" },
    ...members.map((m) => ({ value: m.userId, label: m.displayName })),
  ];
  return (
    <div className="sticky top-0 z-10 space-y-2 border-b bg-white p-3">
      <input
        type="search"
        value={query}
        onChange={(e) => onQuery(e.target.value)}
        placeholder="Search title or author"
        aria-label="Search books"
        className="w-full rounded border px-3 py-2"
      />
      <div className="flex gap-2 overflow-x-auto">
        {chips.map((c) => (
          <button
            key={c.value}
            type="button"
            aria-pressed={owner === c.value}
            onClick={() => onOwner(c.value)}
            className={`shrink-0 rounded-full border px-3 py-1 text-sm ${
              owner === c.value ? "bg-stone-800 text-white" : "bg-white"
            }`}
          >
            {c.label}
          </button>
        ))}
      </div>
    </div>
  );
}
