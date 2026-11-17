import { describe, expect, it } from "vitest";
import { activeFilterChips, clearAllPatch, type ChipContext } from "@/lib/filter-chips";
import { DEFAULT_VIEW, type LibraryView } from "@/lib/library-view";
import { readStatusOptions } from "@/lib/reading/filter-options";
import { dayLabel } from "@/lib/date-added";

const A = "00000000-0000-4000-8000-00000000000a";
const B = "00000000-0000-4000-8000-00000000000b";
const members = [
  { householdId: "h", userId: A, displayName: "Member A", createdAt: "2026-01-01" },
  { householdId: "h", userId: B, displayName: "Member B", createdAt: "2026-01-01" },
];
const ctx: ChipContext = {
  series: null,
  members,
  tosTags: [
    { id: "t1", label: "Cozy", category: "mood" },
    { id: "t2", label: "Dark", category: "mood" },
  ],
  libraryVocabulary: [{ id: "l1", label: "Heist", category: "plot", active: true, addedVersion: 1, householdId: null } as never],
  readOptions: readStatusOptions(members, A),
  coversAvailable: true,
};
const view = (patch: Partial<LibraryView>): LibraryView => ({ ...DEFAULT_VIEW, ...patch });

describe("activeFilterChips", () => {
  it("is empty for the default view", () => {
    expect(activeFilterChips(DEFAULT_VIEW, ctx)).toEqual([]);
  });

  it("orders chips and gives clear patches", () => {
    const chips = activeFilterChips(view({ owner: B, deluxe: true, tags: ["t1", "t2"] }), { ...ctx, series: "Saga Z" });
    expect(chips.map((c) => c.label)).toEqual(["Member B", "Deluxe", "Cozy", "Dark", "Series: Saga Z"]);
    expect(chips.map((c) => c.clear)).toEqual([{ owner: "all" }, { deluxe: false }, { tags: ["t2"] }, { tags: ["t1"] }, "series"]);
    expect(new Set(chips.map((c) => c.key)).size).toBe(chips.length);
  });

  it("labels shared owner, flags, read status, library tag, edition, covers and added day", () => {
    const chips = activeFilterChips(
      view({
        owner: "shared",
        signed: true,
        unhauled: true,
        readStatus: { userId: A, state: "unread" },
        libraryTags: ["l1"],
        edition: "Hardcover",
        coverFilter: "marked",
        addedDay: "2026-03-04",
      }),
      ctx,
    );
    expect(chips.map((c) => c.label)).toEqual([
      "Shared",
      "Signed",
      "Unhauled",
      "Unread by me",
      "Heist",
      "Edition: Hardcover",
      "Marked for cover",
      `Added ${dayLabel("2026-03-04")}`,
    ]);
    expect(chips.find((c) => c.label === "Heist")?.clear).toEqual({ libraryTags: [] });
    expect(chips.find((c) => c.label === "Marked for cover")?.clear).toEqual({ coverFilter: "all" });
  });

  it("reads published ranges", () => {
    const label = (f: number | null, t: number | null) =>
      activeFilterChips(view({ publishedFrom: f, publishedTo: t }), ctx)[0];
    expect(label(1990, 2000).label).toBe("Published 1990–2000");
    expect(label(1990, null).label).toBe("Published from 1990");
    expect(label(null, 2000).label).toBe("Published to 2000");
    expect(label(1990, 2000).clear).toEqual({ publishedFrom: null, publishedTo: null });
  });

  it("gives no chip for a library tag absent from the vocabulary", () => {
    expect(activeFilterChips(view({ libraryTags: ["l1"] }), { ...ctx, libraryVocabulary: [] })).toEqual([]);
  });

  it("gives no read-status chip when readOptions is null", () => {
    expect(activeFilterChips(view({ readStatus: { userId: A, state: "read" } }), { ...ctx, readOptions: null })).toEqual([]);
  });

  it("gives no cover chip when covers are unavailable", () => {
    expect(activeFilterChips(view({ coverFilter: "no_cover" }), { ...ctx, coversAvailable: false })).toEqual([]);
  });

  it("falls back to the id for an unknown ToS tag and skips an unknown owner", () => {
    const chips = activeFilterChips(view({ tags: ["gone"], owner: "00000000-0000-4000-8000-0000000000ff" }), ctx);
    expect(chips.map((c) => c.label)).toEqual(["gone"]);
  });
});

describe("clearAllPatch", () => {
  it("leaves query and ask alone and resets the rest", () => {
    const patch = clearAllPatch();
    expect("query" in patch).toBe(false);
    expect("ask" in patch).toBe(false);
    expect(patch.owner).toBe("all");
    expect(patch.tags).toEqual([]);
    expect(Object.keys(patch).length).toBe(Object.keys(DEFAULT_VIEW).length - 2);
  });
});
