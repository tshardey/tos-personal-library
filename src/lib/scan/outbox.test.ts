import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ScanSaveError, type ScanItemArgs } from "../photo/intake-repo";
import type { IntakeItem, LookupResult } from "../photo/types";
import {
  appendOutbox,
  flushOutbox,
  isRejection,
  markOutboxRejected,
  outboxKey,
  readOutbox,
  removeOutboxEntry,
  scansToHeal,
  type OutboxEntry,
} from "./outbox";

const H = "h1";
let seq = 0;
const entry = (over: Partial<OutboxEntry> = {}): OutboxEntry => ({
  id: `scan-${++seq}`,
  householdId: H,
  batchId: "batch-1",
  ownerUserId: null,
  isbn: "9780000000002",
  editionLabel: null,
  extraCopy: false,
  createdAt: `2026-01-01T00:00:${String(seq).padStart(2, "0")}Z`,
  ...over,
});

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function deps(create: (a: ScanItemArgs) => Promise<"created" | "exists">, over: Partial<Parameters<typeof flushOutbox>[1]> = {}) {
  const sleeps: number[] = [];
  const saved: string[] = [];
  const rejected: string[] = [];
  const d = {
    create: vi.fn(create),
    sleep: vi.fn(async (ms: number) => {
      sleeps.push(ms);
    }),
    online: () => true,
    onSaved: (id: string) => saved.push(id),
    onRejected: (id: string) => rejected.push(id),
    ...over,
  };
  return { d, sleeps, saved, rejected };
}

beforeEach(() => localStorage.clear());
afterEach(() => vi.unstubAllGlobals());

describe("outbox storage", () => {
  it("keeps appended entries in order under a tpl_ key", () => {
    const es = [entry(), entry(), entry()];
    es.forEach(appendOutbox);
    expect(readOutbox(H)).toEqual(es);
    expect(outboxKey(H)).toBe("tpl_scan_outbox_h1");
    expect(Object.keys(localStorage)).toEqual(["tpl_scan_outbox_h1"]);
  });

  it("removes and marks by id from fresh storage", () => {
    const [a, b, c] = [entry(), entry(), entry()];
    [a, b, c].forEach(appendOutbox);
    removeOutboxEntry(H, b.id);
    markOutboxRejected(H, c.id);
    expect(readOutbox(H)).toEqual([a, { ...c, failed: "rejected" }]);
  });

  it("degrades to not remembered when storage throws", () => {
    const boom = () => {
      throw new Error("blocked");
    };
    vi.stubGlobal("localStorage", { getItem: boom, setItem: boom, removeItem: boom });
    expect(() => appendOutbox(entry())).not.toThrow();
    expect(readOutbox(H)).toEqual([]);
    expect(() => removeOutboxEntry(H, "x")).not.toThrow();
    expect(() => markOutboxRejected(H, "x")).not.toThrow();
  });

  it("reads malformed storage as empty", () => {
    localStorage.setItem(outboxKey(H), "not json");
    expect(readOutbox(H)).toEqual([]);
    localStorage.setItem(outboxKey(H), "{}");
    expect(readOutbox(H)).toEqual([]);
  });
});

describe("isRejection (D6)", () => {
  it("rejects permanent errors and retries transient ones", () => {
    for (const code of ["42501", "22023", "23514", "22P02"]) expect(isRejection(new ScanSaveError(code, 400))).toBe(true);
    expect(isRejection(new ScanSaveError(null, 404))).toBe(true);
    expect(isRejection(new ScanSaveError("PGRST202", 400))).toBe(true);
    expect(isRejection(new ScanSaveError(null, 408))).toBe(false);
    expect(isRejection(new ScanSaveError(null, 429))).toBe(false);
    expect(isRejection(new ScanSaveError(null, 503))).toBe(false);
    expect(isRejection(new ScanSaveError(null, null))).toBe(false);
  });
});

