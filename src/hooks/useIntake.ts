import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useHousehold } from "@/contexts/HouseholdContext";
import { googleBooksApiKey } from "@/lib/google-books";
import { editionLabels } from "@/lib/editions";
import { enrichMissing } from "@/lib/libib/enrich";
import { libibStore, listBooks } from "@/lib/library-repo";
import { performConfirm, runBulkConfirm, type ConfirmForm } from "@/lib/photo/confirm";
import { drainIntake, type DrainStop } from "@/lib/photo/drain";
import {
  confirmItem,
  discardItem,
  listIntakeItems,
  processItem,
  purgeIntakePhotos,
  retryItem,
  saveLookup,
  setItemEdition,
  setItemOwner,
  signedPhotoUrls,
  type ProcessOutcome,
} from "@/lib/photo/intake-repo";
import { LookupError, lookupForItem, needsLookup } from "@/lib/photo/lookup";
import type { IntakeAction } from "@/lib/photo/propose";
import type { IntakeItem } from "@/lib/photo/types";
import type { BookWithCopies } from "@/lib/types";

export const POLL_MS = 10_000;
/** D6: a paused lookup queue starts again by itself after this long. */
export const LOOKUP_RESUME_MS = 60_000;
const ACTIVE = new Set(["pending", "processing"]);
const OPEN = new Set(["pending", "processing", "ready", "failed"]);

const errName = (e: unknown) => (e instanceof Error ? e.name : "unknown");
const browserFetch: typeof fetch = (...args) => fetch(...args);

export interface IntakeState {
  items: IntakeItem[];
  catalog: BookWithCopies[];
  /** `error` only when the first load fails; later failures set `stale` and keep the page. */
  status: "loading" | "ready" | "error";
  /** A refresh failed since the last full load: items or catalog may be out of date. */
  stale: boolean;
  stop: DrainStop;
  lookupPaused: boolean;
  /** D6: when a paused lookup queue resumes by itself (epoch ms), or null when not paused. */
  lookupPausedUntil: number | null;
  /** Items whose lookup failed this session; they show no "Looking it up" line until retried. */
  lookupFailed: Set<string>;
  /** True while any photo is being read; the page keeps the screen on for it. */
  reading: boolean;
  thumbs: Map<string, string>;
  /** D12: the household's edition labels, from the catalog's copies and the open items. */
  labels: string[];
  reload(): Promise<void>;
  processNew(itemId: string): void;
  retry(itemId: string): Promise<void>;
  resumeLookups(): void;
  setOwner(itemId: string, ownerUserId: string | null): void;
  /** Shows the label at once and saves it on the item; a failed save shows on the next load. */
  setEdition(itemId: string, label: string | null): void;
  /** Adds or replaces an item without a reload (the scanner's newly created scans). */
  upsertLocal(item: IntakeItem): void;
  confirm(item: IntakeItem, action: IntakeAction, form: ConfirmForm): Promise<void>;
  bulkConfirm(itemIds: string[]): Promise<{ confirmed: number; skipped: number }>;
}

/**
 * Inbox data: items and catalog, polling while anything is being read, the drain (D1), one-at-a-
 * time lookups (D8) and signed thumbnails. It writes to the catalog only from `confirm` and
 * `bulkConfirm`, which the page calls from button presses.
 */
