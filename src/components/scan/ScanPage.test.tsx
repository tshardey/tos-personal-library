import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import type { BookWithCopies } from "@/lib/types";
import type { IntakeItem, LookupResult } from "@/lib/photo/types";
import type { CameraErrorCode, CameraHandle } from "@/lib/scan/camera";
import type { Feedback } from "@/lib/scan/feedback";

const h = vi.hoisted(() => ({ items: [] as IntakeItem[], books: [] as unknown[] }));

const repo = vi.hoisted(() => ({
  listIntakeItems: vi.fn(),
  processItem: vi.fn(),
  saveLookup: vi.fn(),
  setItemOwner: vi.fn(),
  retryItem: vi.fn(),
  discardItem: vi.fn(),
  confirmItem: vi.fn(),
  signedPhotoUrls: vi.fn(),
  purgeIntakePhotos: vi.fn(),
  setItemEdition: vi.fn(),
  createScanItem: vi.fn(),
  createIntakeItem: vi.fn(),
  sourceHashExists: vi.fn(),
  uploadPhoto: vi.fn(),
}));
const lib = vi.hoisted(() => ({ listBooks: vi.fn(), patchBook: vi.fn() }));
const look = vi.hoisted(() => ({ lookupForItem: vi.fn() }));
const up = vi.hoisted(() => ({ runUploadBatch: vi.fn() }));
const wake = vi.hoisted(() => ({ holdWakeLock: vi.fn(), releases: [] as ReturnType<typeof vi.fn>[] }));

vi.mock("@/lib/photo/intake-repo", () => ({
  ...repo,
  coverPath: (hh: string, id: string) => `${hh}/${id}/cover.jpg`,
  titlePagePath: (hh: string, id: string) => `${hh}/${id}/title.jpg`,
}));
vi.mock("@/lib/library-repo", () => ({ listBooks: lib.listBooks, libibStore: { patchBook: lib.patchBook } }));
vi.mock("@/lib/libib/enrich", () => ({ enrichMissing: vi.fn() }));
vi.mock("@/lib/photo/lookup", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/photo/lookup")>()),
  lookupForItem: look.lookupForItem,
}));
vi.mock("@/lib/photo/upload-queue", () => ({
  runUploadBatch: up.runUploadBatch,
  browserUploadDeps: { marker: "browser" },
}));
vi.mock("@/lib/photo/wake-lock", () => ({ holdWakeLock: wake.holdWakeLock }));

const household = { id: "h1", name: "Home", inviteCode: "x", createdAt: "" };
const members = [
  { householdId: "h1", userId: "u1", displayName: "Avery", createdAt: "" },
  { householdId: "h1", userId: "u2", displayName: "Blake", createdAt: "" },
];
vi.mock("@/contexts/HouseholdContext", () => ({
  useHousehold: () => ({ household, members, loading: false, error: null, refresh: vi.fn() }),
}));
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: { id: "u1", email: "avery@example.test" }, loading: false }),
}));

import { CameraError } from "@/lib/scan/camera";
import { DECODE_GAP_MS } from "@/lib/scan/read-gate";
import ScanPage, { type ScanDeps } from "./ScanPage";

const A = "9780000000002";
const B = "9780000000019";
const C = "9780000000026";
const UPC = "0012345678905";
const PROMPT = "You already scanned this book in this session. Add another copy?";
const NUDGE = "Can't read a barcode? Take a photo instead.";
const OFFLINE = "Saved on this phone. It will upload when you're back online.";

