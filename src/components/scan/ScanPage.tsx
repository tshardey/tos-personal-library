import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useHousehold } from "@/contexts/HouseholdContext";
import EditionPicker from "@/components/edition/EditionPicker";
import { HEIC_TEXT } from "@/components/inbox/UploadPanel";
import { useIntake } from "@/hooks/useIntake";
import { discardItem } from "@/lib/photo/intake-repo";
import type { IntakeItem } from "@/lib/photo/types";
import { browserUploadDeps, runUploadBatch, type UploadEntry } from "@/lib/photo/upload-queue";
import { holdWakeLock } from "@/lib/photo/wake-lock";
import { navigate } from "@/lib/router";
import {
  CameraError,
  grabGuideFrame,
  startCamera as browserStartCamera,
  type CameraErrorCode,
  type CameraHandle,
} from "@/lib/scan/camera";
import { createFeedback as browserFeedback, loadSoundOn, saveSoundOn, type Feedback } from "@/lib/scan/feedback";
import { scansToHeal, type OutboxEntry } from "@/lib/scan/outbox";
import { ELSEWHERE_LINE, ownedInfo } from "@/lib/scan/owners";
import { createReadGate, idleDue, nudgeDue, REPEAT_WINDOW_MS } from "@/lib/scan/read-gate";
import { loadDecoder as browserLoadDecoder, runScanLoop } from "@/lib/scan/scan-loop";
import { clearSession, loadSession, saveSession, type ScanSession } from "@/lib/scan/session";
import type { HouseholdMember } from "@/lib/types";
import ScanList, { type ScanRowView } from "./ScanList";
import TypeIsbnSheet from "./TypeIsbnSheet";

export interface ScanDeps {
  startCamera(video: HTMLVideoElement): Promise<CameraHandle>;
  loadDecoder: typeof browserLoadDecoder;
  createFeedback(): Feedback;
  now(): number;
  newId(): string;
  /** Holds `tpl_intake_owner`. The outbox and session modules use `localStorage` itself. */
  storage: Storage;
}

/** A Map-backed Storage for when localStorage is blocked: nothing is remembered past the tab. */
function memoryStorage(): Storage {
  const m = new Map<string, string>();
  return {
    get length() {
      return m.size;
    },
    clear: () => m.clear(),
    getItem: (k) => m.get(k) ?? null,
    key: (i) => [...m.keys()][i] ?? null,
    removeItem: (k) => void m.delete(k),
    setItem: (k, v) => void m.set(k, String(v)),
  };
}

function browserStorage(): Storage {
  try {
    return window.localStorage;
  } catch {
    return memoryStorage();
  }
}

const browserDeps = (): ScanDeps => ({
  startCamera: (video) => browserStartCamera(video),
  loadDecoder: browserLoadDecoder,
  createFeedback: () => browserFeedback(),
  now: () => Date.now(),
  newId: () => crypto.randomUUID(),
  storage: browserStorage(),
});

const OWNER_KEY = "tpl_intake_owner";
const SHARED = "shared";
const TICK_MS = 250;
const FLASH_MS = 250;

const NOT_ISBN_TEXT = "That barcode isn't an ISBN.";
const NUDGE_TEXT = "Can't read a barcode? Take a photo instead.";
const PROMPT_TEXT = "You already scanned this book in this session. Add another copy?";
const OFFLINE_TEXT = "Saved on this phone. It will upload when you're back online.";

const CAMERA_TEXT: Record<CameraErrorCode | "decoder", string> = {
  denied: "Camera access is off. You can type an ISBN or take photos instead.",
  no_camera: "No camera found.",
  busy: "The camera is in use by another app.",
  unsupported: "This browser can't use the camera here.",
  unknown: "The camera couldn't start.",
  decoder: "The barcode reader couldn't load.",
};

const errName = (e: unknown) => (e instanceof Error ? e.name : "unknown");
const isOnline = () => typeof navigator === "undefined" || navigator.onLine !== false;
const isVisible = () => typeof document === "undefined" || document.visibilityState !== "hidden";

function loadOwner(storage: Storage, members: HouseholdMember[], fallback: string): string {
  try {
    const saved = storage.getItem(OWNER_KEY);
    if (saved === SHARED || members.some((m) => m.userId === saved)) return saved!;
  } catch {
    // Storage blocked: fall back to the scanner.
  }
  return fallback;
}