export function useIntake(): IntakeState {
  const { household } = useHousehold();
  const householdId = household?.id ?? null;
  const [items, setItemsState] = useState<IntakeItem[]>([]);
  const [catalog, setCatalogState] = useState<BookWithCopies[]>([]);
  const [status, setStatus] = useState<IntakeState["status"]>("loading");
  const [stale, setStale] = useState(false);
  const [lookupFailed, setLookupFailedState] = useState<Set<string>>(new Set());
  const [stop, setStopState] = useState<DrainStop>(null);
  const [lookupPausedUntil, setLookupPausedUntil] = useState<number | null>(null);
  const [inFlightCount, setInFlightCount] = useState(0);
  const [thumbs, setThumbs] = useState<Map<string, string>>(new Map());

  const itemsRef = useRef<IntakeItem[]>([]);
  const catalogRef = useRef<BookWithCopies[]>([]);
  const stopRef = useRef<DrainStop>(null);
  const pausedRef = useRef(false);
  const inFlight = useRef(new Set<string>());
  const draining = useRef(false);
  const lookupBusy = useRef(false);
  const lookedUp = useRef(new Set<string>());
  const thumbRequested = useRef(new Set<string>());
  const enrichChain = useRef<Promise<unknown>>(Promise.resolve());
  const mounted = useRef(true);
  const loadedOnce = useRef(false);
  const staleRef = useRef(false);
  const failedLookups = useRef(new Set<string>());
  const resumeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoResume = useRef<() => void>(() => {});
  /** Edition saves still in flight; a bulk confirm waits for them so it writes the label shown. */
  const editionWrites = useRef(new Set<Promise<unknown>>());

  const markStale = useCallback((value: boolean) => {
    staleRef.current = value;
    setStale(value);
  }, []);
  const failLookup = useCallback((id: string) => {
    failedLookups.current.add(id);
    setLookupFailedState(new Set(failedLookups.current));
  }, []);
  /** Lets lookups that failed this session run again. */
  const clearFailedLookups = useCallback(() => {
    if (failedLookups.current.size === 0) return;
    for (const id of failedLookups.current) lookedUp.current.delete(id);
    failedLookups.current = new Set();
    setLookupFailedState(new Set());
  }, []);

  /** After the first load, a failed read keeps what's on screen and marks it stale. */
  const onReadFailure = useCallback(
    (e: unknown) => {
      console.error("Failed to load the photo inbox", errName(e));
      if (loadedOnce.current) markStale(true);
      else setStatus("error");
    },
    [markStale],
  );

  const setItems = useCallback((next: IntakeItem[]) => {
    itemsRef.current = next;
    setItemsState(next);
  }, []);
  const patchItem = useCallback(
    (id: string, patch: Partial<IntakeItem>) =>
      setItems(itemsRef.current.map((i) => (i.id === id ? { ...i, ...patch } : i))),
    [setItems],
  );
  const setStop = useCallback((s: DrainStop) => {
    if (stopRef.current !== null || s === null) return;
    stopRef.current = s;
    setStopState(s);
  }, []);

  /** Re-reads both and clears `stale`; rejects if either read fails. */
  const load = useCallback(async () => {
    if (!householdId) return;
    try {
      const [nextItems, nextCatalog] = await Promise.all([listIntakeItems(householdId), listBooks(householdId)]);
      catalogRef.current = nextCatalog;
      setCatalogState(nextCatalog);
      setItems(nextItems);
      loadedOnce.current = true;
      markStale(false);
      setStatus("ready");
    } catch (e) {
      onReadFailure(e);
      throw e;
    }
  }, [householdId, setItems, markStale, onReadFailure]);

  /** Items only. While stale, a full load instead, so the catalog heals too. */
  const loadItems = useCallback(async () => {
    if (!householdId) return;
    if (staleRef.current) return load();
    try {
      setItems(await listIntakeItems(householdId));
    } catch (e) {
      onReadFailure(e);
      throw e;
    }
  }, [householdId, setItems, load, onReadFailure]);

  const onOutcome = useCallback(
    (_id: string, outcome: ProcessOutcome | "error") => {
      if (outcome === "daily_cap" || outcome === "misconfigured") setStop(outcome);
    },
    [setStop],
  );

  const tracked = useCallback(async (itemId: string): Promise<ProcessOutcome> => {
    inFlight.current.add(itemId);
    setInFlightCount(inFlight.current.size);
    try {
      return await processItem(itemId);
    } finally {
      inFlight.current.delete(itemId);
      if (mounted.current) setInFlightCount(inFlight.current.size);
    }
  }, []);

  /** D1: a freshly uploaded item is read straight away, unless reading has stopped for the session. */
  const processNew = useCallback(
    (itemId: string) => {
      if (stopRef.current !== null || inFlight.current.has(itemId)) return;
      void (async () => {
        let outcome: ProcessOutcome | "error";
        try {
          outcome = await tracked(itemId);
        } catch {
          outcome = "error";
        }
        onOutcome(itemId, outcome);
        if (mounted.current) await loadItems().catch(() => {});
      })();
    },
    [tracked, onOutcome, loadItems],
  );

  /** Runs due items once. Started from the first load and each poll tick, never from its own refresh. */
  const drain = useCallback(async () => {
    if (stopRef.current !== null || draining.current) return;
    const due = itemsRef.current.filter((i) => !inFlight.current.has(i.id));
    draining.current = true;
    try {
      const result = await drainIntake(due, { process: tracked, now: () => new Date(), onOutcome });
      setStop(result);
    } finally {
      draining.current = false;
    }
    if (mounted.current) await loadItems().catch(() => {});
  }, [tracked, onOutcome, setStop, loadItems]);

  const clearResumeTimer = useCallback(() => {
    if (resumeTimer.current !== null) clearTimeout(resumeTimer.current);
    resumeTimer.current = null;
  }, []);

  /** D6: a retryable failure pauses the queue, which resumes by itself after LOOKUP_RESUME_MS. */
  const pauseLookups = useCallback(() => {
    pausedRef.current = true;
    setLookupPausedUntil(Date.now() + LOOKUP_RESUME_MS);
    clearResumeTimer();
    resumeTimer.current = setTimeout(() => {
      resumeTimer.current = null;
      if (mounted.current) autoResume.current();
    }, LOOKUP_RESUME_MS);
  }, [clearResumeTimer]);

  const runLookups = useCallback(async () => {
    if (lookupBusy.current || pausedRef.current) return;
    lookupBusy.current = true;
    try {
      for (;;) {
        if (!mounted.current || pausedRef.current) break;
        // D6: one at a time, oldest first.
        const next = itemsRef.current
          .filter((i) => needsLookup(i) && !lookedUp.current.has(i.id))
          .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))[0];
        if (!next) break;
        lookedUp.current.add(next.id);
        let result;
        try {
          result = await lookupForItem(next, { fetchImpl: browserFetch, googleBooksKey: googleBooksApiKey() });
        } catch (e) {
          if (e instanceof LookupError && e.retryable) {
            // D6: 429, 5xx or the network: pause everything, and resume by itself.
            lookedUp.current.delete(next.id);
            pauseLookups();
            break;
          }
          console.error("Lookup failed", errName(e));
          failLookup(next.id);
          continue;
        }
        try {
          await saveLookup(next.id, result);
        } catch (e) {
          // A later poll would bring back lookup: null, so don't promise a lookup that's done.
          console.error("Failed to save a lookup", errName(e));
          failLookup(next.id);
        }
        patchItem(next.id, { lookup: result });
      }
    } finally {
      lookupBusy.current = false;
    }
  }, [patchItem, failLookup, pauseLookups]);

  /** Starts paused lookups again. `clearFailed` (the Retry button) also retries failed items. */
  const unpause = useCallback(
    (clearFailed: boolean) => {
      clearResumeTimer();
      pausedRef.current = false;
      setLookupPausedUntil(null);
      if (clearFailed) clearFailedLookups();
      void runLookups();
    },
    [runLookups, clearFailedLookups, clearResumeTimer],
  );

  useEffect(() => {
    autoResume.current = () => unpause(false);
  }, [unpause]);

  const resumeLookups = useCallback(() => unpause(true), [unpause]);

  // D6: coming back online resumes a paused queue at once.
  useEffect(() => {
    const onOnline = () => {
      if (pausedRef.current) unpause(false);
    };
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, [unpause]);
  useEffect(() => clearResumeTimer, [clearResumeTimer]);

  // First load: purge what's no longer needed (D11), then load and drain.
  useEffect(() => {
    mounted.current = true;
    if (!householdId) return;
    void purgeIntakePhotos(householdId).catch((e) => console.error("Intake purge failed", errName(e)));
    void load()
      .then(() => drain())
      .catch(() => {});
    return () => {
      mounted.current = false;
    };
  }, [householdId, load, drain]);

  const hasActive = items.some((i) => ACTIVE.has(i.status));
  useEffect(() => {
    if (!hasActive || status !== "ready") return;
    const timer = setInterval(() => {
      void loadItems()
        .then(() => drain())
        .catch(() => {});
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [hasActive, status, loadItems, drain]);
  // Polling keeps running while stale (status stays "ready"), and each tick tries a full load.

  // Lookups and thumbnails follow the item list; neither touches the catalog.
  useEffect(() => {
    void runLookups();
    const paths = items
      .filter((i) => OPEN.has(i.status) && i.coverPath && !thumbRequested.current.has(i.coverPath))
      .map((i) => i.coverPath!);
    if (paths.length === 0) return;
    for (const p of paths) thumbRequested.current.add(p);
    signedPhotoUrls(paths)
      .then((urls) => {
        if (mounted.current && urls.size > 0) setThumbs((prev) => new Map([...prev, ...urls]));
      })
      .catch((e) => {
        for (const p of paths) thumbRequested.current.delete(p);
        console.error("Failed to sign photo URLs", errName(e));
      });
  }, [items, runLookups]);

  const retry = useCallback(
    async (itemId: string) => {
      await retryItem(itemId);
      patchItem(itemId, { status: "pending", errorCode: null, retryAt: null });
      processNew(itemId);
    },
    [patchItem, processNew],
  );

  const setOwner = useCallback(
    (itemId: string, ownerUserId: string | null) => {
      patchItem(itemId, { ownerUserId });
      setItemOwner(itemId, ownerUserId).catch((e) => console.error("Failed to save the owner", errName(e)));
    },
    [patchItem],
  );

  const setEdition = useCallback(
    (itemId: string, label: string | null) => {
      patchItem(itemId, { editionLabel: label });
      const write: Promise<unknown> = setItemEdition(itemId, label)
        .catch((e) => console.error("Failed to save the edition", errName(e)))
        .finally(() => editionWrites.current.delete(write));
      editionWrites.current.add(write);
    },
    [patchItem],
  );

  const upsertLocal = useCallback(
    (next: IntakeItem) => {
      const exists = itemsRef.current.some((i) => i.id === next.id);
      setItems(exists ? itemsRef.current.map((i) => (i.id === next.id ? next : i)) : [...itemsRef.current, next]);
    },
    [setItems],
  );

  const enrich = useCallback(
    (books: BookWithCopies[]) => {
      const ids = new Set(books.map((b) => b.id));
      // One at a time, against fresh rows, so patchBook's updated_at check sees current values.
      const run = enrichChain.current.then(async () => {
        if (!householdId) return;
        const fresh = (await listBooks(householdId)).filter((b) => ids.has(b.id));
        await enrichMissing(fresh, libibStore, { fetchImpl: browserFetch, googleBooksKey: googleBooksApiKey() });
      });
      enrichChain.current = run.catch(() => {});
      return run;
    },
    [householdId],
  );

  /** One write, then the local status. `refreshFirst` reloads before the item leaves openItems. */
  const perform = useCallback(
    async (item: IntakeItem, action: IntakeAction, form: ConfirmForm, refreshFirst = false) => {
      const result = await performConfirm(item, action, form, {
        confirm: confirmItem,
        discard: discardItem,
        patchBook: (...args) => libibStore.patchBook(...args),
        enrich,
        catalog: catalogRef.current,
        purge: () => (householdId ? purgeIntakePhotos(householdId) : Promise.resolve(0)),
      });
      // While this item is still open, a twin card warns about it. Patching it to done before the
      // catalog holds the new book would leave that card with no warning and no match, so the
      // reload comes first.
      if (refreshFirst) await load().catch(() => {});
      patchItem(item.id, {
        status: action.kind === "already_recorded" || action.kind === "discard" ? "discarded" : "confirmed",
        resultBookId: result.bookId,
        updatedAt: new Date().toISOString(),
      });
      return result;
    },
    [enrich, householdId, patchItem, load],
  );

  const confirm = useCallback(
    async (item: IntakeItem, action: IntakeAction, form: ConfirmForm) => {
      await perform(item, action, form, true);
    },
    [perform],
  );

  const bulkConfirm = useCallback(
    async (itemIds: string[]) => {
      // D12: an edition just set for the selection is saved before the reloads bulk confirm reads.
      await Promise.allSettled([...editionWrites.current]);
      try {
        // Bulk items have no twins (D7), and runBulkConfirm reloads before each next write.
        return await runBulkConfirm(
          itemIds,
          () => ({ catalog: catalogRef.current, openItems: itemsRef.current }),
          { perform: (item, action, form) => perform(item, action, form), refresh: load },
        );
      } finally {
        await load().catch(() => {});
      }
    },
    [perform, load],
  );

  const reload = useCallback(async () => {
    clearFailedLookups();
    await load();
    await drain();
  }, [load, drain, clearFailedLookups]);

  const labels = useMemo(
    () =>
      editionLabels(
        catalog,
        items.filter((i) => OPEN.has(i.status) && i.editionLabel !== null).map((i) => i.editionLabel!),
      ),
    [catalog, items],
  );

  return {
    items,
    catalog,
    status,
    stale,
    stop,
    lookupPaused: lookupPausedUntil !== null,
    lookupPausedUntil,
    lookupFailed,
    reading: inFlightCount > 0,
    thumbs,
    labels,
    reload,
    processNew,
    retry,
    resumeLookups,
    setOwner,
    setEdition,
    upsertLocal,
    confirm,
    bulkConfirm,
  };
}