const NOT_FOUND: LookupResult = {
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

const scanItem = (over: Partial<IntakeItem> = {}): IntakeItem => ({
  id: "scan-x",
  householdId: "h1",
  uploadedBy: "u1",
  batchId: "batch-s",
  ownerUserId: "u1",
  coverPath: null,
  titlePagePath: null,
  sourceHash: null,
  source: "scan",
  scannedIsbn: A,
  editionLabel: null,
  extraCopy: false,
  discardReason: null,
  status: "ready",
  attempts: 0,
  claimedAt: null,
  retryAt: null,
  extraction: null,
  lookup: null,
  errorCode: null,
  resultBookId: null,
  createdAt: "2026-11-10T09:00:00.000Z",
  ...over,
});
const photoItem = (over: Partial<IntakeItem> = {}): IntakeItem =>
  scanItem({
    id: "photo-x",
    source: "photo",
    coverPath: "h1/photo-x/cover.jpg",
    sourceHash: "a".repeat(64),
    extraction: {
      isBook: true,
      title: "Invented Title",
      subtitle: null,
      authors: ["Ana Vale"],
      editionClues: [],
      publisher: null,
      isbn: null,
      confidence: "high",
    },
    lookup: { ...NOT_FOUND, byIsbn: false },
    createdAt: "2026-11-10T09:05:00.000Z",
    ...over,
  });

const book = (over: Partial<BookWithCopies> = {}): BookWithCopies => ({
  id: "b1",
  householdId: "h1",
  title: "Invented Book",
  authors: ["Ana Vale"],
  synopsis: null,
  coverUrl: null,
  isbn13: [],
  isbn10: [],
  openlibraryId: null,
  googleBooksId: null,
  pageCount: null,
  publisher: null,
  publishDate: null,
  userEditedFields: [],
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
  copies: [
    {
      id: "c1",
      bookId: "b1",
      ownerUserId: "u2",
      editionNote: "Invented Box",
      copyNote: null,
      location: null,
      origin: "manual",
      libibId: null,
      photoPath: null,
      intakeItemId: null,
      userEditedFields: [],
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
    },
  ],
  ...over,
});

const networkError = () => Object.assign(new Error("offline"), { name: "ScanSaveError", code: null, status: null });

/* ------------------------------------------------------------------ fakes */

let queue: string[];
let decoder: { decode: Mock<(frame: ImageData) => Promise<string[]>> };
let fb: { [K in keyof Feedback]: Mock<Feedback[K]> };
let cam: {
  fail: CameraErrorCode | null;
  torch: boolean;
  handles: (CameraHandle & { stop: ReturnType<typeof vi.fn>; setTorch: ReturnType<typeof vi.fn> })[];
};
let ids: number;
let deps: Partial<ScanDeps>;

function makeDeps(): Partial<ScanDeps> {
  return {
    startCamera: vi.fn(async (video: HTMLVideoElement) => {
      if (cam.fail) throw new CameraError(cam.fail);
      Object.defineProperty(video, "videoWidth", { configurable: true, value: 1280 });
      Object.defineProperty(video, "videoHeight", { configurable: true, value: 720 });
      const handle = { torchSupported: cam.torch, setTorch: vi.fn(async () => {}), stop: vi.fn() };
      cam.handles.push(handle);
      return handle;
    }),
    loadDecoder: vi.fn(async () => decoder),
    createFeedback: () => fb,
    now: () => Date.now(),
    newId: () => `id-${++ids}`,
    storage: localStorage,
  };
}

const flush = () =>
  act(async () => {
    for (let i = 0; i < 10; i++) await Promise.resolve();
  });
const advance = async (ms: number) => {
  await act(() => vi.advanceTimersByTimeAsync(ms));
  await flush();
};

/** Each text is the result of one decode; a decode runs every DECODE_GAP_MS. */
async function feed(text: string, times = 1) {
  for (let i = 0; i < times; i++) {
    queue.push(text);
    await advance(DECODE_GAP_MS);
  }
}

const session = () => JSON.parse(localStorage.getItem("tpl_scan_session") ?? "null") as { batchId: string } | null;
const rows = () => within(screen.getByRole("list", { name: "Scanned books" })).queryAllByRole("listitem");
const rowFor = (isbn: string) => {
  const r = rows().find((li) => within(li).queryByText(isbn) !== null);
  if (!r) throw new Error(`no row for ${isbn}`);
  return r;
};

async function pickEdition(name: string, label = "Edition for this session") {
  fireEvent.click(await screen.findByRole("button", { name: new RegExp(`^${label}:`) }));
  fireEvent.click(within(screen.getByRole("dialog", { name: label })).getByRole("button", { name }));
}

async function renderPage() {
  const view = render(<ScanPage deps={deps} />);
  await flush();
  return view;
}

async function startScanning() {
  const view = await renderPage();
  fireEvent.click(await screen.findByRole("button", { name: "Start scanning" }));
  await advance(0);
  return view;
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true, now: new Date("2026-11-10T10:00:00Z") });
  localStorage.clear();
  window.location.hash = "#/scan";
  h.items = [];
  h.books = [];
  queue = [];
  ids = 0;
  decoder = {
    decode: vi.fn(async () => {
      const t = queue.shift();
      return t === undefined ? [] : [t];
    }),
  };
  fb = { unlock: vi.fn(), accept: vi.fn(), notice: vi.fn(), setMuted: vi.fn() };
  cam = { fail: null, torch: false, handles: [] };
  for (const fn of [...Object.values(repo), ...Object.values(lib), look.lookupForItem, up.runUploadBatch])
    fn.mockReset();
  wake.releases = [];
  wake.holdWakeLock.mockReset();
  wake.holdWakeLock.mockImplementation(() => {
    const release = vi.fn();
    wake.releases.push(release);
    return { release };
  });
  repo.listIntakeItems.mockImplementation(async () => h.items.map((i) => ({ ...i })));
  lib.listBooks.mockImplementation(async () => h.books);
  repo.processItem.mockResolvedValue("ready");
  repo.signedPhotoUrls.mockResolvedValue(new Map());
  repo.purgeIntakePhotos.mockResolvedValue(0);
  repo.saveLookup.mockResolvedValue(undefined);
  repo.setItemEdition.mockResolvedValue(undefined);
  repo.discardItem.mockResolvedValue(true);
  repo.createScanItem.mockResolvedValue("created");
  look.lookupForItem.mockImplementation(() => new Promise(() => {}));
  up.runUploadBatch.mockImplementation(async (_files: File[], opts: { onChange(e: unknown[]): void }) => {
    const entries = [{ key: "f0", fileName: "shot.jpg", state: "done", itemId: "photo-new" }];
    opts.onChange(entries);
    return entries;
  });
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
    drawImage: () => {},
    getImageData: () => ({}) as ImageData,
  } as unknown as CanvasRenderingContext2D);
  deps = makeDeps();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/* ------------------------------------------------------------------ tests */

