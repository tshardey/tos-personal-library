import type { createScanItem, ScanItemArgs, ScanSaveError } from "../photo/intake-repo";
import type { IntakeItem } from "../photo/types";

/** D6: the create_scan_item arguments, written before any network call. */
export interface OutboxEntry extends ScanItemArgs {
  createdAt: string;
  failed?: "rejected";
}

export function outboxKey(householdId: string): string {
  return `tpl_scan_outbox_${householdId}`;
}

/**
 * The tab's own copy of each household's outbox. localStorage is best-effort persistence: when a
 * write fails (storage blocked, quota exceeded) the entries still live here, so a scan is still
 * sent and shown while the tab lives. `inSync` is false while storage lags behind memory.
 */
const memory = new Map<string, { entries: OutboxEntry[]; inSync: boolean }>();

/** Tests only: forgets every in-memory outbox. */
export function resetOutboxMemory(): void {
  memory.clear();
}

function readStorage(householdId: string): OutboxEntry[] {
  const raw = localStorage.getItem(outboxKey(householdId));
  if (raw === null) return [];
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(v)) return [];
  return v.filter(
    (e): e is OutboxEntry =>
      typeof e === "object" && e !== null && typeof e.id === "string" && typeof e.isbn === "string",
  );
}

/**
 * Memory while storage lags behind it; otherwise storage (which also hydrates memory after a
 * reload, and picks up another tab's writes). Never throws.
 */
export function readOutbox(householdId: string): OutboxEntry[] {
  const mem = memory.get(householdId);
  if (mem && !mem.inSync) return [...mem.entries];
  try {
    const entries = readStorage(householdId);
    memory.set(householdId, { entries, inSync: true });
    return [...entries];
  } catch {
    return mem ? [...mem.entries] : [];
  }
}

function writeOutbox(householdId: string, entries: OutboxEntry[]): void {
  let inSync = false;
  try {
    const key = outboxKey(householdId);
    if (entries.length === 0) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(entries));
    inSync = true;
  } catch {
    // Not persisted: memory keeps the entries, so they are still sent and shown while the tab lives.
  }
  memory.set(householdId, { entries, inSync });
}

export function appendOutbox(entry: OutboxEntry): void {
  writeOutbox(entry.householdId, [...readOutbox(entry.householdId), entry]);
}

/** Re-reads the outbox, so an entry appended since the caller last read is never dropped. */
export function removeOutboxEntry(householdId: string, id: string): void {
  writeOutbox(
    householdId,
    readOutbox(householdId).filter((e) => e.id !== id),
  );
}

export function markOutboxRejected(householdId: string, id: string): void {
  writeOutbox(
    householdId,
    readOutbox(householdId).map((e) => (e.id === id ? { ...e, failed: "rejected" as const } : e)),
  );
}

const REJECTED_CODES = new Set(["42501", "22023", "23514", "22P02"]);

/**
 * D6: errors that won't fix themselves. 408, 429, 5xx and network errors are retried, and so are
 * 401 and PostgREST's PGRST30x JWT errors: an expired session heals once the token refreshes.
 */
export function isRejection(err: Pick<ScanSaveError, "code" | "status">): boolean {
  if (err.code !== null && err.code.startsWith("PGRST30")) return false;
  if (err.code !== null && REJECTED_CODES.has(err.code)) return true;
  const s = err.status;
  return s !== null && s >= 400 && s <= 499 && s !== 401 && s !== 408 && s !== 429;
}

export interface FlushDeps {
  create: typeof createScanItem;
  sleep(ms: number): Promise<void>;
  online(): boolean;
  onSaved(id: string): void;
  onRejected(id: string): void;
  signal?: AbortSignal;
}

const BACKOFF_MS = [2000, 8000, 30000];

interface Flight {
  promise: Promise<void>;
  /** Set by a call that joins this flight; the flight then makes another pass with `deps`. */
  again: boolean;
  /** The latest caller's deps; a joiner's replace the first caller's. */
  deps: FlushDeps;
}

/** One flush per household (D6); module state, so another tab has its own. */
const flights = new Map<string, Flight>();

