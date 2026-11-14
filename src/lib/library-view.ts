import { useCallback, useEffect, useSyncExternalStore } from "react";
import type { CoverFilter } from "@/lib/covers/eligibility";
import type { OwnerFilter } from "@/lib/filter-books";
import type { AskResponse } from "@/lib/tagging/types";

export interface AskView {
  prompt: string;
  status: "asking" | "done";
  response: AskResponse | null;
}

export interface LibraryView {
  query: string;
  owner: OwnerFilter;
  edition: string | null;
  tags: string[];
  libraryTags: string[];
  coverFilter: CoverFilter;
  unhauled: boolean;
  deluxe: boolean;
  signed: boolean;
  addedDay: string | null;
  publishedFrom: number | null;
  publishedTo: number | null;
  /** D11: Ask results live here; any other view change clears them. */
  ask: AskView | null;
}

export const DEFAULT_VIEW: LibraryView = {
  query: "",
  owner: "all",
  edition: null,
  tags: [],
  libraryTags: [],
  coverFilter: "all",
  unhauled: false,
  deluxe: false,
  signed: false,
  addedDay: null,
  publishedFrom: null,
  publishedTo: null,
  ask: null,
};

/**
 * D9: the library's view lives in memory for the session, outside LibraryPage, so a return from a
 * book page finds it intact. A reload or a new tab starts fresh. No browser storage.
 */
interface ViewState {
  householdId: string | null;
  view: LibraryView;
}

let state: ViewState = { householdId: null, view: DEFAULT_VIEW };
let anchor: ScrollAnchor | null = null;
const listeners = new Set<() => void>();

function setState(next: ViewState) {
  state = next;
  for (const l of listeners) l();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const getSnapshot = () => state;

/** The household's view and a patcher. A different household than the one last held starts at DEFAULT_VIEW. */
export function useLibraryView(householdId: string | null): [LibraryView, (patch: Partial<LibraryView>) => void] {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const view = snapshot.householdId === householdId ? snapshot.view : DEFAULT_VIEW;
  useEffect(() => {
    if (state.householdId !== householdId) setState({ householdId, view: DEFAULT_VIEW });
  }, [householdId]);
  const update = useCallback(
    (patch: Partial<LibraryView>) => {
      const base = state.householdId === householdId ? state.view : DEFAULT_VIEW;
      const onlyAsk = Object.keys(patch).every((k) => k === "ask");
      setState({ householdId, view: { ...base, ...(onlyAsk ? {} : { ask: null }), ...patch } });
    },
    [householdId],
  );
  return [view, update];
}

/** The household's view as the store holds it now, for code that resumes after an await. */
export function currentLibraryView(householdId: string | null): LibraryView {
  return state.householdId === householdId ? state.view : DEFAULT_VIEW;
}

/** Where the clicked card sat: its viewport top, the page's scrollY, and the view it was in. */
export interface ScrollAnchor {
  bookId: string;
  top: number;
  scrollY: number;
  viewKey: string;
}

export function saveScrollAnchor(a: ScrollAnchor): void {
  anchor = a;
}

/** Returns the saved anchor once, then null. */
export function takeScrollAnchor(): ScrollAnchor | null {
  const a = anchor;
  anchor = null;
  return a;
}

/** Back to a fresh session: on sign-out, and after each test. */
export function resetLibraryView(): void {
  anchor = null;
  setState({ householdId: null, view: DEFAULT_VIEW });
}