describe("ScanPage", () => {
  it("creates a scan through createScanItem with the session's batch, owner and edition, and nothing else", async () => {
    h.books = [book()];
    await renderPage();
    await pickEdition("Invented Box");
    fireEvent.click(screen.getByRole("button", { name: "Start scanning" }));
    expect(fb.unlock).toHaveBeenCalledTimes(1);
    await advance(0);
    expect(deps.startCamera).toHaveBeenCalledTimes(1);
    await feed(A);
    await waitFor(() => expect(repo.createScanItem).toHaveBeenCalledTimes(1));
    expect(repo.createScanItem.mock.calls[0][0]).toEqual({
      id: expect.any(String),
      householdId: "h1",
      batchId: session()!.batchId,
      ownerUserId: "u1",
      isbn: A,
      editionLabel: "Invented Box",
      extraCopy: false,
    });
    expect(repo.confirmItem).not.toHaveBeenCalled();
    expect(repo.processItem).not.toHaveBeenCalled();
    expect(repo.createIntakeItem).not.toHaveBeenCalled();
  });

  it("gives one scan and one beep for a barcode held in view (Review Focus 1)", async () => {
    await startScanning();
    await feed(A, 50);
    await waitFor(() => expect(repo.createScanItem).toHaveBeenCalledTimes(1));
    expect(fb.accept).toHaveBeenCalledTimes(1);
    expect(fb.notice).not.toHaveBeenCalled();
    expect(rows()).toHaveLength(1);
  });

  it("asks before a second copy, pauses decoding while it asks, and adds one only on yes", async () => {
    await startScanning();
    await feed(A);
    await waitFor(() => expect(repo.createScanItem).toHaveBeenCalledTimes(1));
    await advance(3500);
    await feed(A);
    const prompt = await screen.findByRole("alertdialog");
    expect(within(prompt).getByText(PROMPT)).toBeInTheDocument();
    expect(cam.handles[0].stop).toHaveBeenCalled();
    const decodes = decoder.decode.mock.calls.length;
    await advance(2000);
    expect(decoder.decode.mock.calls.length).toBe(decodes);

    fireEvent.click(within(prompt).getByRole("button", { name: "Add another copy" }));
    await advance(0);
    await waitFor(() => expect(repo.createScanItem).toHaveBeenCalledTimes(2));
    expect(repo.createScanItem.mock.calls[1][0]).toMatchObject({ isbn: A, extraCopy: true });
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(deps.startCamera).toHaveBeenCalledTimes(2);

    await advance(3500);
    await feed(A);
    fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "No" }));
    await advance(500);
    expect(repo.createScanItem).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(deps.startCamera).toHaveBeenCalledTimes(3);
  });

  it("says who already owns a scanned book and plays the notice cue", async () => {
    h.books = [book({ isbn13: [A], copies: [{ ...book().copies[0], ownerUserId: "u1", editionNote: null }] })];
    await startScanning();
    await feed(A);
    expect(within(rowFor(A)).getByText("Already in library — Avery's copy")).toBeInTheDocument();
    expect(fb.notice).toHaveBeenCalledTimes(1);
    expect(fb.accept).not.toHaveBeenCalled();
  });

  it("turns a non-ISBN barcode into a message and the nudge, never a row (Review Focus 3)", async () => {
    await startScanning();
    await feed(UPC);
    expect(screen.getByText("That barcode isn't an ISBN.")).toBeInTheDocument();
    expect(screen.getByText(NUDGE)).toBeInTheDocument();
    await advance(1000);
    expect(repo.createScanItem).not.toHaveBeenCalled();
    expect(rows()).toHaveLength(0);
  });

  it("plays the notice cue once for a UPC held in view", async () => {
    await startScanning();
    await feed(UPC, 20);
    expect(fb.notice).toHaveBeenCalledTimes(1);
    expect(fb.accept).not.toHaveBeenCalled();
    expect(screen.getAllByText("That barcode isn't an ISBN.")).toHaveLength(1);
  });

  it("nudges after 8 s with no read, and Dismiss hides it for another 8 s", async () => {
    await startScanning();
    await advance(7500);
    expect(screen.queryByText(NUDGE)).toBeNull();
    await advance(750);
    const nudge = screen.getByText(NUDGE).closest("[role=status]") as HTMLElement;
    expect(within(nudge).getByRole("button", { name: "Take a photo" })).toBeInTheDocument();
    fireEvent.click(within(nudge).getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByText(NUDGE)).toBeNull();
    await advance(7500);
    expect(screen.queryByText(NUDGE)).toBeNull();
    await advance(750);
    expect(screen.getByText(NUDGE)).toBeInTheDocument();
  });

  it("keeps scans on the phone while offline and sends each once when back online (Review Focus 2)", async () => {
    repo.createScanItem.mockRejectedValue(networkError());
    vi.spyOn(console, "error").mockImplementation(() => {});
    await startScanning();
    await feed(A);
    await feed(B);
    await feed(C);
    await waitFor(() => expect(screen.getAllByText(OFFLINE)).toHaveLength(3));
    const queued = JSON.parse(localStorage.getItem("tpl_scan_outbox_h1")!) as { id: string }[];
    expect(queued).toHaveLength(3);

    repo.createScanItem.mockReset();
    repo.createScanItem.mockResolvedValue("created");
    await act(async () => {
      window.dispatchEvent(new Event("online"));
    });
    await waitFor(() => expect(screen.getAllByText("Looking up…")).toHaveLength(3));
    await advance(40_000);
    expect(repo.createScanItem).toHaveBeenCalledTimes(3);
    expect(repo.createScanItem.mock.calls.map((c) => c[0].id).sort()).toEqual(queued.map((q) => q.id).sort());
    expect(localStorage.getItem("tpl_scan_outbox_h1")).toBeNull();
    expect(screen.queryByText(OFFLINE)).toBeNull();
  });

  it("says when online lookups are paused, and Retry starts them again (D6)", async () => {
    const { LookupError } = await import("@/lib/photo/lookup");
    look.lookupForItem.mockRejectedValueOnce(new LookupError("OpenLibrary answered 429", true));
    await startScanning();
    await feed(A);
    const paused = await screen.findByText("Online lookup paused. It will retry.");
    expect(within(rowFor(A)).getByText("Looking up…")).toBeInTheDocument();
    expect(look.lookupForItem).toHaveBeenCalledTimes(1);

    look.lookupForItem.mockResolvedValueOnce({ ...NOT_FOUND, source: "openlibrary", agrees: true, title: "Invented Title" });
    fireEvent.click(within(paused.parentElement as HTMLElement).getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(within(rowFor(A)).getByText("Invented Title")).toBeInTheDocument());
    expect(screen.queryByText("Online lookup paused. It will retry.")).toBeNull();
  });

  it("restores the session after a reload: items, unsent scans, edition and owner", async () => {
    h.books = [book()];
    repo.createScanItem.mockImplementation(async (args: { id: string; batchId: string; isbn: string }) => {
      if (args.isbn !== A) throw networkError();
      h.items = [...h.items, scanItem({ id: args.id, batchId: args.batchId, scannedIsbn: A, ownerUserId: "u2" })];
      return "created";
    });
    vi.spyOn(console, "error").mockImplementation(() => {});
    const first = await renderPage();
    await pickEdition("Invented Box");
    fireEvent.change(screen.getByLabelText("Owner"), { target: { value: "u2" } });
    fireEvent.click(screen.getByRole("button", { name: "Start scanning" }));
    await advance(0);
    await feed(A);
    await waitFor(() => expect(h.items).toHaveLength(1));
    await feed(B);
    await waitFor(() => expect(screen.getByText(OFFLINE)).toBeInTheDocument());
    first.unmount();

    await renderPage();
    await waitFor(() => expect(rows()).toHaveLength(2));
    expect(within(rowFor(A)).getByText("Looking up…")).toBeInTheDocument();
    expect(rowFor(B)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Edition for this session: Invented Box" })).toBeInTheDocument();
    expect(screen.getByLabelText("Owner")).toHaveValue("u2");
    expect(screen.getByRole("button", { name: "New session" })).toBeInTheDocument();
  });

  it("offers a photo for a not-found scan, uploads it with the scan's ISBN and replaces the scan (D8)", async () => {
    look.lookupForItem.mockResolvedValue({ ...NOT_FOUND });
    h.books = [book()];
    await renderPage();
    await pickEdition("Invented Box");
    fireEvent.click(screen.getByRole("button", { name: "Start scanning" }));
    await advance(0);
    await feed(A);
    const row = await waitFor(() => {
      const r = rowFor(A);
      expect(within(r).getByText("Not found online.")).toBeInTheDocument();
      return r;
    });
    const scanId = repo.createScanItem.mock.calls[0][0].id as string;

    let stopsAtClick = -1;
    const click = vi.spyOn(HTMLInputElement.prototype, "click").mockImplementation(function () {
      stopsAtClick = cam.handles[0].stop.mock.calls.length;
    });
    fireEvent.click(within(row).getByRole("button", { name: "Take a photo" }));
    expect(click).toHaveBeenCalledTimes(1);
    expect(stopsAtClick).toBeGreaterThan(0);

    const input = screen.getByLabelText("Book photo");
    expect(input).toHaveAttribute("accept", "image/*");
    expect(input).toHaveAttribute("capture", "environment");
    const shot = new File(["x"], "shot.jpg", { type: "image/jpeg" });
    fireEvent.change(input, { target: { files: [shot] } });
    await advance(0);

    expect(up.runUploadBatch).toHaveBeenCalledTimes(1);
    const [files, opts, uploadDeps] = up.runUploadBatch.mock.calls[0];
    expect(files).toEqual([shot]);
    expect(opts).toMatchObject({
      householdId: "h1",
      batchId: session()!.batchId,
      ownerUserId: "u1",
      scannedIsbn: A,
      editionLabel: "Invented Box",
    });
    expect(typeof opts.onChange).toBe("function");
    expect(uploadDeps).toMatchObject({ marker: "browser" });
    expect(typeof uploadDeps.onItemCreated).toBe("function");
    await waitFor(() => expect(repo.discardItem).toHaveBeenCalledWith(scanId, "replaced_by_photo"));
    expect(deps.startCamera).toHaveBeenCalledTimes(2);
  });

  it("restarts the camera when the photo picker is cancelled", async () => {
    await startScanning();
    vi.spyOn(HTMLInputElement.prototype, "click").mockImplementation(() => {});
    fireEvent.click(screen.getByRole("button", { name: "Take a photo" }));
    expect(cam.handles[0].stop).toHaveBeenCalled();
    fireEvent(screen.getByLabelText("Book photo"), new Event("cancel"));
    await advance(0);
    expect(deps.startCamera).toHaveBeenCalledTimes(2);
    expect(up.runUploadBatch).not.toHaveBeenCalled();
  });

  it("offers Resume camera while the photo picker is open, and restarts on tap", async () => {
    await startScanning();
    vi.spyOn(HTMLInputElement.prototype, "click").mockImplementation(() => {});
    fireEvent.click(screen.getByRole("button", { name: "Take a photo" }));
    expect(cam.handles[0].stop).toHaveBeenCalled();
    await advance(0);
    expect(deps.startCamera).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Resume camera" }));
    await advance(0);
    expect(deps.startCamera).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("button", { name: "Resume camera" })).toBeNull();
  });

  it("restarts the camera when the page is back in front and the picker sent nothing", async () => {
    await startScanning();
    vi.spyOn(HTMLInputElement.prototype, "click").mockImplementation(() => {});
    fireEvent.click(screen.getByRole("button", { name: "Take a photo" }));
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });
    await advance(500);
    expect(deps.startCamera).toHaveBeenCalledTimes(1);
    await advance(600);
    expect(deps.startCamera).toHaveBeenCalledTimes(2);
    expect(up.runUploadBatch).not.toHaveBeenCalled();

    // A late change still uploads the photo.
    fireEvent.change(screen.getByLabelText("Book photo"), {
      target: { files: [new File(["x"], "shot.jpg", { type: "image/jpeg" })] },
    });
    await advance(0);
    expect(up.runUploadBatch).toHaveBeenCalledTimes(1);
  });

  it("stops the camera while the Type ISBN sheet is open and restarts it after", async () => {
    await startScanning();
    fireEvent.click(screen.getByRole("button", { name: "Type ISBN" }));
    await advance(0);
    expect(cam.handles[0].stop).toHaveBeenCalled();
    expect(deps.startCamera).toHaveBeenCalledTimes(1);
    const sheet = screen.getByRole("dialog", { name: "Type ISBN" });
    fireEvent.click(within(sheet).getByRole("button", { name: /cancel|close/i }));
    await advance(0);
    expect(deps.startCamera).toHaveBeenCalledTimes(2);
  });

  describe("replaced scans stay gone (I4)", () => {
    const resume = () =>
      localStorage.setItem(
        "tpl_scan_session",
        JSON.stringify({
          householdId: "h1",
          batchId: "batch-s",
          edition: null,
          ownerUserId: "u1",
          startedAt: "2026-11-10T09:00:00.000Z",
        }),
      );

    it("lists only the photo when the scan was discarded as replaced", async () => {
      resume();
      h.items = [
        scanItem({ status: "discarded", discardReason: "replaced_by_photo", lookup: { ...NOT_FOUND } }),
        photoItem(),
      ];
      await renderPage();
      await waitFor(() => expect(rows()).toHaveLength(1));
      expect(within(rows()[0]).getByText("Invented Title")).toBeInTheDocument();
      expect(repo.discardItem).not.toHaveBeenCalled();
    });

    it("heals a scan left open by a killed tab, once", async () => {
      resume();
      h.items = [scanItem({ lookup: { ...NOT_FOUND } }), photoItem()];
      await renderPage();
      await waitFor(() => expect(repo.discardItem).toHaveBeenCalledWith("scan-x", "replaced_by_photo"));
      await waitFor(() => expect(rows()).toHaveLength(1));
      expect(within(rows()[0]).getByText("Invented Title")).toBeInTheDocument();
      await advance(1000);
      expect(repo.discardItem).toHaveBeenCalledTimes(1);
    });
  });

  it("adds a typed ISBN and refuses an invalid one", async () => {
    await startScanning();
    fireEvent.click(screen.getByRole("button", { name: "Type ISBN" }));
    let sheet = screen.getByRole("dialog", { name: "Type ISBN" });
    const field = within(sheet).getByLabelText("ISBN");
    expect(field).toHaveAttribute("inputmode", "numeric");
    expect(field).toHaveAttribute("autocomplete", "off");
    fireEvent.change(field, { target: { value: "978-0-00-000000-2" } });
    fireEvent.click(within(sheet).getByRole("button", { name: "Add" }));
    await waitFor(() => expect(repo.createScanItem).toHaveBeenCalledTimes(1));
    expect(repo.createScanItem.mock.calls[0][0]).toMatchObject({ isbn: A });

    fireEvent.click(screen.getByRole("button", { name: "Type ISBN" }));
    sheet = screen.getByRole("dialog", { name: "Type ISBN" });
    fireEvent.change(within(sheet).getByLabelText("ISBN"), { target: { value: "9780000000003" } });
    fireEvent.click(within(sheet).getByRole("button", { name: "Add" }));
    expect(within(sheet).getByText("That isn't a valid ISBN. Check the digits.")).toBeInTheDocument();
    await advance(500);
    expect(repo.createScanItem).toHaveBeenCalledTimes(1);
  });

  it("keeps Type ISBN and Take a photo working when camera access is off, with no torch", async () => {
    cam.fail = "denied";
    await startScanning();
    expect(screen.getByText("Camera access is off. You can type an ISBN or take photos instead.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Torch" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Type ISBN" }));
    const sheet = screen.getByRole("dialog", { name: "Type ISBN" });
    fireEvent.change(within(sheet).getByLabelText("ISBN"), { target: { value: B } });
    fireEvent.click(within(sheet).getByRole("button", { name: "Add" }));
    await waitFor(() => expect(repo.createScanItem).toHaveBeenCalledTimes(1));

    vi.spyOn(HTMLInputElement.prototype, "click").mockImplementation(() => {});
    fireEvent.click(screen.getByRole("button", { name: "Take a photo" }));
    fireEvent.change(screen.getByLabelText("Book photo"), {
      target: { files: [new File(["x"], "shot.jpg", { type: "image/jpeg" })] },
    });
    await advance(0);
    expect(up.runUploadBatch).toHaveBeenCalledTimes(1);
    expect(up.runUploadBatch.mock.calls[0][1]).toMatchObject({ scannedIsbn: null });
  });

  it("shows Torch when the camera supports it and turns it on", async () => {
    cam.torch = true;
    await startScanning();
    fireEvent.click(screen.getByRole("button", { name: "Torch" }));
    await advance(0);
    expect(cam.handles[0].setTorch).toHaveBeenCalledWith(true);
  });

  it("stops the camera and wake lock when hidden, and starts again when visible", async () => {
    let state: DocumentVisibilityState = "visible";
    vi.spyOn(document, "visibilityState", "get").mockImplementation(() => state);
    await startScanning();
    expect(wake.holdWakeLock).toHaveBeenCalledTimes(1);
    state = "hidden";
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(cam.handles[0].stop).toHaveBeenCalled();
    expect(wake.releases[0]).toHaveBeenCalled();
    state = "visible";
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await advance(0);
    expect(deps.startCamera).toHaveBeenCalledTimes(2);
  });

  it("pauses the camera after 120 s with no read", async () => {
    await startScanning();
    await advance(120_500);
    expect(screen.getByText("Camera paused to save battery.")).toBeInTheDocument();
    expect(cam.handles[0].stop).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Resume camera" }));
    await advance(0);
    expect(deps.startCamera).toHaveBeenCalledTimes(2);
  });

  it("Done stops the camera, ends the session and opens the inbox", async () => {
    await startScanning();
    expect(session()).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(cam.handles[0].stop).toHaveBeenCalled();
    expect(localStorage.getItem("tpl_scan_session")).toBeNull();
    expect(window.location.hash).toBe("#/inbox");
  });
});
