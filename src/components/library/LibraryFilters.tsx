import type { CoverFilter } from "@/lib/covers/eligibility";
import { dayLabel } from "@/lib/date-added";
import type { LibraryView } from "@/lib/library-view";
import type { OwnerFilter } from "@/lib/filter-books";
import type { HouseholdMember } from "@/lib/types";
import { groupTags, isSharedTag, type TosTag } from "@/lib/tos-tags";
import { useEffect, useRef, useState } from "react";

interface Props {
  query: string;
  owner: OwnerFilter;
  edition: string | null;
  tagFilter: string[];
  series: string | null;
  tosTags: TosTag[];
  seriesNames: string[];
  tagsUnavailable?: boolean;
  labels: string[];
  members: HouseholdMember[];
  onQuery(q: string): void;
  onOwner(o: OwnerFilter): void;
  onEdition(e: string | null): void;
  onTagFilter(ids: string[]): void;
  onSeries(s: string | null): void;
  coverFilter: CoverFilter;
  coversAvailable: boolean;
  onCoverFilter(f: CoverFilter): void;
  unhauled: boolean;
  deluxe: boolean;
  signed: boolean;
  addedDay: string | null;
  addedOptions: { day: string; copies: number }[];
  publishedFrom: number | null;
  publishedTo: number | null;
  onChange(patch: Partial<LibraryView>): void;
}

/** Strict whole number from typed text; anything else is no bound. */
function parseYear(text: string): number | null {
  const t = text.trim();
  return /^\d+$/.test(t) ? Number(t) : null;
}

function YearInput({
  label,
  value,
  onValue,
}: {
  label: string;
  value: number | null;
  onValue(n: number | null): void;
}) {
  const [text, setText] = useState(value === null ? "" : String(value));
  // Follow outside changes (a reset), but keep what was typed while it still parses to the same bound.
  useEffect(() => {
    setText((t) => (parseYear(t) === value ? t : value === null ? "" : String(value)));
  }, [value]);
  return (
    <input
      type="text"
      inputMode="numeric"
      aria-label={label}
      placeholder={label.endsWith("from") ? "From" : "To"}
      value={text}
      onChange={(e) => {
        setText(e.target.value);
        onValue(parseYear(e.target.value));
      }}
      className="w-24 rounded border px-3 py-2"
    />
  );
}

