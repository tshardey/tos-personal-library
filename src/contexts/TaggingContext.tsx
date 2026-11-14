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
import { isMissingFeature } from "@/lib/covers/cover-repo";
import { loadTosTags } from "@/lib/tos-tags";
import {
  drainTagging,
  isJobDue,
  TAG_PAUSE_MS,
  type TagStop,
} from "@/lib/tagging/drain";
import {
  newestJobByBook,
  vocabVersion as vocabVersionOf,
} from "@/lib/tagging/eligibility";
import { tagIdFromLabel } from "@/lib/tagging/slug";
import {
  addLibraryTag,
  approveSuggestion,
  ask as askRepo,
  createLibraryTag,
  dismissSuggestion,
  getAiBudget,
  listCardMeta,
  listLibraryTagsByBook,
  listSuggestions,
  listTagJobs,
  listVocabulary,
  removeLibraryTag,
  requestTagging,
  runTagJob,
} from "@/lib/tagging/tagging-repo";
import type {
  AiBudget,
  AskResponse,
  BookCardMeta,
  LibraryTag,
  LibraryTagCategory,
  TagJob,
  TagSuggestion,
} from "@/lib/tagging/types";

export const POLL_ACTIVE_MS = 15_000;
export const POLL_IDLE_MS = 120_000;

export interface TaggingState {
  available: boolean;
  loading: boolean;
  vocabulary: LibraryTag[];
  vocabVersion: number;
  libraryTagsByBook: Map<string, string[]>;
  cards: Map<string, BookCardMeta>;
  jobs: TagJob[];
  latestJob: Map<string, TagJob>;
  suggestions: TagSuggestion[];
  budgets: { tagging: AiBudget | null; ask: AiBudget | null };
  stop: TagStop;
  runId: string | null;
  /** Bumps after any job finishes `done`, so pages refresh the ToS tags. */
  tagsVersion: number;
  setBookLibraryTag(bookId: string, tagId: string, on: boolean): Promise<void>;
  retag(bookId: string): Promise<void>;
  tagAll(bookIds: string[]): Promise<number>;
  checkNewTags(bookIds: string[]): Promise<number>;
  approve(
    id: string,
    label: string,
    category: LibraryTagCategory,
  ): Promise<number>;
  dismiss(id: string): Promise<void>;
  createTag(
    label: string,
    category: LibraryTagCategory,
  ): Promise<"added" | "exists" | "invalid">;
  ask(prompt: string, bookIds: string[]): Promise<AskResponse>;
  clearStop(): void;
  reload(): Promise<void>;
}

export interface TaggingDeps {
  listVocabulary: typeof listVocabulary;
  listLibraryTagsByBook: typeof listLibraryTagsByBook;
  listCardMeta: typeof listCardMeta;
  listTagJobs: typeof listTagJobs;
  listSuggestions: typeof listSuggestions;
  getAiBudget: typeof getAiBudget;
  addLibraryTag: typeof addLibraryTag;
  removeLibraryTag: typeof removeLibraryTag;
  requestTagging: typeof requestTagging;
  runTagJob: typeof runTagJob;
  approveSuggestion: typeof approveSuggestion;
  dismissSuggestion: typeof dismissSuggestion;
  createLibraryTag: typeof createLibraryTag;
  ask: typeof askRepo;
  loadTosTags: typeof loadTosTags;
  drain: typeof drainTagging;
  now(): Date;
  newRunId(): string;
}

function defaultDeps(): TaggingDeps {
  return {
    listVocabulary,
    listLibraryTagsByBook,
    listCardMeta,
    listTagJobs,
    listSuggestions,
    getAiBudget,
    addLibraryTag,
    removeLibraryTag,
    requestTagging,
    runTagJob,
    approveSuggestion,
    dismissSuggestion,
    createLibraryTag,
    ask: askRepo,
    loadTosTags,
    drain: drainTagging,
    now: () => new Date(),
    newRunId: () => crypto.randomUUID(),
  };
}

const EMPTY_TAGS: Map<string, string[]> = new Map();
const EMPTY_CARDS: Map<string, BookCardMeta> = new Map();
const EMPTY_JOBS: Map<string, TagJob> = new Map();
const NO_BUDGETS: TaggingState["budgets"] = { tagging: null, ask: null };

// eslint-disable-next-line react-refresh/only-export-components
export const UNAVAILABLE_TAGGING: TaggingState = {
  available: false,
  loading: false,
  vocabulary: [],
  vocabVersion: 1,
  libraryTagsByBook: EMPTY_TAGS,
  cards: EMPTY_CARDS,
  jobs: [],
  latestJob: EMPTY_JOBS,
  suggestions: [],
  budgets: NO_BUDGETS,
  stop: null,
  runId: null,
  tagsVersion: 0,
  setBookLibraryTag: async () => {},
  retag: async () => {},
  tagAll: async () => 0,
  checkNewTags: async () => 0,
  approve: async () => 0,
  dismiss: async () => {},
  createTag: async () => "exists",
  ask: async () => ({ outcome: "failed" }),
  clearStop: () => {},
  reload: async () => {},
};