describe("flushOutbox (Review Focus 2)", () => {
  it("backs off 2 s then 8 s, then removes the entry on exists", async () => {
    const e = entry();
    appendOutbox(e);
    let calls = 0;
    const { d, sleeps, saved } = deps(async () => {
      calls += 1;
      if (calls <= 2) throw new ScanSaveError(null, null);
      return "exists";
    });
    await flushOutbox(H, d);
    expect(sleeps).toEqual([2000, 8000]);
    expect(saved).toEqual([e.id]);
    expect(readOutbox(H)).toEqual([]);
  });

  it("keeps backing off every 30 s", async () => {
    appendOutbox(entry());
    let calls = 0;
    const { d, sleeps } = deps(async () => {
      calls += 1;
      if (calls <= 5) throw new ScanSaveError(null, 503);
      return "created";
    });
    await flushOutbox(H, d);
    expect(sleeps).toEqual([2000, 8000, 30000, 30000, 30000]);
  });

  it("marks a 22023 rejected and still sends the next entry", async () => {
    const [a, b] = [entry(), entry()];
    [a, b].forEach(appendOutbox);
    const { d, saved, rejected } = deps(async (args) => {
      if (args.id === a.id) throw new ScanSaveError("22023", 400);
      return "created";
    });
    await flushOutbox(H, d);
    expect(rejected).toEqual([a.id]);
    expect(saved).toEqual([b.id]);
    expect(readOutbox(H)).toEqual([{ ...a, failed: "rejected" }]);
  });

  it("sends nothing while offline, and sends when called again online", async () => {
    const e = entry();
    appendOutbox(e);
    let online = false;
    const { d, saved } = deps(async () => "created", { online: () => online });
    await flushOutbox(H, d);
    expect(d.create).not.toHaveBeenCalled();
    expect(readOutbox(H)).toHaveLength(1);
    online = true;
    await flushOutbox(H, d);
    expect(saved).toEqual([e.id]);
  });

  it("stops backing off once offline", async () => {
    appendOutbox(entry());
    let online = true;
    const { d } = deps(
      async () => {
        online = false;
        throw new ScanSaveError(null, null);
      },
      { online: () => online },
    );
    await flushOutbox(H, d);
    expect(d.create).toHaveBeenCalledTimes(1);
    expect(readOutbox(H)).toHaveLength(1);
  });

  it("stops on abort", async () => {
    appendOutbox(entry());
    const ctl = new AbortController();
    const { d } = deps(async () => {
      ctl.abort();
      throw new ScanSaveError(null, 503);
    }, { signal: ctl.signal });
    await flushOutbox(H, d);
    expect(d.create).toHaveBeenCalledTimes(1);
    expect(readOutbox(H)).toHaveLength(1);
  });

  it("sends an entry appended mid-flush in the same flush, never two at once", async () => {
    const [a, b] = [entry(), entry()];
    appendOutbox(a);
    const gates = new Map([
      [a.id, deferred<"created">()],
      [b.id, deferred<"created">()],
    ]);
    let inFlight = 0;
    let maxInFlight = 0;
    const { d, saved } = deps(async (args) => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      try {
        return await gates.get(args.id)!.promise;
      } finally {
        inFlight -= 1;
      }
    });
    const p1 = flushOutbox(H, d);
    await Promise.resolve();
    appendOutbox(b);
    const p2 = flushOutbox(H, d);
    expect(p2).toBe(p1);
    expect(d.create).toHaveBeenCalledTimes(1);

    gates.get(a.id)!.resolve("created");
    await vi.waitFor(() => expect(d.create).toHaveBeenCalledTimes(2));
    // Entry 1 is removed by id; entry 2, appended after the flush began, is still stored.
    expect(saved).toEqual([a.id]);
    expect(readOutbox(H)).toEqual([b]);
    expect(d.create).toHaveBeenLastCalledWith(expect.objectContaining({ id: b.id }));

    gates.get(b.id)!.resolve("created");
    await p1;
    expect(saved).toEqual([a.id, b.id]);
    expect(readOutbox(H)).toEqual([]);
    expect(d.create).toHaveBeenCalledTimes(2);
    expect(maxInFlight).toBe(1);
  });

  it("keeps an entry appended while the first is removed", async () => {
    const [a, b] = [entry(), entry()];
    appendOutbox(a);
    const first = deferred<"created">();
    const seen: string[][] = [];
    const { d } = deps(async (args) => {
      if (args.id === a.id) return first.promise;
      seen.push(readOutbox(H).map((e) => e.id));
      return "created";
    });
    const p = flushOutbox(H, d);
    await Promise.resolve();
    appendOutbox(b);
    first.resolve("created");
    await p;
    expect(seen).toEqual([[b.id]]);
  });

  it("marks each rejection once and retries the transient ones", async () => {
    const rejecting = [new ScanSaveError("23514", 400), new ScanSaveError("22P02", 400), new ScanSaveError(null, 404)];
    for (const err of rejecting) {
      localStorage.clear();
      const e = entry();
      appendOutbox(e);
      const { d, rejected } = deps(async () => {
        throw err;
      });
      await flushOutbox(H, d);
      expect(d.create).toHaveBeenCalledTimes(1);
      expect(rejected).toEqual([e.id]);
      expect(readOutbox(H)[0].failed).toBe("rejected");
    }
    for (const err of [new ScanSaveError(null, 429), new ScanSaveError(null, 503), new ScanSaveError(null, null)]) {
      localStorage.clear();
      const e = entry();
      appendOutbox(e);
      let calls = 0;
      const { d, saved, rejected } = deps(async () => {
        calls += 1;
        if (calls === 1) throw err;
        return "created";
      });
      await flushOutbox(H, d);
      expect(d.create).toHaveBeenCalledTimes(2);
      expect(rejected).toEqual([]);
      expect(saved).toEqual([e.id]);
    }
  });
});