function saveOwner(storage: Storage, value: string) {
  try {
    storage.setItem(OWNER_KEY, value);
  } catch {
    // Not remembered; harmless.
  }
}

/** A photo taken from the scanner: until its item loads, the row follows the upload. */
interface PhotoUpload {
  key: string;
  file: File;
  /** The not-found scan this photo replaces (D8), with its ISBN. */
  from: { scanId: string; isbn: string } | null;
  session: ScanSession;
  entry: UploadEntry | null;
  createdAt: string;
}

function uploadText(entry: UploadEntry | null): { text: string; error: boolean } {
  switch (entry?.state ?? "queued") {
    case "done":
      return { text: "Photo · Reading the cover…", error: false };
    case "duplicate":
      return { text: "Already uploaded", error: false };
    case "failed":
      return { text: "Upload failed.", error: true };
    case "unreadable":
      if (entry?.errorCode === "too_small") return { text: "This photo is too small to read.", error: true };
      if (entry?.errorCode === "too_large") return { text: "This photo is too large to upload.", error: true };
      return { text: HEIC_TEXT, error: true };
    default:
      return { text: "Uploading photo…", error: false };
  }
}

function itemText(item: IntakeItem): { text: string; error: boolean } {
  if (item.status === "confirmed") return { text: "Added to the library.", error: false };
  if (item.status === "discarded") return { text: "Discarded.", error: false };
  if (item.source === "photo") {
    if (item.status === "failed") return { text: "Couldn't read this photo.", error: true };
    const title = item.extraction?.title?.trim();
    if (item.status === "pending" || item.status === "processing" || !item.extraction) {
      return { text: "Photo · Reading the cover…", error: false };
    }
    return { text: title || "Photo · No title read", error: false };
  }
  if (item.lookup === null) return { text: "Looking up…", error: false };
  if (item.lookup.source === "none") return { text: "Not found online.", error: false };
  const title = item.lookup.title?.trim() || "Untitled";
  const authors = item.lookup.authors.join(", ");
  return { text: authors ? `${title} · ${authors}` : title, error: false };
}

const OPEN = new Set(["pending", "processing", "ready", "failed"]);

