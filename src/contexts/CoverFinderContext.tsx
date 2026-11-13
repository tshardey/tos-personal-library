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
import { useHousehold } from "@/contexts/HouseholdContext";
import {
  applyCover,
  dismissCoverSearch,
  getCoverBudget,
  isMissingFeature,
  listCoverMarks,
  listCoverSearches,
  markForCover,
  markResultsSeen,
  recordCoverCandidates,
  requestCoverSearches,
  screenSearch,
  unmarkForCover,
  type RequestOutcome,
} from "@/lib/covers/cover-repo";
import { drainCovers, GATHER_PAUSE_MS, type CoverStop } from "@/lib/covers/drain";
import { latestByBook } from "@/lib/covers/eligibility";
import { browserMeasure } from "@/lib/covers/measure";
import type { ReviewAction } from "@/lib/covers/review";
import { gatherCandidates } from "@/lib/covers/sources";
import type { CoverBudget, CoverCandidate, CoverMark, CoverReason, CoverSearch, CoverSearchBook } from "@/lib/covers/types";
import { googleBooksApiKey } from "@/lib/google-books";

export const POLL_ACTIVE_MS = 15_000;
export const POLL_IDLE_MS = 120_000;

const ACTIVE = new Set(["queued", "gathered", "processing"]);

export interface CoverFinderState {
  available: boolean;
  loading: boolean;
  marks: Map<string, CoverMark>;
  searches: CoverSearch[];
  latest: Map<string, CoverSearch>;
  budget: CoverBudget | null;
  stop: CoverStop;
  gatherPaused: boolean;
  /** The screening function was unreachable twice in a row; screening resumes after GATHER_PAUSE_MS. */
  screenPaused: boolean;
  reviewCount: number;
  mark(bookId: string, reasons: CoverReason[], note: string | null): Promise<void>;
  unmark(bookId: string): Promise<void>;
  findNow(bookId: string, reasons: CoverReason[], note: string | null): Promise<RequestOutcome>;
  requestBatch(bookIds: string[]): Promise<{ queued: number; alreadyOpen: number; nothingFound: number }>;
  /** A manual request. */
  retry(bookId: string): Promise<RequestOutcome>;
  runReview(actions: ReviewAction[]): Promise<{ applied: number; changed: number; gone: number }>;
  clearStop(): void;
  reload(): Promise<void>;
}

export interface CoverFinderDeps {
  listCoverMarks: typeof listCoverMarks;
  listCoverSearches: typeof listCoverSearches;
  getCoverBudget: typeof getCoverBudget;
  markForCover: typeof markForCover;
  unmarkForCover: typeof unmarkForCover;
  requestCoverSearches: typeof requestCoverSearches;
  recordCoverCandidates: typeof recordCoverCandidates;
  screenSearch: typeof screenSearch;
  applyCover: typeof applyCover;
  dismissCoverSearch: typeof dismissCoverSearch;
  markResultsSeen: typeof markResultsSeen;
  gather(book: CoverSearchBook): Promise<CoverCandidate[]>;
  drain: typeof drainCovers;
  now(): Date;
  newBatchId(): string;
  sleep(ms: number): Promise<void>;
}

function defaultDeps(): CoverFinderDeps {
  return {
    listCoverMarks,
    listCoverSearches,
    getCoverBudget,
    markForCover,
    unmarkForCover,
    requestCoverSearches,
    recordCoverCandidates,
    screenSearch,
    applyCover,
    dismissCoverSearch,
    markResultsSeen,
    gather: (book) =>
      gatherCandidates(book, {
        fetchImpl: (input, init) => fetch(input, init),
        googleKey: googleBooksApiKey(),
        measure: browserMeasure,
      }),
    drain: drainCovers,
    now: () => new Date(),
    newBatchId: () => crypto.randomUUID(),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  };
}

const EMPTY_MARKS: Map<string, CoverMark> = new Map();
const EMPTY_LATEST: Map<string, CoverSearch> = new Map();

// eslint-disable-next-line react-refresh/only-export-components
export const UNAVAILABLE_COVER_FINDER: CoverFinderState = {
  available: false,
  loading: false,
  marks: EMPTY_MARKS,
  searches: [],
  latest: EMPTY_LATEST,
  budget: null,
  stop: null,
  gatherPaused: false,
  screenPaused: false,
  reviewCount: 0,
  mark: async () => {},
  unmark: async () => {},
  findNow: async () => "not_found",
  requestBatch: async () => ({ queued: 0, alreadyOpen: 0, nothingFound: 0 }),
  retry: async () => "not_found",
  runReview: async () => ({ applied: 0, changed: 0, gone: 0 }),
  clearStop: () => {},
  reload: async () => {},
};

const CoverFinderContext = createContext<CoverFinderState | null>(null);

const errorCode = (err: unknown): string =>
  (err as { code?: unknown } | null)?.code?.toString() ?? (err instanceof Error ? err.name : "unknown");