const notFound: LookupResult = {
  source: "none",
  agrees: false,
  title: null,
  authors: [],
  matchIsbns: [],
  coverUrl: null,
  synopsis: null,
  pageCount: null,
  publishDate: null,
  openlibraryId: null,
  googleBooksId: null,
  byIsbn: true,
};
const found: LookupResult = { ...notFound, source: "openlibrary", agrees: true, title: "Salt Road", byIsbn: true };

let itemSeq = 0;
const item = (over: Partial<IntakeItem> = {}): IntakeItem => ({
  id: `item-${++itemSeq}`,
  householdId: H,
  uploadedBy: "member-a",
  batchId: "batch-1",
  ownerUserId: null,
  coverPath: null,
  titlePagePath: null,
  sourceHash: null,
  source: "scan",
  scannedIsbn: "9780000000002",
  editionLabel: null,
  extraCopy: false,
  discardReason: null,
  status: "ready",
  attempts: 0,
  claimedAt: null,
  retryAt: null,
  extraction: null,
  lookup: notFound,
  errorCode: null,
  resultBookId: null,
  createdAt: `2026-01-01T00:00:${String(itemSeq).padStart(2, "0")}Z`,
  ...over,
});
const photo = (over: Partial<IntakeItem> = {}) =>
  item({ source: "photo", coverPath: "h1/x/cover.jpg", sourceHash: "hash", status: "pending", lookup: null, ...over });

describe("scansToHeal (D8)", () => {
  it("heals a not-found scan once its photo exists", () => {
    const s = item();
    expect(scansToHeal([s, photo()])).toEqual([s.id]);
  });

  it("does nothing when the scan is already replaced", () => {
    const s = item({ status: "discarded", discardReason: "replaced_by_photo" });
    expect(scansToHeal([s, photo()])).toEqual([]);
  });

  it("keeps a deliberate second copy that never got a photo", () => {
    const first = item();
    const second = item({ extraCopy: true });
    expect(scansToHeal([first, second, photo()])).toEqual([second.id]);
  });

  it("leaves a found scan alone", () => {
    expect(scansToHeal([item({ lookup: found }), photo()])).toEqual([]);
  });

  it("ignores a photo from another batch", () => {
    expect(scansToHeal([item(), photo({ batchId: "batch-2" })])).toEqual([]);
  });

  it("ignores a discarded photo", () => {
    expect(scansToHeal([item(), photo({ status: "discarded", discardReason: "discarded" })])).toEqual([]);
  });
});