export default function ScanPage({ deps }: { deps?: Partial<ScanDeps> }) {
  const [d] = useState<ScanDeps>(() => ({ ...browserDeps(), ...deps }));
  const { household, members } = useHousehold();
  const { user } = useAuth();
  const intake = useIntake();
  const householdId = household?.id ?? null;

  const [session, setSession] = useState<ScanSession | null>(() => (householdId ? loadSession(householdId) : null));
  const [owner, setOwner] = useState<string>(() =>
    session ? (session.ownerUserId ?? SHARED) : loadOwner(d.storage, members, user?.id ?? SHARED),
  );
  const [edition, setEdition] = useState<string | null>(() => session?.edition ?? null);
  const [running, setRunning] = useState(false);
  const [visible, setVisible] = useState(isVisible);
  const [online, setOnline] = useState(isOnline);
  const [idle, setIdle] = useState(false);
  const [prompt, setPrompt] = useState<string | null>(null);
  const [photoOpen, setPhotoOpen] = useState(false);
  const [cameraError, setCameraError] = useState<CameraErrorCode | "decoder" | null>(null);
  const [torchSupported, setTorchSupported] = useState(false);
  const [torchOn, setTorchOn] = useState(false);
  const [soundOn, setSoundOn] = useState(loadSoundOn);
  const [nudge, setNudge] = useState(false);
  const [notIsbn, setNotIsbn] = useState(false);
  const [flash, setFlash] = useState<"accept" | "notice" | null>(null);
  const [typing, setTyping] = useState(false);
  const [uploads, setUploads] = useState<PhotoUpload[]>([]);

  const [feedback] = useState<Feedback>(() => d.createFeedback());
  const [gate] = useState(() => createReadGate());
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const photoInputRef = useRef<HTMLInputElement | null>(null);
  const handleRef = useRef<CameraHandle | null>(null);
  const stopCameraRef = useRef<() => void>(() => {});
  const cameraLive = useRef(false);
  /** D4: the latest of camera start, the last accepted read and the last nudge dismissal. */
  const since = useRef(0);
  const lastActivity = useRef(0);
  const lastNotIsbn = useRef<number | null>(null);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const photoFor = useRef<PhotoUpload["from"]>(null);
  const healed = useRef<string | null>(null);

  const { items, catalog, upsertLocal, queueScan, processNew } = intake;
  const itemsRef = useRef(items);
  itemsRef.current = items;

  useEffect(() => {
    feedback.setMuted(!soundOn);
  }, [feedback, soundOn]);

  const updateSession = useCallback((patch: Partial<ScanSession>) => {
    setSession((s) => {
      if (!s) return s;
      const next = { ...s, ...patch };
      saveSession(next);
      return next;
    });
  }, []);

  const showFlash = useCallback((kind: "accept" | "notice") => {
    if (flashTimer.current !== null) clearTimeout(flashTimer.current);
    setFlash(kind);
    flashTimer.current = setTimeout(() => {
      flashTimer.current = null;
      setFlash(null);
    }, FLASH_MS);
  }, []);
  useEffect(
    () => () => {
      if (flashTimer.current !== null) clearTimeout(flashTimer.current);
    },
    [],
  );

  // ---------------------------------------------------------------- the session list

  const batchId = session?.batchId ?? null;
  const openItems = useMemo(() => items.filter((i) => OPEN.has(i.status)), [items]);
  const batchItems = useMemo(
    () => (batchId === null ? [] : items.filter((i) => i.batchId === batchId)),
    [items, batchId],
  );
  const batchOutbox = useMemo(
    () => (batchId === null ? [] : intake.scanOutbox.filter((e) => e.batchId === batchId)),
    [intake.scanOutbox, batchId],
  );

  /** Every ISBN already in this session, for the read gate's second-copy question. */
  const sessionIsbns = useMemo(() => {
    const set = new Set<string>();
    for (const i of batchItems) if (i.scannedIsbn) set.add(i.scannedIsbn);
    for (const e of batchOutbox) set.add(e.isbn);
    return set;
  }, [batchItems, batchOutbox]);

  const ownedLines = useCallback(
    (isbn: string | null): string[] => {
      if (!isbn || batchId === null) return [];
      const info = ownedInfo(isbn, catalog, members, openItems, batchId);
      return [...(info.line ? [info.line] : []), ...(info.elsewhere ? [ELSEWHERE_LINE] : [])];
    },
    [catalog, members, openItems, batchId],
  );

  // ---------------------------------------------------------------- accepting scans

  const accept = useCallback(
    (isbn13: string, extraCopy: boolean) => {
      if (!householdId || !session) return;
      const now = d.now();
      const entry: OutboxEntry = {
        id: d.newId(),
        householdId,
        batchId: session.batchId,
        ownerUserId: session.ownerUserId,
        isbn: isbn13,
        editionLabel: session.edition,
        extraCopy,
        createdAt: new Date(now).toISOString(),
      };
      queueScan(entry);
      const info = ownedInfo(isbn13, catalog, members, openItems, session.batchId);
      if (info.line !== null || info.elsewhere) {
        feedback.notice();
        showFlash("notice");
      } else {
        feedback.accept();
        showFlash("accept");
      }
      since.current = now;
      lastActivity.current = now;
      setNudge(false);
      setNotIsbn(false);
    },
    [householdId, session, d, queueScan, catalog, members, openItems, feedback, showFlash],
  );

  const askAnother = useCallback(
    (isbn13: string) => {
      setPrompt(isbn13);
      feedback.notice();
      showFlash("notice");
    },
    [feedback, showFlash],
  );

  const answerPrompt = (yes: boolean) => {
    const isbn13 = prompt;
    setPrompt(null);
    if (isbn13 === null) return;
    if (yes) accept(isbn13, true);
    const now = d.now();
    // The book is likely still in view when the camera restarts: count this as a fresh sighting
    // so the sliding window (D4) keeps it from asking again until it has been out of view.
    gate.onBarcode(isbn13, now, sessionIsbns);
    since.current = now;
    lastActivity.current = now;
  };

  const onText = (text: string) => {
    if (prompt !== null) return;
    const now = d.now();
    const verdict = gate.onBarcode(text, now, sessionIsbns);
    if (verdict.kind === "ignored") return;
    if (verdict.kind === "not_isbn") {
      // Not windowed by the gate: a UPC in view reads on every decode. Cue once per sighting.
      const prev = lastNotIsbn.current;
      lastNotIsbn.current = now;
      if (prev !== null && now - prev < REPEAT_WINDOW_MS) return;
      setNotIsbn(true);
      setNudge(true);
      feedback.notice();
      showFlash("notice");
      return;
    }
    if (verdict.kind === "add") accept(verdict.isbn13, false);
    else askAnother(verdict.isbn13);
  };
  const onTextRef = useRef(onText);
  onTextRef.current = onText;

  const onTyped = (isbn13: string) => {
    setTyping(false);
    const verdict = gate.onTyped(isbn13, sessionIsbns);
    if (verdict.kind === "add") accept(verdict.isbn13, false);
    else if (verdict.kind === "ask_another_copy") askAnother(verdict.isbn13);
  };

  // ---------------------------------------------------------------- camera lifecycle (D11)

  const cameraWanted = running && visible && !idle && prompt === null && !photoOpen && cameraError === null;

  useEffect(() => {
    if (!cameraWanted) return;
    const video = videoRef.current;
    if (!video) return;
    canvasRef.current ??= document.createElement("canvas");
    const canvas = canvasRef.current;
    const ctl = new AbortController();
    const lock = holdWakeLock();
    let stopped = false;
    const stop = () => {
      if (stopped) return;
      stopped = true;
      ctl.abort();
      handleRef.current?.stop();
      handleRef.current = null;
      cameraLive.current = false;
      lock.release();
      setTorchOn(false);
      setTorchSupported(false);
    };
    stopCameraRef.current = stop;
    void (async () => {
      let phase: "camera" | "decoder" = "camera";
      try {
        const handle = await d.startCamera(video);
        if (stopped) {
          handle.stop();
          return;
        }
        handleRef.current = handle;
        setTorchSupported(handle.torchSupported);
        cameraLive.current = true;
        since.current = Math.max(since.current, d.now());
        phase = "decoder";
        const decoder = await d.loadDecoder();
        if (stopped) return;
        await runScanLoop({
          grab: () => grabGuideFrame(video, canvas),
          decoder,
          onText: (t) => onTextRef.current(t),
          signal: ctl.signal,
        });
      } catch (e) {
        if (stopped) return;
        if (e instanceof CameraError) {
          console.error("Camera failed", e.code);
          setCameraError(e.code);
        } else {
          console.error(phase === "camera" ? "Camera failed" : "Barcode reader failed", errName(e));
          setCameraError(phase === "camera" ? "unknown" : "decoder");
        }
        stop();
      }
    })();
    return stop;
  }, [cameraWanted, d]);

  /** Stops at once, inside the tap (iOS can't share the camera with the capture sheet). */
  const stopCamera = () => stopCameraRef.current();

  useEffect(() => {
    const onVisibility = () => {
      const v = isVisible();
      if (v) lastActivity.current = d.now();
      setVisible(v);
    };
    const onOnline = () => setOnline(true);
    const onOffline = () => setOnline(false);
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, [d]);

  // D4: the nudge, the idle pause, and the not-an-ISBN message's end, on one tick.
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => {
      const now = d.now();
      if (cameraLive.current && nudgeDue(now, since.current)) setNudge(true);
      if (cameraLive.current && idleDue(now, lastActivity.current)) setIdle(true);
      if (lastNotIsbn.current !== null && now - lastNotIsbn.current >= REPEAT_WINDOW_MS) {
        lastNotIsbn.current = null;
        setNotIsbn(false);
      }
    }, TICK_MS);
    return () => clearInterval(timer);
  }, [running, d]);

  // D10: leaving with unsent scans while online would lose nothing, but they'd wait for a reopen.
  const unsent = intake.scanOutbox.some((e) => !e.failed);
  useEffect(() => {
    if (!unsent || !online) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [unsent, online]);

  // D8: heal on every session load; a failed discard is logged and tried again next load.
  useEffect(() => {
    if (!session || intake.status !== "ready" || healed.current === session.batchId) return;
    healed.current = session.batchId;
    const ids = scansToHeal(itemsRef.current.filter((i) => i.batchId === session.batchId));
    for (const id of ids) {
      discardItem(id, "replaced_by_photo")
        .then(() => {
          const scan = itemsRef.current.find((i) => i.id === id);
          if (scan) upsertLocal({ ...scan, status: "discarded", discardReason: "replaced_by_photo" });
        })
        .catch((e) => console.error("Couldn't close a replaced scan", errName(e)));
    }
  }, [session, intake.status, upsertLocal]);

  // ---------------------------------------------------------------- photos (D8)

  const patchUpload = useCallback((key: string, patch: Partial<PhotoUpload>) => {
    setUploads((prev) => prev.map((u) => (u.key === key ? { ...u, ...patch } : u)));
  }, []);

  const runUpload = useCallback(
    async (up: PhotoUpload) => {
      patchUpload(up.key, { entry: null });
      const s = up.session;
      let entries: UploadEntry[];
      try {
        entries = await runUploadBatch(
          [up.file],
          {
            householdId: s.householdId,
            ownerUserId: s.ownerUserId,
            batchId: s.batchId,
            editionLabel: s.edition,
            scannedIsbn: up.from?.isbn ?? null,
            onChange: (es) => {
              if (es[0]) patchUpload(up.key, { entry: es[0] });
            },
          },
          { ...browserUploadDeps, onItemCreated: processNew },
        );
      } catch (e) {
        console.error("Photo upload stopped", errName(e));
        patchUpload(up.key, { entry: { key: "f0", fileName: "", state: "failed", itemId: null } });
        return;
      }
      if (entries[0]?.state !== "done" || !up.from) return;
      const scanId = up.from.scanId;
      try {
        await discardItem(scanId, "replaced_by_photo");
        const scan = itemsRef.current.find((i) => i.id === scanId);
        if (scan) upsertLocal({ ...scan, status: "discarded", discardReason: "replaced_by_photo" });
      } catch (e) {
        // The next session load heals it (scansToHeal).
        console.error("Couldn't close the replaced scan", errName(e));
      }
    },
    [patchUpload, processNew, upsertLocal],
  );

  const takePhoto = (from: PhotoUpload["from"]) => {
    photoFor.current = from;
    stopCamera();
    setPhotoOpen(true);
    photoInputRef.current?.click();
  };

  const onPhotoPicked = (file: File | undefined) => {
    setPhotoOpen(false);
    lastActivity.current = d.now();
    if (!file || !session) return;
    const up: PhotoUpload = {
      key: `photo-${d.newId()}`,
      file,
      from: photoFor.current,
      session,
      entry: null,
      createdAt: new Date(d.now()).toISOString(),
    };
    photoFor.current = null;
    setUploads((prev) => [...prev, up]);
    void runUpload(up);
  };

  /** The input moves between the two screens, so its `cancel` listener follows it (React 19 ref cleanup). */
  const photoInputCallback = useCallback((input: HTMLInputElement | null) => {
    photoInputRef.current = input;
    if (!input) return;
    const onCancel = () => {
      photoFor.current = null;
      setPhotoOpen(false);
    };
    input.addEventListener("cancel", onCancel);
    return () => {
      input.removeEventListener("cancel", onCancel);
      if (photoInputRef.current === input) photoInputRef.current = null;
    };
  }, []);

  // ---------------------------------------------------------------- rows

  const rows = useMemo((): ScanRowView[] => {
    const out: { at: string; row: ScanRowView }[] = [];
    const known = new Set(batchItems.map((i) => i.id));
    for (const i of batchItems) {
      if (i.discardReason === "replaced_by_photo") continue;
      const isbn = i.scannedIsbn;
      const { text, error } = itemText(i);
      out.push({
        at: i.createdAt,
        row: {
          key: i.id,
          isbn,
          thumbUrl: i.lookup?.coverUrl ?? (i.coverPath ? (intake.thumbs.get(i.coverPath) ?? null) : null),
          status: text,
          error,
          ownedLines: ownedLines(isbn),
          notFound: i.source === "scan" && OPEN.has(i.status) && i.lookup?.source === "none",
        },
      });
    }
    const offline = !online || intake.scanSaveFailing;
    for (const e of batchOutbox) {
      if (known.has(e.id)) continue;
      out.push({
        at: e.createdAt,
        row: {
          key: e.id,
          isbn: e.isbn,
          thumbUrl: null,
          status: e.failed ? "Couldn't save this scan." : offline ? OFFLINE_TEXT : "Saving…",
          error: e.failed === "rejected",
          ownedLines: ownedLines(e.isbn),
          notFound: false,
        },
      });
    }
    for (const u of uploads) {
      if (u.session.batchId !== batchId) continue;
      if (u.entry?.itemId && known.has(u.entry.itemId)) continue;
      const { text, error } = uploadText(u.entry);
      out.push({
        at: u.createdAt,
        row: {
          key: u.key,
          isbn: u.from?.isbn ?? null,
          thumbUrl: null,
          status: text,
          error,
          ownedLines: [],
          notFound: false,
          ...(u.entry?.state === "failed" ? { onRetry: () => void runUpload(u) } : {}),
        },
      });
    }
    out.sort((a, b) => b.at.localeCompare(a.at) || b.row.key.localeCompare(a.row.key));
    return out.map((o) => o.row);
  }, [batchItems, batchOutbox, uploads, batchId, online, intake.scanSaveFailing, intake.thumbs, ownedLines, runUpload]);

  // ---------------------------------------------------------------- actions

  const start = () => {
    feedback.unlock();
    if (!householdId) return;
    const now = d.now();
    if (!session) {
      const s: ScanSession = {
        householdId,
        batchId: d.newId(),
        edition,
        ownerUserId: owner === SHARED ? null : owner,
        startedAt: new Date(now).toISOString(),
      };
      saveSession(s);
      setSession(s);
      healed.current = s.batchId;
    }
    since.current = now;
    lastActivity.current = now;
    setCameraError(null);
    setIdle(false);
    setRunning(true);
  };

  const resume = () => {
    feedback.unlock();
    lastActivity.current = d.now();
    setCameraError(null);
    setIdle(false);
  };

  const done = () => {
    stopCamera();
    setRunning(false);
    clearSession();
    navigate({ name: "inbox" });
  };

  const newSession = () => {
    clearSession();
    setSession(null);
    setUploads([]);
    healed.current = null;
  };

  const changeOwner = (value: string) => {
    setOwner(value);
    saveOwner(d.storage, value);
    updateSession({ ownerUserId: value === SHARED ? null : value });
  };

  const changeEdition = (label: string | null) => {
    setEdition(label);
    updateSession({ edition: label });
  };

  const toggleTorch = () => {
    const handle = handleRef.current;
    if (!handle) return;
    const next = !torchOn;
    setTorchOn(next);
    handle.setTorch(next).catch((e) => {
      console.error("Torch failed", errName(e));
      setTorchOn(!next);
    });
  };

  const toggleSound = () => {
    feedback.unlock();
    const next = !soundOn;
    setSoundOn(next);
    saveSoundOn(next);
  };

  if (!household || !user) return null;

  const photoInput = (
    <input
      ref={photoInputCallback}
      type="file"
      accept="image/*"
      capture="environment"
      aria-label="Book photo"
      className="sr-only"
      tabIndex={-1}
      onChange={(e) => {
        const file = e.target.files?.[0];
        e.target.value = "";
        onPhotoPicked(file);
      }}
    />
  );

  // D6: a rate limit or a dropped network pauses lookups; rows would otherwise sit at "Looking up…".
  const lookupPausedBanner = intake.lookupPaused && (
    <div className="mb-3 flex items-center gap-2 rounded border p-2 text-sm">
      <span>Online lookup paused. It will retry.</span>
      <button type="button" onClick={intake.resumeLookups} className="rounded border px-2 py-1">
        Retry
      </button>
    </div>
  );

  const list = (
    <ScanList
      rows={rows}
      onPhoto={(r) => r.isbn && takePhoto({ scanId: r.key, isbn: r.isbn })}
      onAnother={(isbn) => accept(isbn, true)}
    />
  );

  if (!running) {
    return (
      <div className="mx-auto max-w-2xl p-4">
        <h2 className="mb-3 text-lg font-semibold">Scan barcodes</h2>
        {session && (
          <div className="mb-3 flex items-center justify-between gap-2 text-sm">
            <span>{`Started ${new Date(session.startedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`}</span>
            <button type="button" onClick={newSession} className="rounded border px-3 py-1">
              New session
            </button>
          </div>
        )}
        <label htmlFor="scan-owner" className="mb-1 block text-sm">
          Owner
        </label>
        <select
          id="scan-owner"
          value={owner}
          onChange={(e) => changeOwner(e.target.value)}
          className="mb-3 block w-full rounded border px-2 py-2"
        >
          {members.map((m) => (
            <option key={m.userId} value={m.userId}>
              {m.displayName}
            </option>
          ))}
          <option value={SHARED}>Shared</option>
        </select>
        <div className="mb-3">
          <EditionPicker
            value={edition}
            labels={intake.labels}
            label="Edition for this session"
            onChange={changeEdition}
          />
        </div>
        <button
          type="button"
          onClick={start}
          className="mb-4 block w-full rounded bg-stone-800 px-4 py-4 text-lg font-semibold text-white"
        >
          Start scanning
        </button>
        {photoInput}
        {lookupPausedBanner}
        {list}
      </div>
    );
  }

  const flashBorder =
    flash === "accept" ? "border-green-500" : flash === "notice" ? "border-amber-400" : "border-transparent";

  return (
    <div
      className="fixed inset-0 z-10 flex flex-col overflow-y-auto bg-white"
      onPointerDown={() => {
        feedback.unlock();
        lastActivity.current = d.now();
      }}
    >
      <div className="flex flex-wrap items-center gap-2 border-b p-2">
        <button type="button" onClick={done} className="rounded bg-stone-800 px-3 py-2 text-white">
          Done
        </button>
        <div className="min-w-0 flex-1">
          <EditionPicker value={edition} labels={intake.labels} label="Edition" onChange={changeEdition} />
        </div>
        <button type="button" aria-pressed={soundOn} onClick={toggleSound} className="rounded border px-3 py-2 text-sm">
          {soundOn ? "Sound on" : "Sound off"}
        </button>
        {torchSupported && cameraError === null && (
          <button
            type="button"
            aria-pressed={torchOn}
            onClick={toggleTorch}
            className="rounded border px-3 py-2 text-sm"
          >
            Torch
          </button>
        )}
      </div>

      <div className={`relative mx-auto aspect-[4/3] max-h-[50vh] w-full max-w-2xl bg-black border-4 ${flashBorder}`}>
        <video ref={videoRef} playsInline muted autoPlay className="h-full w-full object-cover" />
        {cameraError === null && !idle && (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute top-[32.5%] left-[5%] h-[35%] w-[90%] rounded border-2 border-white/80"
          />
        )}
        {idle && cameraError === null && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/80 p-4 text-center text-white">
            <p>Camera paused to save battery.</p>
            <button type="button" onClick={resume} className="rounded bg-white px-3 py-2 text-stone-900">
              Resume camera
            </button>
          </div>
        )}
        {cameraError !== null && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-stone-900 p-4 text-center text-white">
            <p>{CAMERA_TEXT[cameraError]}</p>
            {cameraError === "denied" && (
              <p className="text-sm text-stone-300">On iPhone: Settings → Safari → Camera.</p>
            )}
            <button type="button" onClick={resume} className="rounded bg-white px-3 py-2 text-stone-900">
              Resume camera
            </button>
          </div>
        )}
      </div>

      <div className="mx-auto w-full max-w-2xl p-3">
        {notIsbn && <p className="mb-2 text-sm text-amber-800">{NOT_ISBN_TEXT}</p>}
        {nudge && (
          <div
            role="status"
            className="mb-2 flex flex-wrap items-center gap-2 rounded border border-amber-400 bg-amber-50 p-2 text-sm"
          >
            <span className="flex-1">{NUDGE_TEXT}</span>
            <button type="button" onClick={() => takePhoto(null)} className="rounded border px-2 py-1">
              Take a photo
            </button>
            <button
              type="button"
              onClick={() => {
                since.current = d.now();
                setNudge(false);
              }}
              className="rounded border px-2 py-1"
            >
              Dismiss
            </button>
          </div>
        )}
        <div className="mb-3 grid grid-cols-2 gap-2">
          <button type="button" onClick={() => takePhoto(null)} className="rounded border px-3 py-3">
            Take a photo
          </button>
          <button type="button" onClick={() => setTyping(true)} className="rounded border px-3 py-3">
            Type ISBN
          </button>
        </div>
        {photoInput}
        {lookupPausedBanner}
        {list}
      </div>

      {prompt !== null && (
        <div className="fixed inset-0 z-30 flex items-end justify-center bg-black/40 sm:items-center">
          <div
            role="alertdialog"
            aria-modal="true"
            aria-label="Another copy?"
            className="w-full max-w-lg rounded-t bg-white p-4 sm:rounded"
          >
            <p className="mb-3">{PROMPT_TEXT}</p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => answerPrompt(true)}
                className="rounded bg-stone-800 px-3 py-2 text-white"
              >
                Add another copy
              </button>
              <button type="button" onClick={() => answerPrompt(false)} className="rounded border px-3 py-2">
                No
              </button>
            </div>
          </div>
        </div>
      )}
      {typing && <TypeIsbnSheet onAdd={onTyped} onClose={() => setTyping(false)} />}
    </div>
  );
}