function countForReview(searches: CoverSearch[]): number {
  return searches.filter(
    (s) => (s.status === "ready" && s.results.length > 0) || ((s.status === "nothing_found" || s.status === "failed") && s.seenAt === null),
  ).length;
}

export function CoverFinderProvider(props: { children: ReactNode; deps?: Partial<CoverFinderDeps> }): JSX.Element {
  const { household } = useHousehold();
  const householdId = household?.id ?? null;
  // Fixed for the provider's life, so callbacks stay stable.
  const [d] = useState<CoverFinderDeps>(() => ({ ...defaultDeps(), ...props.deps }));

  const [available, setAvailable] = useState(false);
  const [loading, setLoading] = useState(true);
  const [marks, setMarks] = useState<Map<string, CoverMark>>(EMPTY_MARKS);
  const [searches, setSearches] = useState<CoverSearch[]>([]);
  const [budget, setBudget] = useState<CoverBudget | null>(null);
  const [stop, setStopState] = useState<CoverStop>(null);
  const [gatherPaused, setGatherPaused] = useState(false);
  const [screenPaused, setScreenPaused] = useState(false);

  const stopRef = useRef<CoverStop>(null);
  const loadedRef = useRef(false);
  const availableRef = useRef(false);
  const drainingRef = useRef(false);
  const againRef = useRef(false);
  const pauseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Which phases the running pause timer holds back; both clear when it fires. */
  const pausedRef = useRef({ gather: false, screen: false });
  const mountedRef = useRef(true);
  /** Bumped on unmount, so a drain started before it stops starting work. */
  const generationRef = useRef(0);

  const setStop = useCallback((s: CoverStop) => {
    stopRef.current = s;
    setStopState(s);
  }, []);

  /** Lists marks, active searches and the budget. Null when the lists failed. */
  const load = useCallback(async (): Promise<CoverSearch[] | null> => {
    if (householdId === null) return null;
    const budgetRead = d.getCoverBudget(householdId).then(
      (b) => b,
      (err: unknown) => {
        console.warn("cover budget read failed", errorCode(err));
        return null;
      },
    );
    try {
      const [m, s] = await Promise.all([d.listCoverMarks(householdId), d.listCoverSearches(householdId)]);
      const b = await budgetRead;
      if (!mountedRef.current) return null;
      setMarks(m);
      setSearches(s);
      setBudget(b);
      loadedRef.current = true;
      availableRef.current = true;
      setAvailable(true);
      return s;
    } catch (err) {
      console.warn("cover finder load failed", errorCode(err));
      // Before the migration (or on any first-load error) all cover UI stays hidden.
      if (mountedRef.current && (!loadedRef.current || isMissingFeature(err))) {
        availableRef.current = false;
        setAvailable(false);
      }
      return null;
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [d, householdId]);

  /** Loads, then drains unless a stop is set. At most one at a time; a request during one runs once after it. */
  const run = useCallback(async (): Promise<void> => {
    if (drainingRef.current) {
      againRef.current = true;
      return;
    }
    drainingRef.current = true;
    try {
      do {
        againRef.current = false;
        const rows = await load();
        if (rows === null || !availableRef.current || stopRef.current !== null || !mountedRef.current) continue;
        const paused = { ...pausedRef.current };
        const generation = generationRef.current;
        let touched = false;
        const result = await d.drain(
          rows,
          {
            gather: async (s) => d.recordCoverCandidates(s.id, await d.gather(s.book as CoverSearchBook)),
            recordEmpty: (id) => d.recordCoverCandidates(id, []),
            screen: (id) => d.screenSearch(id),
            readBudget: async () => {
              const b = await d.getCoverBudget(householdId as string);
              if (mountedRef.current) setBudget(b);
              return b;
            },
            sleep: d.sleep,
            now: d.now,
            onOutcome: () => {
              touched = true;
            },
            cancelled: () => !mountedRef.current || generationRef.current !== generation,
          },
          { gatherPaused: paused.gather, screenPaused: paused.screen },
        );
        if (!mountedRef.current || generationRef.current !== generation) continue;
        if (result.stop !== null) setStop(result.stop);
        // Only a drain that ran a phase can start its pause; a paused phase just echoes it.
        // A pause that has meanwhile cleared (the timer fired mid-drain) is not re-armed by the echo.
        const pauseGather = result.gatherPaused && !paused.gather && !pausedRef.current.gather;
        const pauseScreen = result.screenPaused && !paused.screen && !pausedRef.current.screen;
        if (pauseGather) {
          pausedRef.current.gather = true;
          setGatherPaused(true);
        }
        if (pauseScreen) {
          pausedRef.current.screen = true;
          setScreenPaused(true);
        }
        if ((pauseGather || pauseScreen) && pauseTimerRef.current === null) {
          pauseTimerRef.current = setTimeout(() => {
            pauseTimerRef.current = null;
            pausedRef.current = { gather: false, screen: false };
            if (!mountedRef.current) return;
            setGatherPaused(false);
            setScreenPaused(false);
            void run();
          }, GATHER_PAUSE_MS);
        }
        if (touched) await load();
      } while (againRef.current && mountedRef.current);
    } catch (err) {
      console.warn("cover drain failed", errorCode(err));
    } finally {
      drainingRef.current = false;
    }
  }, [d, householdId, load, setStop]);

  useEffect(() => {
    mountedRef.current = true;
    void run();
    return () => {
      mountedRef.current = false;
      generationRef.current += 1;
      if (pauseTimerRef.current !== null) clearTimeout(pauseTimerRef.current);
      pauseTimerRef.current = null;
      pausedRef.current = { gather: false, screen: false };
    };
  }, [run]);

  const active = available && stop === null && searches.some((s) => ACTIVE.has(s.status));
  const interval = active ? POLL_ACTIVE_MS : POLL_IDLE_MS;
  useEffect(() => {
    const timer = setInterval(() => void run(), interval);
    return () => clearInterval(timer);
  }, [interval, run]);

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") void run();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [run]);

  const reload = useCallback(async () => {
    await load();
  }, [load]);

  /** A person's explicit request: a stale budget stop shouldn't block it (the server still checks). */
  const afterRequest = useCallback(async () => {
    if (stopRef.current === "budget") setStop(null);
    await run();
  }, [run, setStop]);

  const mark = useCallback(
    async (bookId: string, reasons: CoverReason[], note: string | null) => {
      await d.markForCover(bookId, reasons, note);
      await load();
    },
    [d, load],
  );

  const unmark = useCallback(
    async (bookId: string) => {
      await d.unmarkForCover(bookId);
      await load();
    },
    [d, load],
  );

  const requestOne = useCallback(
    async (bookId: string): Promise<RequestOutcome> => {
      if (householdId === null) return "not_found";
      const out = await d.requestCoverSearches(householdId, [bookId], d.newBatchId(), true);
      await afterRequest();
      return out.get(bookId) ?? "not_found";
    },
    [afterRequest, d, householdId],
  );

  const findNow = useCallback(
    async (bookId: string, reasons: CoverReason[], note: string | null) => {
      await d.markForCover(bookId, reasons, note);
      return requestOne(bookId);
    },
    [d, requestOne],
  );

  const requestBatch = useCallback(
    async (bookIds: string[]) => {
      const counts = { queued: 0, alreadyOpen: 0, nothingFound: 0 };
      if (householdId === null || bookIds.length === 0) return counts;
      const out = await d.requestCoverSearches(householdId, bookIds, d.newBatchId(), false);
      for (const outcome of out.values()) {
        if (outcome === "queued") counts.queued += 1;
        else if (outcome === "already_open") counts.alreadyOpen += 1;
        else if (outcome === "nothing_found") counts.nothingFound += 1;
      }
      await afterRequest();
      return counts;
    },
    [afterRequest, d, householdId],
  );

  const runReview = useCallback(
    async (actions: ReviewAction[]) => {
      const out = { applied: 0, changed: 0, gone: 0 };
      const seen: string[] = [];
      try {
        for (const a of actions) {
          if (a.kind === "apply") {
            const r = await d.applyCover(a.searchId, a.url, a.expectedCover);
            if (r === "applied") out.applied += 1;
            else if (r === "cover_changed") out.changed += 1;
            else out.gone += 1;
          } else if (a.kind === "keep") {
            const r = await d.dismissCoverSearch(a.searchId);
            if (r === "not_ready") out.gone += 1;
          } else {
            seen.push(a.searchId);
          }
        }
        if (seen.length > 0) await d.markResultsSeen(seen);
      } finally {
        await load();
      }
      return out;
    },
    [d, load],
  );

  const clearStop = useCallback(() => {
    setStop(null);
    void run();
  }, [run, setStop]);

  const value = useMemo<CoverFinderState>(
    () => ({
      available,
      loading,
      marks,
      searches,
      latest: latestByBook(searches),
      budget,
      stop,
      gatherPaused,
      screenPaused,
      reviewCount: countForReview(searches),
      mark,
      unmark,
      findNow,
      requestBatch,
      retry: requestOne,
      runReview,
      clearStop,
      reload,
    }),
    [
      available,
      loading,
      marks,
      searches,
      budget,
      stop,
      gatherPaused,
      screenPaused,
      mark,
      unmark,
      findNow,
      requestBatch,
      requestOne,
      runReview,
      clearStop,
      reload,
    ],
  );

  return <CoverFinderContext.Provider value={value}>{props.children}</CoverFinderContext.Provider>;
}

/** Outside a provider (signed out, or a component test) the feature is simply unavailable. */
// eslint-disable-next-line react-refresh/only-export-components
export function useCoverFinder(): CoverFinderState {
  return useContext(CoverFinderContext) ?? UNAVAILABLE_COVER_FINDER;
}
