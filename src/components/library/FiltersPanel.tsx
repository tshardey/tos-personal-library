import { useEffect, useId, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Button, Chip, Select, Sheet } from "@/components/ui";
import LibraryTagFilter from "@/components/tags/LibraryTagFilter";
import type { CoverFilter } from "@/lib/covers/eligibility";
import { dayLabel } from "@/lib/date-added";
import type { OwnerFilter } from "@/lib/filter-books";
import type { LibraryView } from "@/lib/library-view";
import type { ReadState } from "@/lib/reading/types";
import type { LibraryTag } from "@/lib/tagging/types";
import { groupTags, isSharedTag, type TosTag } from "@/lib/tos-tags";
import type { HouseholdMember } from "@/lib/types";

/** Today's filter props (the old LibraryFilters'), kept the same. */
export interface LibraryFiltersProps {
  /** Unused: the search row lives in LibraryToolbar. */
  query?: string;
  owner: OwnerFilter;
  edition: string | null;
  tagFilter: string[];
  series: string | null;
  tosTags: TosTag[];
  seriesNames: string[];
  tagsUnavailable?: boolean;
  labels: string[];
  members: HouseholdMember[];
  onQuery?(q: string): void;
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
  /** D14: the library tag filter; absent while tagging is unavailable. */
  libraryTagFilter?: { vocabulary: LibraryTag[]; selected: string[]; onChange(ids: string[]): void };
  /** Unused: Ask lives in LibraryToolbar with the search box. */
  ask?: { disabled: boolean; note: string | null; onAsk(): void };
  /** D10: the read status options (`any` or `<userId>:<state>`); absent while reading is unavailable. */
  readStatusFilter?: { options: { value: string; label: string }[]; value: string; onChange(v: string): void };
}

type Props = Omit<LibraryFiltersProps, "query" | "onQuery" | "ask"> & {
  mode: "panel" | "sheet";
  id: string;
  onClose(): void;
  onClearAll(): void;
  /** For the Reading group's For default. */
  me: string | null;
  /** Sheet mode only: the View group (Sort + CoverSizeControl). */
  view?: ReactNode;
};

const FIELD = "min-h-11 rounded-md border border-field bg-control px-3 text-sm text-fg sm:min-h-9";

/** Strict four-digit-or-longer whole number from typed text; anything else (a partly typed year too) is no bound. */
function parseYear(text: string): number | null {
  const t = text.trim();
  return /^\d{4,}$/.test(t) ? Number(t) : null;
}

function YearInput({
  label,
  placeholder,
  value,
  onValue,
}: {
  label: string;
  placeholder: string;
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
      placeholder={placeholder}
      value={text}
      onChange={(e) => {
        setText(e.target.value);
        onValue(parseYear(e.target.value));
      }}
      className={`w-24 ${FIELD}`}
    />
  );
}

/** One titled group of the panel; tests and screen readers find it by its heading. */
function Group({ title, children }: { title: string; children: ReactNode }) {
  const id = useId();
  return (
    <div role="group" aria-labelledby={id} className="min-w-0 space-y-2">
      <h3 id={id} className="text-xs font-semibold uppercase tracking-wide text-muted">
        {title}
      </h3>
      {children}
    </div>
  );
}

const READ_STATES: [ReadState | null, string][] = [
  [null, "Any"],
  ["unread", "Unread"],
  ["read", "Read"],
  ["dnf", "Did not finish"],
];

/** `<userId>:<state>` back into its parts; `any` (or anything else) is no status. */
function parseReadValue(value: string): { userId: string; state: ReadState } | null {
  const at = value.lastIndexOf(":");
  if (at <= 0) return null;
  return { userId: value.slice(0, at), state: value.slice(at + 1) as ReadState };
}