const TaggingContext = createContext<TaggingState | null>(null);

const errorCode = (err: unknown): string =>
  (err as { code?: unknown } | null)?.code?.toString() ??
  (err instanceof Error ? err.name : "unknown");

const isOpen = (j: TagJob) =>
  j.status === "queued" || j.status === "processing";

/** The newest run seen among open jobs. */
function currentRunId(jobs: TagJob[]): string | null {
  let best: TagJob | null = null;
  for (const j of jobs) {
    if (!isOpen(j) || j.runId === null) continue;
    if (best === null || j.createdAt > best.createdAt) best = j;
  }
  return best?.runId ?? null;
}

export function TaggingProvider(props: {
  children: ReactNode;
  deps?: Partial<TaggingDeps>;
}): JSX.Element {
  const { household } = useHousehold();
  const householdId = household?.id ?? null;
  // Fixed for the provider's life, so callbacks stay stable.
  const [d] = useState<TaggingDeps>(() => ({
    ...defaultDeps(),
    ...props.deps,
  }));

  const [available, setAvailable] = useState(false);
  const [loading, setLoading] = useState(true);
  const [vocabulary, setVocabulary] = useState<LibraryTag[]>([]);
  const [libraryTagsByBook, setLibraryTagsByBook] =
    useState<Map<string, string[]>>(EMPTY_TAGS);
  const [cards, setCards] = useState<Map<string, BookCardMeta>>(EMPTY_CARDS);
  const [jobs, setJobs] = useState<TagJob[]>([]);
  const [suggestions, setSuggestions] = useState<TagSuggestion[]>([]);
  const [budgets, setBudgets] = useState<TaggingState["budgets"]>(NO_BUDGETS);
  const [stop, setStopState] = useState<TagStop>(null);
  const [tagsVersion, setTagsVersion] = useState(0);

  const stopRef = useRef<TagStop>(null);
  /** The function was unreachable twice in a row; draining resumes when the timer fires. */
  const pausedRef = useRef(false);
  const pauseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loadedRef = useRef(false);
  const availableRef = useRef(false);
  const drainingRef = useRef(false);
  const againRef = useRef(false);
  const mountedRef = useRef(true);
  /** Bumped on unmount, so a drain started before it stops starting work. */
  const generationRef = useRef(0);
  const vocabularyRef = useRef<LibraryTag[]>([]);

  const setStop = useCallback((s: TagStop) => {
    stopRef.current = s;
    setStopState(s);
  }, []);

  const readBudget = useCallback(
    async (feature: "tagging" | "ask"): Promise<AiBudget | null> => {
      if (householdId === null) return null;
      try {
        return await d.getAiBudget(householdId, feature);
      } catch (err) {
        console.warn("tag budget read failed", errorCode(err));
        return null;
      }
    },
    [d, householdId],
  );

  /** Lists everything. Null when the lists failed. */
  const load = useCallback(async (): Promise<TagJob[] | null> => {
    if (householdId === null) return null;
    const budgetsRead = Promise.all([readBudget("tagging"), readBudget("ask")]);
    try {
      const [v, t, c, j, s] = await Promise.all([
        d.listVocabulary(householdId),
        d.listLibraryTagsByBook(householdId),
        d.listCardMeta(householdId),
        d.listTagJobs(householdId),
        d.listSuggestions(householdId),
      ]);
      const [tagging, askBudget] = await budgetsRead;
      if (!mountedRef.current) return null;
      vocabularyRef.current = v;
      setVocabulary(v);
      setLibraryTagsByBook(t);
      setCards(c);
      setJobs(j);
      setSuggestions(s);
      setBudgets({ tagging, ask: askBudget });
      loadedRef.current = true;
      availableRef.current = true;
      setAvailable(true);
      return j;
    } catch (err) {
      console.warn("tagging load failed", errorCode(err));
      // Before the migration (or on any first-load error) all tagging UI stays hidden.
      if (mountedRef.current && (!loadedRef.current || isMissingFeature(err))) {
        availableRef.current = false;
        setAvailable(false);
      }
      return null;
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [d, householdId, readBudget]);

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
        if (
          rows === null ||
          !availableRef.current ||
          stopRef.current !== null ||
          !mountedRef.current
        )
          continue;
        const generation = generationRef.current;
        const wasPaused = pausedRef.current;
        let touched = false;
        let finished = false;
        const result = await d.drain(
          rows,
          {
            run: (id) => d.runTagJob(id),
            readBudget: async () => {
              const b = await d.getAiBudget(householdId as string, "tagging");
              if (mountedRef.current)
                setBudgets((cur) => ({ ...cur, tagging: b }));
              return b;
            },
            now: d.now,
            onOutcome: (_id, outcome) => {
              touched = true;
              if (outcome === "done") finished = true;
            },
            cancelled: () =>
              !mountedRef.current || generationRef.current !== generation,
          },
          { paused: wasPaused },
        );
        if (!mountedRef.current || generationRef.current !== generation)
          continue;
        if (result.stop !== null) setStop(result.stop);
        // Only a drain that ran jobs can start a pause; a paused drain just echoes it.
        if (result.paused && !wasPaused && !pausedRef.current) {
          pausedRef.current = true;
          pauseTimerRef.current = setTimeout(() => {
            pauseTimerRef.current = null;
            pausedRef.current = false;
            if (mountedRef.current) void run();
          }, TAG_PAUSE_MS);
        }
        if (finished) setTagsVersion((v) => v + 1);
        if (touched) await load();
      } while (againRef.current && mountedRef.current);
    } catch (err) {
      console.warn("tagging drain failed", errorCode(err));
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
      pausedRef.current = false;
    };
  }, [run]);

  const due =
    available && stop === null && jobs.some((j) => isJobDue(j, d.now()));
  const interval = due ? POLL_ACTIVE_MS : POLL_IDLE_MS;
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

  const setBookLibraryTag = useCallback(
    async (bookId: string, tagId: string, on: boolean) => {
      if (householdId === null) return;
      if (on) await d.addLibraryTag(bookId, householdId, tagId);
      else await d.removeLibraryTag(bookId, tagId);
      await load();
    },
    [d, householdId, load],
  );

  const queue = useCallback(
    async (
      bookIds: string[],
      reason: "run" | "manual" | "new_tags",
      runId: string | null,
    ): Promise<number> => {
      if (householdId === null || bookIds.length === 0) return 0;
      const out = await d.requestTagging(householdId, bookIds, reason, runId);
      let queued = 0;
      for (const o of out.values()) if (o === "queued") queued += 1;
      await afterRequest();
      return queued;
    },
    [afterRequest, d, householdId],
  );

  const retag = useCallback(
    async (bookId: string) => {
      await queue([bookId], "manual", null);
    },
    [queue],
  );
  const tagAll = useCallback(
    (bookIds: string[]) => queue(bookIds, "run", d.newRunId()),
    [d, queue],
  );
  const checkNewTags = useCallback(
    (bookIds: string[]) => queue(bookIds, "new_tags", null),
    [queue],
  );

  const approve = useCallback(
    async (id: string, label: string, category: LibraryTagCategory) => {
      const n = await d.approveSuggestion(id, label, category);
      await load();
      return n;
    },
    [d, load],
  );

  const dismiss = useCallback(
    async (id: string) => {
      await d.dismissSuggestion(id);
      await load();
    },
    [d, load],
  );

  const createTag = useCallback(
    async (
      label: string,
      category: LibraryTagCategory,
    ): Promise<"added" | "exists" | "invalid"> => {
      if (householdId === null) return "exists";
      const id = tagIdFromLabel(label);
      if (id === "") return "invalid";
      if (vocabularyRef.current.some((t) => t.id === id)) return "exists";
      const { tags } = await d.loadTosTags();
      if (tags.some((t) => t.id === id)) return "exists";
      try {
        await d.createLibraryTag(householdId, id, label.trim(), category);
      } catch (err) {
        if (errorCode(err) === "23505") return "exists";
        throw err;
      }
      await load();
      return "added";
    },
    [d, householdId, load],
  );

  const ask = useCallback(
    async (prompt: string, bookIds: string[]): Promise<AskResponse> => {
      if (householdId === null) return { outcome: "failed" };
      try {
        return await d.ask(householdId, prompt, bookIds);
      } finally {
        const b = await readBudget("ask");
        if (mountedRef.current && b !== null)
          setBudgets((cur) => ({ ...cur, ask: b }));
      }
    },
    [d, householdId, readBudget],
  );

  const clearStop = useCallback(() => {
    setStop(null);
    void run();
  }, [run, setStop]);

  const value = useMemo<TaggingState>(
    () => ({
      available,
      loading,
      vocabulary,
      vocabVersion: vocabVersionOf(vocabulary),
      libraryTagsByBook,
      cards,
      jobs,
      latestJob: newestJobByBook(jobs),
      suggestions,
      budgets,
      stop,
      runId: currentRunId(jobs),
      tagsVersion,
      setBookLibraryTag,
      retag,
      tagAll,
      checkNewTags,
      approve,
      dismiss,
      createTag,
      ask,
      clearStop,
      reload,
    }),
    [
      available,
      loading,
      vocabulary,
      libraryTagsByBook,
      cards,
      jobs,
      suggestions,
      budgets,
      stop,
      tagsVersion,
      setBookLibraryTag,
      retag,
      tagAll,
      checkNewTags,
      approve,
      dismiss,
      createTag,
      ask,
      clearStop,
      reload,
    ],
  );

  return (
    <TaggingContext.Provider value={value}>
      {props.children}
    </TaggingContext.Provider>
  );
}

/** Outside a provider (signed out, or a component test) the feature is simply unavailable. */
// eslint-disable-next-line react-refresh/only-export-components
export function useTagging(): TaggingState {
  return useContext(TaggingContext) ?? UNAVAILABLE_TAGGING;
}