export default function LibraryFilters({
  query,
  owner,
  edition,
  tagFilter,
  series,
  tosTags,
  seriesNames,
  tagsUnavailable,
  labels,
  members,
  onQuery,
  onOwner,
  onEdition,
  onTagFilter,
  onSeries,
  coverFilter,
  coversAvailable,
  onCoverFilter,
  unhauled,
  deluxe,
  signed,
  addedDay,
  addedOptions,
  publishedFrom,
  publishedTo,
  onChange,
}: Props) {
  const [tagsOpen, setTagsOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (tagsOpen) closeRef.current?.focus();
  }, [tagsOpen]);
  function closeTags() {
    setTagsOpen(false);
    triggerRef.current?.focus();
  }
  const shared = tosTags.filter(isSharedTag);
  const groups = groupTags(
    shared.map((t) => t.id),
    shared,
  );
  const labelOf = (id: string) => tosTags.find((t) => t.id === id)?.label ?? id;
  function toggleTag(id: string, on: boolean) {
    onTagFilter(on ? [...tagFilter, id] : tagFilter.filter((t) => t !== id));
  }
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
      {labels.length > 0 && (
        <select
          aria-label="Edition"
          value={edition ?? ""}
          onChange={(e) => onEdition(e.target.value === "" ? null : e.target.value)}
          className="w-full rounded border px-3 py-2"
        >
          <option value="">All editions</option>
          {labels.map((l) => (
            <option key={l} value={l}>
              {l}
            </option>
          ))}
        </select>
      )}
      {(seriesNames.length > 0 || series !== null) && (
        <select
          aria-label="Series"
          value={series ?? ""}
          onChange={(e) => onSeries(e.target.value === "" ? null : e.target.value)}
          className="w-full rounded border px-3 py-2"
        >
          <option value="">All series</option>
          {series !== null && !seriesNames.includes(series) && <option value={series}>{series}</option>}
          {seriesNames.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      )}
      {coversAvailable && (
        <select
          aria-label="Covers"
          value={coverFilter}
          onChange={(e) => onCoverFilter(e.target.value as CoverFilter)}
          className="w-full rounded border px-3 py-2"
        >
          <option value="all">All books</option>
          <option value="no_cover">No cover</option>
          <option value="marked">Marked for cover</option>
          <option value="nothing_found">Nothing found</option>
        </select>
      )}
      <select
        aria-label="Date added"
        value={addedDay ?? ""}
        onChange={(e) => onChange({ addedDay: e.target.value === "" ? null : e.target.value })}
        className="w-full rounded border px-3 py-2"
      >
        <option value="">Any day</option>
        {addedOptions.map((o) => (
          <option key={o.day} value={o.day}>
            {`${dayLabel(o.day)} · ${o.copies}`}
          </option>
        ))}
      </select>
      <div role="group" aria-labelledby="published-label" className="flex items-center gap-2">
        <span id="published-label" className="text-sm">
          Published
        </span>
        <YearInput label="Published from" value={publishedFrom} onValue={(n) => onChange({ publishedFrom: n })} />
        <YearInput label="Published to" value={publishedTo} onValue={(n) => onChange({ publishedTo: n })} />
      </div>
      {tagsUnavailable && <p className="text-sm text-stone-700">Tome of Secrets tags unavailable.</p>}
      {!tagsUnavailable && (shared.length > 0 || tagFilter.length > 0) && (
        <div className="flex flex-wrap items-center gap-2">
          <button ref={triggerRef} type="button" onClick={() => setTagsOpen(true)} className="rounded border px-3 py-1 text-sm">
            ToS tags
          </button>
          {tagFilter.map((id) => (
            <span key={id} className="rounded-full bg-stone-200 px-3 py-1 text-sm">
              {labelOf(id)}
            </span>
          ))}
          {tagFilter.length > 0 && (
            <button type="button" onClick={() => onTagFilter([])} className="text-sm underline">
              Clear
            </button>
          )}
        </div>
      )}
      {tagsOpen && !tagsUnavailable && (
        <div className="fixed inset-0 z-20 flex items-end justify-center bg-black/40 sm:items-center">
          <div
            role="dialog"
            aria-modal="true"
            aria-label="ToS tags"
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.stopPropagation();
                closeTags();
              }
            }}
            className="max-h-[80vh] w-full max-w-lg overflow-y-auto rounded-t bg-white p-4 sm:rounded"
          >
            {groups.map((g) => (
              <fieldset key={g.category} className="mb-3">
                <legend className="text-sm font-medium">{g.label}</legend>
                {g.tags.map((t) => (
                  <label key={t.id} className="flex items-center gap-2 py-1 text-sm">
                    <input
                      type="checkbox"
                      checked={tagFilter.includes(t.id)}
                      onChange={(e) => toggleTag(t.id, e.target.checked)}
                    />
                    {t.label}
                  </label>
                ))}
              </fieldset>
            ))}
            <div className="flex gap-2">
              <button type="button" onClick={() => onTagFilter([])} className="rounded border px-3 py-2">
                Clear
              </button>
              <button ref={closeRef} type="button" onClick={closeTags} className="rounded border px-3 py-2">
                Close
              </button>
            </div>
          </div>
        </div>
      )}
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
      <div className="flex gap-2 overflow-x-auto">
        {(
          [
            ["Deluxe", deluxe, "deluxe"],
            ["Signed", signed, "signed"],
            ["Unhauled", unhauled, "unhauled"],
          ] as const
        ).map(([label, on, key]) => (
          <button
            key={key}
            type="button"
            aria-pressed={on}
            onClick={() => onChange({ [key]: !on })}
            className={`shrink-0 rounded-full border px-3 py-1 text-sm ${on ? "bg-stone-800 text-white" : "bg-white"}`}
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}