/** D6 Reading: pressed state buttons plus a For select, the same option set as readStatusOptions. */
function ReadingControls({
  filter,
  members,
  me,
}: {
  filter: NonNullable<LibraryFiltersProps["readStatusFilter"]>;
  members: HouseholdMember[];
  me: string | null;
}) {
  const current = parseReadValue(filter.value);
  // While Any is pressed the chosen member is held here, so pressing a state next applies to them.
  const [held, setHeld] = useState<string | null>(me);
  const forMember = current?.userId ?? held ?? me;
  const valid = (v: string) => filter.options.some((o) => o.value === v);
  function choose(state: ReadState | null) {
    if (state === null) {
      if (current) setHeld(current.userId);
      filter.onChange("any");
      return;
    }
    const next = `${forMember}:${state}`;
    if (forMember !== null && valid(next)) filter.onChange(next);
  }
  function chooseFor(userId: string) {
    setHeld(userId);
    if (current) {
      const next = `${userId}:${current.state}`;
      if (valid(next)) filter.onChange(next);
    }
  }
  const others = members.filter((m) => m.userId !== me);
  return (
    <>
      <div role="group" aria-label="Read status" className="flex flex-wrap gap-2">
        {READ_STATES.map(([state, label]) => (
          <Chip
            key={label}
            label={label}
            pressed={state === null ? current === null : current?.state === state}
            onClick={() => choose(state)}
          />
        ))}
      </div>
      {members.length > 1 && me !== null && (
        <label className="flex items-center gap-2 text-sm">
          <span>For</span>
          <Select label="For" value={forMember ?? me} onChange={(e) => chooseFor(e.target.value)}>
            <option value={me}>Me</option>
            {others.map((m) => (
              <option key={m.userId} value={m.userId}>
                {m.displayName}
              </option>
            ))}
          </Select>
        </label>
      )}
    </>
  );
}

/** The `ToS tags` button, its chosen tags and its sheet. */
function TosTagFilter({
  tosTags,
  selected,
  onChange,
}: {
  tosTags: TosTag[];
  selected: string[];
  onChange(ids: string[]): void;
}) {
  const [open, setOpen] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);
  const shared = tosTags.filter(isSharedTag);
  if (shared.length === 0 && selected.length === 0) return null;
  const groups = groupTags(
    shared.map((t) => t.id),
    shared,
  );
  const labelOf = (id: string) => tosTags.find((t) => t.id === id)?.label ?? id;
  function toggle(id: string, on: boolean) {
    onChange(on ? [...selected, id] : selected.filter((t) => t !== id));
  }
  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          onClick={(e) => {
            // The sheet returns focus to whatever had it, so the button takes it first (Safari doesn't on click).
            e.currentTarget.focus();
            setOpen(true);
          }}
        >
          ToS tags
        </Button>
        {selected.map((id) => (
          <span key={id} className="rounded-full bg-control px-3 py-1 text-sm">
            {labelOf(id)}
          </span>
        ))}
        {selected.length > 0 && (
          <button type="button" onClick={() => onChange([])} className="text-sm underline">
            Clear
          </button>
        )}
      </div>
      {open && (
        <Sheet
          label="ToS tags"
          onClose={() => setOpen(false)}
          initialFocus={closeRef}
          footer={
            <>
              <Button onClick={() => onChange([])}>Clear</Button>
              <Button ref={closeRef} onClick={() => setOpen(false)}>
                Close
              </Button>
            </>
          }
        >
          {groups.map((g) => (
            <fieldset key={g.category} className="mb-3">
              <legend className="text-sm font-medium">{g.label}</legend>
              {g.tags.map((t) => (
                <label key={t.id} className="flex min-h-11 items-center gap-2 text-sm sm:min-h-9">
                  <input type="checkbox" checked={selected.includes(t.id)} onChange={(e) => toggle(t.id, e.target.checked)} />
                  {t.label}
                </label>
              ))}
            </fieldset>
          ))}
        </Sheet>
      )}
    </>
  );
}

/**
 * D6: the library's filters, once. On the computer a non-modal region in the pinned block under the
 * toolbar; on the phone a bottom Sheet with the View group first. Every control patches the field
 * the old LibraryFilters patched, and the wall updates live.
 */