function abortable(sleep: Promise<void>, signal: AbortSignal | undefined): Promise<void> {
  if (!signal) return sleep;
  return new Promise((resolve) => {
    const done = () => {
      signal.removeEventListener("abort", done);
      resolve();
    };
    signal.addEventListener("abort", done);
    void sleep.then(done, done);
  });
}

/** One pass: sends until nothing unsent is left, offline, or aborted. Reads `flight.deps` at each step. */
async function runPass(householdId: string, flight: Flight): Promise<void> {
  let failures = 0;
  for (;;) {
    const deps = flight.deps;
    if (deps.signal?.aborted || !deps.online()) return;
    const next = readOutbox(householdId).find((e) => !e.failed);
    if (!next) return;
    const args: ScanItemArgs = {
      id: next.id,
      householdId: next.householdId,
      batchId: next.batchId,
      ownerUserId: next.ownerUserId,
      isbn: next.isbn,
      editionLabel: next.editionLabel,
      extraCopy: next.extraCopy,
    };
    try {
      await deps.create(args);
      removeOutboxEntry(householdId, next.id);
      failures = 0;
      flight.deps.onSaved(next.id);
    } catch (err) {
      const e = err as Partial<ScanSaveError>;
      if (isRejection({ code: e.code ?? null, status: e.status ?? null })) {
        markOutboxRejected(householdId, next.id);
        failures = 0;
        flight.deps.onRejected(next.id);
        continue;
      }
      const delay = BACKOFF_MS[Math.min(failures, BACKOFF_MS.length - 1)];
      failures += 1;
      const now = flight.deps;
      if (now.signal?.aborted) continue;
      await abortable(now.sleep(delay), now.signal);
    }
  }
}

/**
 * Passes until one ends with no call having joined it (or the latest caller has aborted). The
 * flight leaves the map in the same synchronous step as that check, so no call can join a flight
 * that has already decided to stop.
 */
async function runFlight(householdId: string, flight: Flight): Promise<void> {
  try {
    for (;;) {
      flight.again = false;
      await runPass(householdId, flight);
      if (!flight.again || flight.deps.signal?.aborted) {
        flights.delete(householdId);
        return;
      }
    }
  } catch (err) {
    flights.delete(householdId);
    throw err;
  }
}

/**
 * Sends unsent entries one at a time until none is left. A call while a flush runs for this
 * household returns the running promise, makes its deps the flight's, and sets the run-again flag,
 * so the call is never lost even if the flight was about to stop. Creates never overlap.
 */
export function flushOutbox(householdId: string, deps: FlushDeps): Promise<void> {
  const running = flights.get(householdId);
  if (running) {
    running.deps = deps;
    running.again = true;
    return running.promise;
  }
  const flight: Flight = { promise: Promise.resolve(), again: false, deps };
  flights.set(householdId, flight);
  flight.promise = runFlight(householdId, flight);
  return flight.promise;
}

const isOpen = (i: IntakeItem) => i.status !== "confirmed" && i.status !== "discarded";

/**
 * D8 healing, pure. Per batch and scanned ISBN: open photos minus scans already replaced is how
 * many open not-found scans of that ISBN to discard, newest first. Returns their ids.
 */
export function scansToHeal(batchItems: IntakeItem[]): string[] {
  const groups = new Map<string, IntakeItem[]>();
  for (const i of batchItems) {
    if (!i.scannedIsbn) continue;
    const key = `${i.batchId}\u0000${i.scannedIsbn}`;
    const g = groups.get(key);
    if (g) g.push(i);
    else groups.set(key, [i]);
  }
  const heal: string[] = [];
  for (const items of groups.values()) {
    const photos = items.filter((i) => i.source === "photo" && i.status !== "discarded").length;
    const replaced = items.filter(
      (i) => i.source === "scan" && i.status === "discarded" && i.discardReason === "replaced_by_photo",
    ).length;
    const toHeal = photos - replaced;
    if (toHeal <= 0) continue;
    const notFound = items
      .filter((i) => i.source === "scan" && isOpen(i) && i.lookup?.source === "none")
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
    heal.push(...notFound.slice(0, toHeal).map((i) => i.id));
  }
  return heal;
}
