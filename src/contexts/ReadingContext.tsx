import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type JSX,
  type ReactNode,
} from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useHousehold } from "@/contexts/HouseholdContext";
import { isMissingFeature } from "@/lib/covers/cover-repo";
import { listReadStatuses, setReadStatus } from "@/lib/reading/reading-repo";
import { toStatusMap } from "@/lib/reading/status";
import type { ReadState, ReadStatusMap, ReadStatusRow } from "@/lib/reading/types";

export interface ReadingState {
  available: boolean;
  loading: boolean;
  rows: ReadStatusRow[];
  byBook: ReadStatusMap;
  userId: string | null;
  /** Writes the statuses, then reloads. A call while another write runs is ignored. */
  setStatus(bookIds: string[], state: ReadState, finishedOn: string | null, keepDates: boolean): Promise<void>;
  reload(): Promise<void>;
}

export interface ReadingDeps {
  listReadStatuses: typeof listReadStatuses;
  setReadStatus: typeof setReadStatus;
}

const defaultDeps = (): ReadingDeps => ({ listReadStatuses, setReadStatus });

const EMPTY_ROWS: ReadStatusRow[] = [];
const EMPTY_MAP: ReadStatusMap = new Map();

// eslint-disable-next-line react-refresh/only-export-components
export const UNAVAILABLE_READING: ReadingState = {
  available: false,
  loading: false,
  rows: EMPTY_ROWS,
  byBook: EMPTY_MAP,
  userId: null,
  setStatus: async () => {},
  reload: async () => {},
};

const ReadingContext = createContext<ReadingState | null>(null);

const errorCode = (err: unknown): string =>
  (err as { code?: unknown } | null)?.code?.toString() ?? (err instanceof Error ? err.name : "unknown");

export function ReadingProvider(props: { children: ReactNode; deps?: Partial<ReadingDeps> }): JSX.Element {
  const { household } = useHousehold();
  const { user } = useAuth();
  const householdId = household?.id ?? null;
  const userId = user?.id ?? null;
  const [d] = useState<ReadingDeps>(() => ({ ...defaultDeps(), ...props.deps }));

  // The last settled load, tagged with its household so a switch never shows the old one's rows.
  const [data, setData] = useState<{ hid: string | null; rows: ReadStatusRow[]; available: boolean }>({
    hid: null,
    rows: EMPTY_ROWS,
    available: false,
  });
  const mine = data.hid === householdId;
  const rows = mine ? data.rows : EMPTY_ROWS;
  const available = mine && data.available;
  const loading = !mine;
  const loadedRef = useRef(false);
  const mountedRef = useRef(true);
  const writingRef = useRef(false);
  /** Bumped by every load and on unmount or household change; only the newest load may apply. */
  const generationRef = useRef(0);

  const load = useCallback(async (): Promise<void> => {
    if (householdId === null) return;
    const generation = ++generationRef.current;
    const current = () => mountedRef.current && generationRef.current === generation;
    try {
      const next = await d.listReadStatuses(householdId);
      if (!current()) return;
      loadedRef.current = true;
      setData({ hid: householdId, rows: next, available: true });
    } catch (err) {
      console.warn("reading load failed", errorCode(err));
      // Before the migration (or on any first-load error) all reading UI stays hidden.
      if (current() && (!loadedRef.current || isMissingFeature(err))) {
        setData({ hid: householdId, rows: EMPTY_ROWS, available: false });
      }
    }
  }, [d, householdId]);

  useEffect(() => {
    mountedRef.current = true;
    loadedRef.current = false;
    void load();
    return () => {
      mountedRef.current = false;
      generationRef.current += 1;
    };
  }, [load]);

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") void load();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [load]);

  const setStatus = useCallback(
    async (bookIds: string[], state: ReadState, finishedOn: string | null, keepDates: boolean) => {
      if (householdId === null || bookIds.length === 0 || writingRef.current) return;
      writingRef.current = true;
      try {
        await d.setReadStatus(householdId, bookIds, state, finishedOn, keepDates);
        await load();
      } finally {
        writingRef.current = false;
      }
    },
    [d, householdId, load],
  );

  const byBook = useMemo(() => toStatusMap(rows), [rows]);
  const value = useMemo<ReadingState>(
    () => ({ available, loading, rows, byBook, userId, setStatus, reload: load }),
    [available, loading, rows, byBook, userId, setStatus, load],
  );

  return <ReadingContext.Provider value={value}>{props.children}</ReadingContext.Provider>;
}

/** Outside a provider (signed out, or a component test) reading status is simply unavailable. */
// eslint-disable-next-line react-refresh/only-export-components
export function useReading(): ReadingState {
  return useContext(ReadingContext) ?? UNAVAILABLE_READING;
}