export default function FiltersPanel({
  mode,
  id,
  onClose,
  onClearAll,
  me,
  view,
  owner,
  edition,
  tagFilter,
  series,
  tosTags,
  seriesNames,
  tagsUnavailable,
  labels,
  members,
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
  libraryTagFilter,
  readStatusFilter,
}: Props) {
  const publishedId = useId();
  const owners: { value: OwnerFilter; label: string }[] = [
    { value: "all", label: "All" },
    { value: "shared", label: "Shared" },
    ...members.map((m) => ({ value: m.userId, label: m.displayName })),
  ];
  const showTos = !tagsUnavailable && (tosTags.some(isSharedTag) || tagFilter.length > 0);
  const showLibraryTags =
    libraryTagFilter !== undefined &&
    (libraryTagFilter.vocabulary.some((t) => t.active) || libraryTagFilter.selected.length > 0);
  const showSeries = seriesNames.length > 0 || series !== null;
  const showTagsAndSeries = tagsUnavailable || showTos || showLibraryTags || showSeries;

  const groups = (
    <>
      {readStatusFilter && (
        <Group title="Reading">
          <ReadingControls filter={readStatusFilter} members={members} me={me} />
        </Group>
      )}
      <Group title="Owner & Copy">
        <div className="flex flex-wrap gap-2">
          {owners.map((c) => (
            <Chip key={c.value} label={c.label} pressed={owner === c.value} onClick={() => onOwner(c.value)} />
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          {(
            [
              ["Deluxe", deluxe, "deluxe"],
              ["Signed", signed, "signed"],
              ["Unhauled", unhauled, "unhauled"],
            ] as const
          ).map(([label, on, key]) => (
            <Chip key={key} label={label} pressed={on} onClick={() => onChange({ [key]: !on })} />
          ))}
        </div>
      </Group>
      {showTagsAndSeries && (
        <Group title="Tags & Series">
          {tagsUnavailable && <p className="text-sm text-muted">Tome of Secrets tags unavailable.</p>}
          {showTos && <TosTagFilter tosTags={tosTags} selected={tagFilter} onChange={onTagFilter} />}
          {libraryTagFilter && (
            <LibraryTagFilter
              vocabulary={libraryTagFilter.vocabulary}
              selected={libraryTagFilter.selected}
              onChange={libraryTagFilter.onChange}
            />
          )}
          {showSeries && (
            <Select
              label="Series"
              value={series ?? ""}
              onChange={(e) => onSeries(e.target.value === "" ? null : e.target.value)}
              className="w-full"
            >
              <option value="">All series</option>
              {series !== null && !seriesNames.includes(series) && <option value={series}>{series}</option>}
              {seriesNames.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </Select>
          )}
        </Group>
      )}
      <Group title="Edition, Covers & Dates">
        {labels.length > 0 && (
          <Select
            label="Edition"
            value={edition ?? ""}
            onChange={(e) => onEdition(e.target.value === "" ? null : e.target.value)}
            className="w-full"
          >
            <option value="">All editions</option>
            {labels.map((l) => (
              <option key={l} value={l}>
                {l}
              </option>
            ))}
          </Select>
        )}
        {coversAvailable && (
          <Select
            label="Covers"
            value={coverFilter}
            onChange={(e) => onCoverFilter(e.target.value as CoverFilter)}
            className="w-full"
          >
            <option value="all">All books</option>
            <option value="no_cover">No cover</option>
            <option value="marked">Marked for cover</option>
            <option value="nothing_found">Nothing found</option>
          </Select>
        )}
        <div role="group" aria-labelledby={publishedId} className="flex flex-wrap items-center gap-2">
          <span id={publishedId} className="text-sm">
            Published
          </span>
          <YearInput label="Published from" placeholder="From" value={publishedFrom} onValue={(n) => onChange({ publishedFrom: n })} />
          <YearInput label="Published to" placeholder="To" value={publishedTo} onValue={(n) => onChange({ publishedTo: n })} />
        </div>
        <Select
          label="Date added"
          value={addedDay ?? ""}
          onChange={(e) => onChange({ addedDay: e.target.value === "" ? null : e.target.value })}
          className="w-full"
        >
          <option value="">Any day</option>
          {addedOptions.map((o) => (
            <option key={o.day} value={o.day}>
              {`${dayLabel(o.day)} · ${o.copies}`}
            </option>
          ))}
        </Select>
      </Group>
    </>
  );

  const clearAll = (
    <Button variant="ghost" size="sm" onClick={onClearAll}>
      Clear all
    </Button>
  );

  if (mode === "sheet") {
    return (
      <Sheet
        label="Filters"
        title="Filters"
        onClose={onClose}
        footer={
          <>
            {clearAll}
            <Button variant="primary" onClick={onClose}>
              Done
            </Button>
          </>
        }
      >
        <div id={id} className="space-y-5">
          {view && (
            <Group title="View">
              <div className="flex flex-wrap items-center gap-3">{view}</div>
            </Group>
          )}
          {groups}
        </div>
      </Sheet>
    );
  }

  return (
    <div
      id={id}
      role="region"
      aria-label="Filters"
      onKeyDown={(e) => {
        // An inner sheet (ToS tags, Library tags) handles its own Escape and stops it there.
        if (e.key === "Escape") {
          e.stopPropagation();
          onClose();
        }
      }}
      className="max-h-[60vh] overflow-y-auto border-t border-line px-4 py-3 sm:px-6"
    >
      <div className="grid gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-4">{groups}</div>
      <div className="mt-3 flex justify-end">{clearAll}</div>
    </div>
  );
}
