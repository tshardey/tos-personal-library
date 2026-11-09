import { useCallback, useEffect, useRef, useState } from "react";
import { useHousehold } from "@/contexts/HouseholdContext";
import { googleBooksApiKey } from "@/lib/google-books";
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
  setItemOwner,
  signedPhotoUrls,
  type ProcessOutcome,
} from "@/lib/photo/intake-repo";
import { LookupError, lookupMetadata } from "@/lib/photo/lookup";
import type { IntakeAction } from "@/lib/photo/propose";
import type { IntakeItem } from "@/lib/photo/types";
import type { BookWithCopies } from "@/lib/types";

export const POLL_MS = 10_000;
const ACTIVE = new Set(["pending", "processing"]);
const OPEN = new Set(["pending", "processing", "ready", "failed"]);

const errName = (e: unknown) => (e instanceof Error ? e.name : "unknown");
const browserFetch: typeof fetch = (...args) => fetch(...args);

export interface IntakeState {
  items: IntakeItem[];
  catalog: BookWithCopies[];
  status: "loading" | "ready" | "error";
  stop: DrainStop;
  lookupPaused: boolean;
  /** True while any photo is being read; the page keeps the screen on for it. */
  reading: boolean;
  thumbs: Map<string, string>;
  reload(): Promise<void>;
  processNew(itemId: string): void;
  retry(itemId: string): Promise<void>;
  resumeLookups(): void;
  setOwner(itemId: string, ownerUserId: string | null): void;
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
  const [stop, setStopState] = useState<DrainStop>(null);
  const [lookupPaused, setLookupPaused] = useState(false);
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

  /** Re-reads both; rejects (and shows the inbox error) if either read fails. */
  const load = useCallback(async () => {
    if (!householdId) return;
    try {
      const [nextItems, nextCatalog] = await Promise.all([listIntakeItems(householdId), listBooks(householdId)]);
      catalogRef.current = nextCatalog;
      setCatalogState(nextCatalog);
      setItems(nextItems);
      setStatus("ready");
    } catch (e) {
      console.error("Failed to load the photo inbox", errName(e));
      setStatus("error");
      throw e;
    }
  }, [householdId, setItems]);

  const loadItems = useCallback(async () => {
    if (!householdId) return;
    try {
      setItems(await listIntakeItems(householdId));
    } catch (e) {
      console.error("Failed to refresh the photo inbox", errName(e));
      setStatus("error");
      throw e;
    }
  }, [householdId, setItems]);

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

  const runLookups = useCallback(async () => {
    if (lookupBusy.current || pausedRef.current) return;
    lookupBusy.current = true;
    try {
      for (;;) {
        if (!mounted.current || pausedRef.current) break;
        const next = itemsRef.current.find(
          (i) =>
            i.status === "ready" &&
            i.lookup === null &&
            (i.extraction?.title ?? "").trim() !== "" &&
            !lookedUp.current.has(i.id),
        );
        if (!next) break;
        lookedUp.current.add(next.id);
        let result;
        try {
          result = await lookupMetadata(
            { title: next.extraction!.title!, authors: next.extraction!.authors },
            { fetchImpl: browserFetch, googleBooksKey: googleBooksApiKey() },
          );
        } catch (e) {
          if (e instanceof LookupError) {
            lookedUp.current.delete(next.id);
            pausedRef.current = true;
            setLookupPaused(true);
            break;
          }
          console.error("Lookup failed", errName(e));
          continue;
        }
        try {
          await saveLookup(next.id, result);
        } catch (e) {
          console.error("Failed to save a lookup", errName(e));
        }
        patchItem(next.id, { lookup: result });
      }
    } finally {
      lookupBusy.current = false;
    }
  }, [patchItem]);

  const resumeLookups = useCallback(() => {
    pausedRef.current = false;
    setLookupPaused(false);
    void runLookups();
  }, [runLookups]);

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

  const perform = useCallback(
    async (item: IntakeItem, action: IntakeAction, form: ConfirmForm) => {
      const result = await performConfirm(item, action, form, {
        confirm: confirmItem,
        discard: discardItem,
        patchBook: (...args) => libibStore.patchBook(...args),
        enrich,
        catalog: catalogRef.current,
        purge: () => (householdId ? purgeIntakePhotos(householdId) : Promise.resolve(0)),
      });
      patchItem(item.id, {
        status: action.kind === "already_recorded" ? "discarded" : "confirmed",
        resultBookId: result.bookId,
        updatedAt: new Date().toISOString(),
      });
      return result;
    },
    [enrich, householdId, patchItem],
  );

  const confirm = useCallback(
    async (item: IntakeItem, action: IntakeAction, form: ConfirmForm) => {
      await perform(item, action, form);
      await load().catch(() => {});
    },
    [perform, load],
  );

  const bulkConfirm = useCallback(
    async (itemIds: string[]) => {
      try {
        return await runBulkConfirm(
          itemIds,
          () => ({ catalog: catalogRef.current, openItems: itemsRef.current }),
          { perform, refresh: load },
        );
      } finally {
        await load().catch(() => {});
      }
    },
    [perform, load],
  );

  const reload = useCallback(async () => {
    await load();
    await drain();
  }, [load, drain]);

  return {
    items,
    catalog,
    status,
    stop,
    lookupPaused,
    reading: inFlightCount > 0,
    thumbs,
    reload,
    processNew,
    retry,
    resumeLookups,
    setOwner,
    confirm,
    bulkConfirm,
  };
}
