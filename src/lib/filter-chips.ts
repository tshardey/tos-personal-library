import { dayLabel } from "@/lib/date-added";
import { DEFAULT_VIEW, type LibraryView } from "@/lib/library-view";
import type { TosTag } from "@/lib/tos-tags";
import type { LibraryTag } from "@/lib/tagging/types";
import type { HouseholdMember } from "@/lib/types";

export interface FilterChip {
  key: string;
  label: string;
  /** The patch that removes this chip, or "series" when the route's series is cleared. */
  clear: Partial<LibraryView> | "series";
}

export interface ChipContext {
  series: string | null;
  members: HouseholdMember[];
  tosTags: TosTag[];
  /** [] when tagging is unavailable. */
  libraryVocabulary: LibraryTag[];
  /** readStatusOptions output, or null when reading is unavailable. */
  readOptions: { label: string; readStatus: LibraryView["readStatus"] }[] | null;
  coversAvailable: boolean;
}

const COVER_LABELS: Record<string, string> = {
  no_cover: "No cover",
  marked: "Marked for cover",
  nothing_found: "Nothing found",
};

/** The view's active filters as removable chips, in display order. The query and Ask are not filters. */
export function activeFilterChips(view: LibraryView, ctx: ChipContext): FilterChip[] {
  const chips: FilterChip[] = [];

  if (view.owner === "shared") {
    chips.push({ key: "owner", label: "Shared", clear: { owner: "all" } });
  } else if (view.owner !== "all") {
    const member = ctx.members.find((m) => m.userId === view.owner);
    if (member) chips.push({ key: "owner", label: member.displayName, clear: { owner: "all" } });
  }

  if (view.deluxe) chips.push({ key: "deluxe", label: "Deluxe", clear: { deluxe: false } });
  if (view.signed) chips.push({ key: "signed", label: "Signed", clear: { signed: false } });
  if (view.unhauled) chips.push({ key: "unhauled", label: "Unhauled", clear: { unhauled: false } });

  if (view.readStatus && ctx.readOptions) {
    const { userId, state } = view.readStatus;
    const option = ctx.readOptions.find((o) => o.readStatus?.userId === userId && o.readStatus.state === state);
    if (option) chips.push({ key: "read", label: option.label, clear: { readStatus: null } });
  }

  for (const id of view.tags) {
    chips.push({
      key: `tos:${id}`,
      label: ctx.tosTags.find((t) => t.id === id)?.label ?? id,
      clear: { tags: view.tags.filter((t) => t !== id) },
    });
  }

  for (const id of view.libraryTags) {
    const tag = ctx.libraryVocabulary.find((t) => t.id === id);
    if (tag) chips.push({ key: `lib:${id}`, label: tag.label, clear: { libraryTags: view.libraryTags.filter((t) => t !== id) } });
  }

  if (ctx.series !== null) chips.push({ key: "series", label: `Series: ${ctx.series}`, clear: "series" });

  if (view.edition !== null) chips.push({ key: "edition", label: `Edition: ${view.edition}`, clear: { edition: null } });

  if (ctx.coversAvailable && view.coverFilter !== "all") {
    chips.push({ key: "covers", label: COVER_LABELS[view.coverFilter], clear: { coverFilter: "all" } });
  }

  const { publishedFrom: from, publishedTo: to } = view;
  if (from !== null || to !== null) {
    const label = from !== null && to !== null ? `Published ${from}–${to}` : from !== null ? `Published from ${from}` : `Published to ${to}`;
    chips.push({ key: "published", label, clear: { publishedFrom: null, publishedTo: null } });
  }

  if (view.addedDay !== null) {
    chips.push({ key: "added", label: `Added ${dayLabel(view.addedDay)}`, clear: { addedDay: null } });
  }

  return chips;
}

/** Every filter field back at its default; the search query and Ask results are left alone. */
export function clearAllPatch(): Partial<LibraryView> {
  const filters: Partial<LibraryView> = { ...DEFAULT_VIEW, tags: [], libraryTags: [] };
  delete filters.query;
  delete filters.ask;
  return filters;
}
