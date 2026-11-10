import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BookWithCopies, Copy } from "@/lib/types";
import type { Extraction, IntakeItem } from "@/lib/photo/types";

const h = vi.hoisted(() => ({
  items: [] as IntakeItem[],
  books: [] as unknown[],
  failBooks: false,
  failItems: false,
}));

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
  sourceHashExists: vi.fn(),
  uploadPhoto: vi.fn(),
  createIntakeItem: vi.fn(),
  setItemEdition: vi.fn(),
  createScanItem: vi.fn(),
}));
const lib = vi.hoisted(() => ({ listBooks: vi.fn(), patchBook: vi.fn() }));
const photo = vi.hoisted(() => ({
  preparePhoto: vi.fn(),
  lookupMetadata: vi.fn(),
  lookupIsbn: vi.fn(),
  enrichMissing: vi.fn(),
}));

vi.mock("@/lib/photo/intake-repo", () => ({
  ...repo,
  coverPath: (hh: string, id: string) => `${hh}/${id}/cover.jpg`,
  titlePagePath: (hh: string, id: string) => `${hh}/${id}/title.jpg`,
}));
vi.mock("@/lib/library-repo", () => ({
  listBooks: lib.listBooks,
  libibStore: { patchBook: lib.patchBook },
}));
vi.mock("@/lib/photo/prepare", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/photo/prepare")>()),
  preparePhoto: photo.preparePhoto,
}));
vi.mock("@/lib/photo/lookup", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/photo/lookup")>()),
  lookupMetadata: photo.lookupMetadata,
  lookupIsbn: photo.lookupIsbn,
  // The real lookupForItem calls its own module's functions, which a mock can't reach; this
  // dispatches the same way (D7: the scanned ISBN first, then the title) to the mocks.
  lookupForItem: async (it: IntakeItem, opts: unknown) => {
    const title = it.extraction?.title?.trim() ?? "";
    if (it.scannedIsbn !== null) {
      const r = await photo.lookupIsbn(it.scannedIsbn, opts);
      if (r.source !== "none" || it.source === "scan" || title === "") return r;
    }
    return photo.lookupMetadata({ title, authors: it.extraction?.authors ?? [] }, opts);
  },
}));
vi.mock("@/lib/libib/enrich", () => ({ enrichMissing: photo.enrichMissing }));

const household = { id: "h1", name: "Home", inviteCode: "x", createdAt: "" };
const members = [
  { householdId: "h1", userId: "u1", displayName: "Robin", createdAt: "" },
  { householdId: "h1", userId: "u2", displayName: "Sam", createdAt: "" },
];
vi.mock("@/contexts/HouseholdContext", () => ({
  useHousehold: () => ({ household, members, loading: false, error: null, refresh: vi.fn() }),
}));
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: { id: "u1", email: "robin@example.test" }, loading: false }),
}));

import { LookupError } from "@/lib/photo/lookup";
import { PhotoError } from "@/lib/photo/prepare";
import InboxPage from "./InboxPage";

const HEIC =
  "This photo's format can't be read here. Set the camera to JPEG (\"Most compatible\"), or take the photo from this app.";

let seq = 0;
const NOW = new Date().toISOString();
const extraction = (over: Partial<Extraction> = {}): Extraction => ({
  isBook: true,
  title: "Salt Road",
  subtitle: null,
  authors: ["Ana Vale"],
  editionClues: [],
  publisher: null,
  isbn: null,
  confidence: "high",
  ...over,
});
function item(over: Partial<IntakeItem> = {}, ex: Partial<Extraction> | null = {}): IntakeItem {
  seq += 1;
  return {
    id: `item-${seq}`,
    householdId: "h1",
    uploadedBy: "u1",
    batchId: "batch-1",
    ownerUserId: "u1",
    coverPath: `h1/item-${seq}/cover.jpg`,
    titlePagePath: null,
    sourceHash: `hash-${seq}`,
    source: "photo",
    scannedIsbn: null,
    editionLabel: null,
    extraCopy: false,
    discardReason: null,
    status: "ready",
    attempts: 1,
    claimedAt: null,
    retryAt: null,
    extraction: ex === null ? null : extraction(ex),
    lookup: { ...NO_LOOKUP },
    errorCode: null,
    resultBookId: null,
    createdAt: NOW,
    ...over,
  };
}
const NO_LOOKUP = {
  source: "none" as const,
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
};
const copy = (over: Partial<Copy> = {}): Copy => ({
  id: `copy-${++seq}`,
  bookId: "b",
  ownerUserId: "u2",
  editionNote: null,
  copyNote: null,
  location: null,
  origin: "manual",
  libibId: null,
  photoPath: null,
  intakeItemId: null,
  userEditedFields: [],
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
  ...over,
});
const book = (id: string, title: string, over: Partial<BookWithCopies> = {}): BookWithCopies => ({
  id,
  householdId: "h1",
  title,
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
  copies: [copy({ bookId: id })],
  ...over,
});

const findCard = (name: string) => screen.findByRole("article", { name });

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  seq = 0;
  h.items = [];
  h.books = [];
  h.failBooks = false;
  h.failItems = false;
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
  localStorage.clear();
  for (const fn of [...Object.values(repo), ...Object.values(lib), ...Object.values(photo)]) fn.mockReset();
  repo.listIntakeItems.mockImplementation(async () => {
    if (h.failItems) throw new Error("offline");
    return h.items.map((i) => ({ ...i }));
  });
  lib.listBooks.mockImplementation(async () => {
    if (h.failBooks) throw new Error("offline");
    return h.books;
  });
  repo.processItem.mockResolvedValue("ready");
  repo.signedPhotoUrls.mockResolvedValue(new Map());
  repo.purgeIntakePhotos.mockResolvedValue(0);
  repo.sourceHashExists.mockResolvedValue(false);
  repo.uploadPhoto.mockResolvedValue(undefined);
  repo.createIntakeItem.mockResolvedValue("created");
  repo.saveLookup.mockResolvedValue(undefined);
  repo.setItemOwner.mockResolvedValue(undefined);
  repo.retryItem.mockResolvedValue(true);
  repo.setItemEdition.mockImplementation(async (id: string, label: string | null) => {
    h.items = h.items.map((i) => (i.id === id ? { ...i, editionLabel: label } : i));
  });
  repo.discardItem.mockImplementation(async (id: string) => {
    h.items = h.items.map((i) => (i.id === id ? { ...i, status: "discarded" } : i));
    return true;
  });
  repo.confirmItem.mockImplementation(async (id: string, target: { bookId?: string }) => {
    h.items = h.items.map((i) => (i.id === id ? { ...i, status: "confirmed" } : i));
    return { bookId: target.bookId ?? `book-for-${id}`, copyId: `copy-for-${id}` };
  });
  lib.patchBook.mockResolvedValue(true);
  photo.preparePhoto.mockImplementation(async (f: File) => ({
    blob: new Blob(["x"]),
    sourceHash: `sha-${f.name}`,
  }));
  photo.lookupMetadata.mockResolvedValue({ ...NO_LOOKUP });
  photo.lookupIsbn.mockResolvedValue({ ...NO_LOOKUP, byIsbn: true });
  photo.enrichMissing.mockResolvedValue({ looked: 0, filled: 0, failed: false });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const files = (n: number) =>
  Array.from({ length: n }, (_, i) => new File([`bytes-${i}`], `photo-${i}.jpg`, { type: "image/jpeg" }));

describe("InboxPage", () => {
  it("uploads each chosen photo and asks for it to be read", async () => {
    render(<InboxPage />);
    const input = await screen.findByLabelText("Choose photos");
    fireEvent.change(input, { target: { files: files(3) } });
    expect(screen.getByText("Uploading 0 of 3")).toBeInTheDocument();
    await waitFor(() => expect(repo.createIntakeItem).toHaveBeenCalledTimes(3));
    for (const call of repo.createIntakeItem.mock.calls) {
      expect(call[0]).toMatchObject({ householdId: "h1", ownerUserId: "u1" });
    }
    await waitFor(() => expect(repo.processItem).toHaveBeenCalledTimes(3));
    const created = repo.createIntakeItem.mock.calls.map((c) => c[0].id);
    expect(repo.processItem.mock.calls.map((c) => c[0]).sort()).toEqual([...created].sort());
  });

  it("uploads for Shared and remembers the owner", async () => {
    render(<InboxPage />);
    fireEvent.change(await screen.findByLabelText("Owner"), { target: { value: "shared" } });
    fireEvent.change(screen.getByLabelText("Choose photos"), { target: { files: files(1) } });
    await waitFor(() => expect(repo.createIntakeItem).toHaveBeenCalledTimes(1));
    expect(repo.createIntakeItem.mock.calls[0][0].ownerUserId).toBeNull();
    expect(localStorage.getItem("tpl_intake_owner")).toBe("shared");
  });

  it("writes nothing to the catalog until a button is pressed", async () => {
    h.books = [book("b1", "Salt Road")];
    h.items = [item({ status: "pending", extraction: null, lookup: null }), item({ status: "pending", extraction: null, lookup: null })];
    render(<InboxPage />);
    expect(await screen.findAllByText("Waiting to be read")).toHaveLength(2);
    h.items = h.items.map((i) => ({ ...i, status: "ready", extraction: extraction(), lookup: { ...NO_LOOKUP } }));
    await act(() => vi.advanceTimersByTimeAsync(10_000));
    expect(await screen.findAllByRole("radio", { name: "Add a copy to Salt Road" })).toHaveLength(2);
    expect(repo.confirmItem).not.toHaveBeenCalled();
    expect(repo.discardItem).not.toHaveBeenCalled();
    expect(lib.patchBook).not.toHaveBeenCalled();
  });

  it("shows only an error, with no cards or upload, when the catalog can't be read", async () => {
    h.failBooks = true;
    h.items = [item()];
    vi.spyOn(console, "error").mockImplementation(() => {});
    render(<InboxPage />);
    expect(await screen.findByText("Couldn't reach the photo inbox.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
    expect(screen.queryByRole("article")).toBeNull();
    expect(screen.queryByLabelText("Choose photos")).toBeNull();
  });

  it("preselects Add a copy for a same-title match and confirms it with one tap", async () => {
    h.books = [book("b1", "Salt Road")];
    const it1 = item();
    h.items = [it1];
    render(<InboxPage />);
    const c = await findCard("Salt Road");
    expect(within(c).getByRole("radio", { name: "Add a copy to Salt Road" })).toBeChecked();
    expect(within(c).getByText("Sam")).toBeInTheDocument();
    fireEvent.click(within(c).getByRole("button", { name: "Confirm" }));
    await waitFor(() => expect(repo.confirmItem).toHaveBeenCalledTimes(1));
    expect(repo.confirmItem).toHaveBeenCalledWith(it1.id, { bookId: "b1" }, {
      ownerUserId: "u1",
      editionNote: null,
      copyNote: null,
      location: null,
    });
  });

  it("preselects Already recorded when the same owner has a copy, and discards on confirm", async () => {
    h.books = [book("b1", "Salt Road", { copies: [copy({ bookId: "b1", ownerUserId: "u1", editionNote: "Paperback" })] })];
    const it1 = item();
    h.items = [it1];
    render(<InboxPage />);
    const c = await findCard("Salt Road");
    expect(within(c).getByRole("radio", { name: "Already recorded" })).toBeChecked();
    expect(within(c).getByText("Robin · Paperback")).toBeInTheDocument();
    fireEvent.click(within(c).getByRole("button", { name: "Confirm" }));
    await waitFor(() => expect(repo.discardItem).toHaveBeenCalledWith(it1.id, "already_recorded"));
    expect(repo.confirmItem).not.toHaveBeenCalled();
  });

  it("sends an edited title when adding as a new book", async () => {
    h.books = [book("b1", "Salt Road")];
    const it1 = item();
    h.items = [it1];
    render(<InboxPage />);
    const c = await findCard("Salt Road");
    fireEvent.click(within(c).getByRole("radio", { name: "Add as a new book" }));
    fireEvent.click(within(c).getByRole("button", { name: "Edit details" }));
    fireEvent.change(within(c).getByLabelText("Title"), { target: { value: "Salt Road Revisited" } });
    fireEvent.click(within(c).getByRole("button", { name: "Confirm" }));
    await waitFor(() => expect(repo.confirmItem).toHaveBeenCalledTimes(1));
    expect(repo.confirmItem.mock.calls[0][0]).toBe(it1.id);
    expect(repo.confirmItem.mock.calls[0][1]).toEqual({
      book: expect.objectContaining({ title: "Salt Road Revisited", authors: ["Ana Vale"] }),
    });
  });

  it("makes one call for a double tap, recovers from a failure and finishes on retry", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const it1 = item();
    h.items = [it1];
    const first = deferred<{ bookId: string; copyId: string }>();
    repo.confirmItem.mockImplementationOnce(() => first.promise);
    render(<InboxPage />);
    const c = await findCard("Salt Road");
    const button = within(c).getByRole("button", { name: "Confirm" });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(repo.confirmItem).toHaveBeenCalledTimes(1);
    expect(button).toBeDisabled();
    await act(async () => first.reject(new Error("lost response")));
    expect(await within(c).findByText("Couldn't save this. Try again.")).toBeInTheDocument();
    expect(button).toBeEnabled();
    fireEvent.click(button);
    expect(await screen.findByText("Added to the library.")).toBeInTheDocument();
    expect(repo.confirmItem).toHaveBeenCalledTimes(2);
    expect(repo.confirmItem.mock.calls[1][0]).toBe(it1.id);
  });

  it("bulk-adds only the eligible new books, after listing them", async () => {
    h.books = [book("b1", "Salt Road")];
    const eligible = [
      item({}, { title: "Copper Lantern" }),
      item({}, { title: "Northern Kettle" }),
      item({}, { title: "Silent Harbor" }),
    ];
    const match = item();
    h.items = [...eligible, match];
    render(<InboxPage />);
    const open = await screen.findByRole("button", { name: "Add 3 new books" });
    fireEvent.click(open);
    const sheet = screen.getByRole("dialog");
    for (const t of ["Copper Lantern", "Northern Kettle", "Silent Harbor"]) {
      expect(within(sheet).getByText(t, { exact: false })).toBeInTheDocument();
    }
    expect(within(sheet).queryByText("Salt Road", { exact: false })).toBeNull();
    fireEvent.click(within(sheet).getByRole("button", { name: "Add 3 books" }));
    await waitFor(() => expect(repo.confirmItem).toHaveBeenCalledTimes(3));
    expect(repo.confirmItem.mock.calls.map((c) => c[0]).sort()).toEqual(eligible.map((i) => i.id).sort());
    for (const call of repo.confirmItem.mock.calls) expect(call[1]).toHaveProperty("book");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    const remaining = await findCard("Salt Road");
    expect(within(remaining).getByRole("button", { name: "Confirm" })).toBeEnabled();
  });

  it("shows a failed item's reason, offers Try again, and confirms once a title is typed", async () => {
    const failed = item({ status: "failed", errorCode: "vision_unreadable", attempts: 1, lookup: null }, null);
    h.items = [failed];
    render(<InboxPage />);
    const c = await findCard("Untitled photo");
    expect(within(c).getByText("Couldn't read this photo. Type the title to add it.")).toBeInTheDocument();
    fireEvent.click(within(c).getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(repo.retryItem).toHaveBeenCalledWith(failed.id));
    const confirm = within(c).getByRole("button", { name: "Confirm" });
    expect(confirm).toBeDisabled();
    fireEvent.change(within(c).getByLabelText("Title"), { target: { value: "Paper Moth" } });
    expect(confirm).toBeEnabled();
    fireEvent.click(confirm);
    await waitFor(() => expect(repo.confirmItem).toHaveBeenCalledTimes(1));
    expect(repo.confirmItem.mock.calls[0][1]).toEqual({ book: expect.objectContaining({ title: "Paper Moth" }) });
  });

  it("keeps the details open while a missing title is typed", async () => {
    const untitled = item({ lookup: null }, { title: null, authors: [] });
    h.items = [untitled];
    render(<InboxPage />);
    const c = await findCard("Untitled photo");
    expect(within(c).getByText("No title found. Type it to continue.")).toBeInTheDocument();
    fireEvent.change(within(c).getByLabelText("Title"), { target: { value: "P" } });
    fireEvent.change(within(c).getByLabelText("Title"), { target: { value: "Paper Moth" } });
    fireEvent.change(within(c).getByLabelText("Authors"), { target: { value: "Ana Vale" } });
    fireEvent.click(within(c).getByRole("button", { name: "Confirm" }));
    await waitFor(() => expect(repo.confirmItem).toHaveBeenCalledTimes(1));
    expect(repo.confirmItem.mock.calls[0][1]).toEqual({
      book: expect.objectContaining({ title: "Paper Moth", authors: ["Ana Vale"] }),
    });
  });

  it("offers no Try again once attempts are used up", async () => {
    h.items = [item({ status: "failed", errorCode: "attempts_exhausted", attempts: 3, lookup: null }, null)];
    render(<InboxPage />);
    const c = await findCard("Untitled photo");
    expect(within(c).getByText("Couldn't read this photo after 3 tries. Type the title to add it.")).toBeInTheDocument();
    expect(within(c).queryByRole("button", { name: "Try again" })).toBeNull();
  });

  it("stops reading on the daily cap and shows its banner", async () => {
    h.items = [1, 2, 3].map(() => item({ status: "pending", extraction: null, lookup: null }));
    repo.processItem.mockResolvedValue("daily_cap");
    render(<InboxPage />);
    expect(
      await screen.findByText("Today's photo limit is reached (500). The rest will be read tomorrow."),
    ).toBeInTheDocument();
    const calls = repo.processItem.mock.calls.length;
    expect(calls).toBeLessThanOrEqual(2);
    await act(() => vi.advanceTimersByTimeAsync(30_000));
    expect(repo.processItem).toHaveBeenCalledTimes(calls);
  });

  it("explains a HEIC photo and uploads nothing", async () => {
    photo.preparePhoto.mockRejectedValue(new PhotoError("unreadable"));
    render(<InboxPage />);
    fireEvent.change(await screen.findByLabelText("Choose photos"), { target: { files: files(1) } });
    expect(await screen.findByText(HEIC)).toBeInTheDocument();
    expect(repo.uploadPhoto).not.toHaveBeenCalled();
    expect(repo.createIntakeItem).not.toHaveBeenCalled();
  });

  it("looks up a ready item once and saves the result", async () => {
    const it1 = item({ lookup: null }, { title: "Copper Lantern" });
    h.items = [it1];
    render(<InboxPage />);
    await waitFor(() => expect(repo.saveLookup).toHaveBeenCalledTimes(1));
    expect(photo.lookupMetadata).toHaveBeenCalledWith(
      { title: "Copper Lantern", authors: ["Ana Vale"] },
      expect.anything(),
    );
    expect(repo.saveLookup.mock.calls[0][0]).toBe(it1.id);
  });

  it("keeps uploads going when a later refresh fails, and holds Confirm until a good read", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    h.items = [item({}, { title: "Copper Lantern" }), item({ status: "pending", extraction: null, lookup: null })];
    const second = deferred<void>();
    repo.uploadPhoto.mockResolvedValueOnce(undefined).mockImplementationOnce(() => second.promise);
    render(<InboxPage />);
    const c = await findCard("Copper Lantern");
    const confirm = within(c).getByRole("button", { name: "Confirm" });
    expect(confirm).toBeEnabled();

    fireEvent.change(screen.getByLabelText("Choose photos"), { target: { files: files(2) } });
    expect(await screen.findByText("Uploading 1 of 2")).toBeInTheDocument();
    await waitFor(() => expect(repo.processItem).toHaveBeenCalled());

    h.failItems = true;
    await act(() => vi.advanceTimersByTimeAsync(10_000));
    expect(await screen.findByText("Couldn't reach the photo inbox.")).toBeInTheDocument();
    expect(screen.getByText("Uploading 1 of 2")).toBeInTheDocument();
    expect(screen.getByText("photo-1.jpg")).toBeInTheDocument();
    expect(screen.getByLabelText("Choose photos")).toBeInTheDocument();
    const leave = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(leave);
    expect(leave.defaultPrevented).toBe(true);
    expect(confirm).toBeDisabled();

    h.failItems = false;
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(confirm).toBeEnabled());
    expect(screen.queryByText("Couldn't reach the photo inbox.")).toBeNull();

    await act(async () => second.resolve());
    // All uploaded: the count goes away rather than reading "Uploading" after the fact.
    await waitFor(() => expect(screen.queryByText("Uploading 1 of 2")).toBeNull());
    expect(screen.queryByText(/Upload(ing|ed) \d+ of 2/)).toBeNull();
  });

  it("holds the bulk button while a refresh has failed", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    h.items = [
      item({}, { title: "Copper Lantern" }),
      item({}, { title: "Northern Kettle" }),
      item({ status: "pending", extraction: null, lookup: null }),
    ];
    render(<InboxPage />);
    const bulk = await screen.findByRole("button", { name: "Add 2 new books" });
    expect(bulk).toBeEnabled();
    h.failBooks = true;
    h.failItems = true;
    await act(() => vi.advanceTimersByTimeAsync(10_000));
    await waitFor(() => expect(bulk).toBeDisabled());
  });

  it("drops the lookup line after a failed lookup, and retries it from the lookup Retry", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const a = item({ lookup: null }, { title: "Copper Lantern" });
    const b = item({ lookup: null }, { title: "Northern Kettle" });
    h.items = [a, b];
    photo.lookupMetadata
      .mockRejectedValueOnce(new Error("boom"))
      .mockRejectedValueOnce(new LookupError("OpenLibrary answered 429", true));
    render(<InboxPage />);
    expect(await screen.findByText("Online lookup paused. It will retry.")).toBeInTheDocument();
    expect(screen.queryByText("Looking it up online…")).toBeNull();
    expect(photo.lookupMetadata).toHaveBeenCalledTimes(2);
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(repo.saveLookup).toHaveBeenCalledTimes(2));
    expect(repo.saveLookup.mock.calls.map((call) => call[0]).sort()).toEqual([a.id, b.id].sort());
  });

  it("drops the lookup line when saving the lookup fails and a poll brings back none", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    h.items = [item({ lookup: null }, { title: "Copper Lantern" }), item({ status: "pending", extraction: null, lookup: null })];
    repo.saveLookup.mockRejectedValue(new Error("offline"));
    render(<InboxPage />);
    await findCard("Copper Lantern");
    await waitFor(() => expect(repo.saveLookup).toHaveBeenCalledTimes(1));
    // Let the post-drain refresh settle, then count only the poll's read.
    await act(async () => {});
    const before = repo.listIntakeItems.mock.calls.length;
    await act(() => vi.advanceTimersByTimeAsync(10_000));
    await waitFor(() => expect(repo.listIntakeItems.mock.calls.length).toBeGreaterThan(before));
    await act(async () => {});
    expect(screen.getByText("Waiting to be read")).toBeInTheDocument();
    expect(screen.queryByText("Looking it up online…")).toBeNull();
    expect(photo.lookupMetadata).toHaveBeenCalledTimes(1);
  });

  describe("upload status", () => {
    it("reads Uploaded {n} of {total} after the batch when something failed", async () => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      repo.createIntakeItem.mockResolvedValueOnce("created").mockRejectedValueOnce(new Error("offline"));
      render(<InboxPage />);
      fireEvent.change(await screen.findByLabelText("Choose photos"), { target: { files: files(2) } });
      expect(await screen.findByText("Uploaded 1 of 2")).toBeInTheDocument();
      expect(screen.queryByText(/Uploading/)).toBeNull();
      expect(screen.getByText("Upload failed.")).toBeInTheDocument();
    });
  });

  describe("discard", () => {
    it("never discards a ready or failed card without a press", async () => {
      h.items = [
        item({}, { title: "Copper Lantern" }),
        item({ status: "failed", errorCode: "vision_unreadable", lookup: null }, null),
      ];
      render(<InboxPage />);
      expect(within(await findCard("Untitled photo")).getByRole("button", { name: "Discard photo" })).toBeEnabled();
      expect(within(await findCard("Copper Lantern")).getByRole("button", { name: "Discard photo" })).toBeEnabled();
      await act(() => vi.advanceTimersByTimeAsync(30_000));
      expect(repo.discardItem).not.toHaveBeenCalled();
      expect(repo.confirmItem).not.toHaveBeenCalled();
    });

    it("discards once for a double press, purges, and lists it under Done today", async () => {
      const it1 = item({}, { title: "Copper Lantern" });
      h.items = [it1];
      const first = deferred<void>();
      repo.discardItem.mockImplementationOnce(async (id: string) => {
        await first.promise;
        h.items = h.items.map((i) => (i.id === id ? { ...i, status: "discarded" } : i));
        return true;
      });
      render(<InboxPage />);
      const c = await findCard("Copper Lantern");
      await act(async () => {});
      const purgesBefore = repo.purgeIntakePhotos.mock.calls.length;
      const button = within(c).getByRole("button", { name: "Discard photo" });
      fireEvent.click(button);
      fireEvent.click(button);
      expect(button).toBeDisabled();
      await act(async () => first.resolve());
      expect(await screen.findByText("Not added. The photo was removed.")).toBeInTheDocument();
      expect(repo.discardItem).toHaveBeenCalledTimes(1);
      expect(repo.discardItem).toHaveBeenCalledWith(it1.id, "discarded");
      expect(repo.confirmItem).not.toHaveBeenCalled();
      expect(repo.purgeIntakePhotos.mock.calls.length).toBeGreaterThan(purgesBefore);
      const done = screen.getByRole("region", { name: "Done today" });
      expect(within(done).getByRole("article", { name: "Copper Lantern" })).toBeInTheDocument();
      expect(screen.queryByRole("region", { name: "To review" })).toBeNull();
    });

    it("says when a photo isn't a book, preselects Discard, and discards on Confirm", async () => {
      const notBook = item({ lookup: null }, { isBook: false, title: null, authors: [] });
      h.items = [notBook, item({}, { title: "Copper Lantern" }), item({}, { title: "Northern Kettle" })];
      render(<InboxPage />);
      const c = await findCard("Untitled photo");
      expect(within(c).getByText("This doesn't look like a book.")).toBeInTheDocument();
      expect(within(c).getByRole("radio", { name: "Discard the photo" })).toBeChecked();
      // Never bulk-added: only the two real books are offered.
      expect(screen.getByRole("button", { name: "Add 2 new books" })).toBeInTheDocument();
      fireEvent.click(within(c).getByRole("button", { name: "Confirm" }));
      await waitFor(() => expect(repo.discardItem).toHaveBeenCalledWith(notBook.id, "discarded"));
      expect(repo.confirmItem).not.toHaveBeenCalled();
      expect(await screen.findByRole("article", { name: "Photo removed" })).toBeInTheDocument();
    });

    it("adds a not-a-book photo when the person picks another option", async () => {
      h.items = [item({}, { isBook: false, title: "Copper Lantern" })];
      render(<InboxPage />);
      const c = await findCard("Copper Lantern");
      fireEvent.click(within(c).getByRole("radio", { name: "Add as a new book" }));
      fireEvent.click(within(c).getByRole("button", { name: "Confirm" }));
      await waitFor(() => expect(repo.confirmItem).toHaveBeenCalledTimes(1));
      expect(repo.discardItem).not.toHaveBeenCalled();
    });
  });

  it("shows Claude's clues only as a hint, never as the edition, on the card and in the bulk sheet", async () => {
    h.items = [
      item({}, { title: "Copper Lantern", editionClues: ["Book club edition", "Sprayed edges"] }),
      item({}, { title: "Northern Kettle" }),
    ];
    render(<InboxPage />);
    const c = await findCard("Copper Lantern");
    expect(within(c).getByText("Claude saw: Book club edition, Sprayed edges")).toBeInTheDocument();
    expect(within(c).getByRole("button", { name: "Edition: none" })).toBeInTheDocument();
    expect(within(await findCard("Northern Kettle")).queryByText(/Claude saw:/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Add 2 new books" }));
    const sheet = screen.getByRole("dialog");
    expect(within(sheet).getAllByText("Edition: none")).toHaveLength(2);
    expect(within(sheet).queryByText(/Book club edition/)).toBeNull();
  });

  it("names a confirmed item after its catalog book, and an untitled discard as Photo removed", async () => {
    h.books = [book("b9", "Paper Moth")];
    h.items = [
      item({ status: "confirmed", resultBookId: "b9", updatedAt: NOW, lookup: null }, { title: null, authors: [] }),
      item({ status: "discarded", updatedAt: NOW, lookup: null }, null),
    ];
    render(<InboxPage />);
    const done = await screen.findByRole("region", { name: "Done today" });
    expect(within(done).getByRole("article", { name: "Paper Moth" })).toBeInTheDocument();
    expect(within(done).getByRole("article", { name: "Photo removed" })).toBeInTheDocument();
    expect(within(done).queryByRole("article", { name: "Untitled photo" })).toBeNull();
  });

  describe("a chosen candidate", () => {
    it("stays offered and selected when a reload pushes it out of the top 3", async () => {
      h.books = [book("b1", "Salt Roads")];
      const it1 = item();
      h.items = [it1, item({}, { title: "Copper Lantern" })];
      render(<InboxPage />);
      const c = await findCard("Salt Road");
      fireEvent.click(within(c).getByRole("radio", { name: "Add a copy to Salt Roads" }));
      // Three exact-title books arrive with the next full load and outrank the chosen one.
      h.books = [book("b1", "Salt Roads"), book("b2", "Salt Road"), book("b3", "Salt Road"), book("b4", "Salt Road")];
      fireEvent.click(within(await findCard("Copper Lantern")).getByRole("button", { name: "Confirm" }));
      await waitFor(() => expect(within(c).getAllByRole("radio", { name: "Add a copy to Salt Road" })).toHaveLength(3));
      expect(within(c).getByRole("radio", { name: "Add a copy to Salt Roads" })).toBeChecked();
      fireEvent.click(within(c).getByRole("button", { name: "Confirm" }));
      await waitFor(() => expect(repo.confirmItem).toHaveBeenCalledWith(it1.id, { bookId: "b1" }, expect.anything()));
    });

    it("falls back to the default when the chosen book leaves the catalog", async () => {
      h.books = [book("b1", "Salt Roads"), book("b2", "Salt Road")];
      h.items = [item(), item({}, { title: "Copper Lantern" })];
      render(<InboxPage />);
      const c = await findCard("Salt Road");
      fireEvent.click(within(c).getByRole("radio", { name: "Add a copy to Salt Roads" }));
      h.books = [book("b2", "Salt Road")];
      fireEvent.click(within(await findCard("Copper Lantern")).getByRole("button", { name: "Confirm" }));
      await waitFor(() => expect(within(c).queryByRole("radio", { name: "Add a copy to Salt Roads" })).toBeNull());
      expect(within(c).getByRole("radio", { name: "Add a copy to Salt Road" })).toBeChecked();
    });
  });

  it("keeps a twin's warning until the catalog holding the new book has loaded", async () => {
    const a = item({}, { title: "Copper Lantern" });
    h.items = [a, item({}, { title: "Copper Lantern" })];
    render(<InboxPage />);
    const [cardA, cardB] = await screen.findAllByRole("article", { name: "Copper Lantern" });
    const TWIN = "Another photo in this batch looks like the same book.";
    expect(within(cardB).getByText(TWIN)).toBeInTheDocument();
    await act(async () => {});
    const catalogRead = deferred<BookWithCopies[]>();
    lib.listBooks.mockImplementationOnce(() => catalogRead.promise);
    fireEvent.click(within(cardA).getByRole("button", { name: "Confirm" }));
    await waitFor(() => expect(repo.confirmItem).toHaveBeenCalledTimes(1));
    await act(async () => {});
    // Confirmed on the server, but the catalog hasn't caught up: the warning stays.
    expect(within(cardB).getByText(TWIN)).toBeInTheDocument();
    expect(screen.queryByText("Added to the library.")).toBeNull();
    const newId = `book-for-${a.id}`;
    await act(async () =>
      catalogRead.resolve([book(newId, "Copper Lantern", { copies: [copy({ bookId: newId, ownerUserId: "u2" })] })]),
    );
    expect(await screen.findByText("Added to the library.")).toBeInTheDocument();
    const review = screen.getByRole("region", { name: "To review" });
    const left = within(review).getByRole("article", { name: "Copper Lantern" });
    expect(within(left).queryByText(TWIN)).toBeNull();
    expect(within(left).getByRole("radio", { name: "Add a copy to Copper Lantern" })).toBeChecked();
  });

  describe("editions and hints", () => {
    const labelled = () => [book("b7", "Paper Moth", { copies: [copy({ bookId: "b7", editionNote: "Invented Box" })] })];

    it("shows Claude's clues as a hint and confirms with no edition by default", async () => {
      h.books = labelled();
      const it1 = item({}, { title: "Copper Lantern", editionClues: ["Invented foil", "Signed"] });
      h.items = [it1];
      render(<InboxPage />);
      const c = await findCard("Copper Lantern");
      expect(within(c).getByText("Claude saw: Invented foil, Signed")).toBeInTheDocument();
      expect(within(c).getByRole("button", { name: "Edition: none" })).toBeInTheDocument();
      fireEvent.click(within(c).getByRole("button", { name: "Confirm" }));
      await waitFor(() => expect(repo.confirmItem).toHaveBeenCalledTimes(1));
      expect(repo.confirmItem.mock.calls[0][2]).toEqual({
        ownerUserId: "u1",
        editionNote: null,
        copyNote: null,
        location: null,
      });
    });

    it("saves a picked edition at once and confirms with it and the typed copy note", async () => {
      h.books = labelled();
      const it1 = item({}, { title: "Copper Lantern", editionClues: ["Invented foil", "Signed"] });
      h.items = [it1];
      render(<InboxPage />);
      const c = await findCard("Copper Lantern");
      fireEvent.click(within(c).getByRole("button", { name: "Edition: none" }));
      fireEvent.click(within(screen.getByRole("dialog", { name: "Edition" })).getByRole("button", { name: "Invented Box" }));
      await waitFor(() => expect(repo.setItemEdition).toHaveBeenCalledWith(it1.id, "Invented Box"));
      expect(within(c).getByRole("button", { name: "Edition: Invented Box" })).toBeInTheDocument();
      fireEvent.click(within(c).getByRole("button", { name: "Edit details" }));
      fireEvent.change(within(c).getByLabelText("Copy note"), { target: { value: "Gift from a friend" } });
      fireEvent.click(within(c).getByRole("button", { name: "Confirm" }));
      await waitFor(() => expect(repo.confirmItem).toHaveBeenCalledTimes(1));
      expect(repo.confirmItem.mock.calls[0][2]).toEqual({
        ownerUserId: "u1",
        editionNote: "Invented Box",
        copyNote: "Gift from a friend",
        location: null,
      });
    });
  });

  describe("scan cards", () => {
    const ISBN = "9780000000002";
    const FOUND = {
      ...NO_LOOKUP,
      source: "openlibrary" as const,
      agrees: true,
      byIsbn: true,
      title: "Invented Atlas",
      authors: ["Ana Vale"],
      matchIsbns: [ISBN],
      coverUrl: "https://covers.example.test/invented-atlas.jpg",
    };
    const scan = (over: Partial<IntakeItem> = {}) =>
      item({ source: "scan", scannedIsbn: ISBN, coverPath: null, sourceHash: null, ...over }, null);

    it("shows a found scan by its lookup title and ISBN, and counts it for bulk", async () => {
      h.items = [scan({ lookup: { ...FOUND } }), item({}, { title: "Copper Lantern" })];
      render(<InboxPage />);
      const c = await findCard("Invented Atlas");
      expect(within(c).getByText(`Scanned ISBN ${ISBN}`)).toBeInTheDocument();
      expect(within(c).getByRole("img")).toHaveAttribute("src", FOUND.coverUrl);
      expect(screen.getByRole("button", { name: "Add 2 new books" })).toBeInTheDocument();
    });

    it("asks for a title on a not-found scan and confirms it with the scanned ISBN", async () => {
      const s = scan({ lookup: { ...NO_LOOKUP, byIsbn: true } });
      h.items = [s];
      render(<InboxPage />);
      const c = await findCard("Not found online");
      expect(within(c).getByText("No title found. Type it to continue.")).toBeInTheDocument();
      expect(within(c).getByText(`Scanned ISBN ${ISBN}`)).toBeInTheDocument();
      const confirm = within(c).getByRole("button", { name: "Confirm" });
      expect(confirm).toBeDisabled();
      fireEvent.change(within(c).getByLabelText("Title"), { target: { value: "Invented Atlas" } });
      expect(confirm).toBeEnabled();
      fireEvent.click(confirm);
      await waitFor(() => expect(repo.confirmItem).toHaveBeenCalledTimes(1));
      expect(repo.confirmItem.mock.calls[0][0]).toBe(s.id);
      expect(repo.confirmItem.mock.calls[0][1]).toEqual({
        book: expect.objectContaining({ title: "Invented Atlas", isbn13: [ISBN] }),
      });
    });

    it("says when the photo and the barcode disagree", async () => {
      h.items = [item({ scannedIsbn: ISBN, lookup: { ...FOUND } }, { title: "Copper Lantern" })];
      render(<InboxPage />);
      const c = await findCard("Copper Lantern");
      expect(within(c).getByText("The photo and the barcode don't match. Check which book this is.")).toBeInTheDocument();
    });

    it("says a deliberate second scan was scanned more than once, not the photo wording", async () => {
      h.items = [scan({ lookup: { ...FOUND } }), scan({ lookup: { ...FOUND }, extraCopy: true })];
      render(<InboxPage />);
      const [a] = await screen.findAllByRole("article", { name: "Invented Atlas" });
      expect(within(a).getByText("You scanned this book more than once in this session.")).toBeInTheDocument();
      expect(screen.queryByText("Another photo in this batch looks like the same book.")).toBeNull();
    });

    it("looks up a ready scan by its ISBN once and saves the result", async () => {
      const s = scan({ lookup: null });
      h.items = [s];
      photo.lookupIsbn.mockResolvedValue({ ...FOUND });
      render(<InboxPage />);
      await waitFor(() => expect(repo.saveLookup).toHaveBeenCalledTimes(1));
      expect(photo.lookupIsbn).toHaveBeenCalledTimes(1);
      expect(photo.lookupIsbn.mock.calls[0][0]).toBe(ISBN);
      expect(photo.lookupMetadata).not.toHaveBeenCalled();
      expect(repo.saveLookup.mock.calls[0]).toEqual([s.id, FOUND]);
      expect(await findCard("Invented Atlas")).toBeInTheDocument();
    });

    it("pauses lookups on a retryable error and resumes by itself after 60 s", async () => {
      vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "setTimeout", "clearTimeout", "Date"] });
      vi.spyOn(console, "error").mockImplementation(() => {});
      h.items = [scan({ lookup: null })];
      photo.lookupIsbn
        .mockRejectedValueOnce(new LookupError("OpenLibrary answered 503", true))
        .mockResolvedValue({ ...FOUND });
      render(<InboxPage />);
      await act(() => vi.advanceTimersByTimeAsync(10));
      expect(screen.getByText("Online lookup paused. It will retry.")).toBeInTheDocument();
      expect(photo.lookupIsbn).toHaveBeenCalledTimes(1);
      await act(() => vi.advanceTimersByTimeAsync(59_000));
      expect(photo.lookupIsbn).toHaveBeenCalledTimes(1);
      await act(() => vi.advanceTimersByTimeAsync(1_000));
      expect(photo.lookupIsbn).toHaveBeenCalledTimes(2);
      expect(repo.saveLookup).toHaveBeenCalledTimes(1);
      expect(screen.queryByText("Online lookup paused. It will retry.")).toBeNull();
    });

    it("resumes paused lookups when the browser comes back online", async () => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      h.items = [scan({ lookup: null })];
      photo.lookupIsbn
        .mockRejectedValueOnce(new LookupError("OpenLibrary request failed", true))
        .mockResolvedValue({ ...FOUND });
      render(<InboxPage />);
      expect(await screen.findByText("Online lookup paused. It will retry.")).toBeInTheDocument();
      act(() => {
        window.dispatchEvent(new Event("online"));
      });
      await waitFor(() => expect(repo.saveLookup).toHaveBeenCalledTimes(1));
      expect(photo.lookupIsbn).toHaveBeenCalledTimes(2);
    });

    it("marks only the item on a non-retryable lookup error, without pausing", async () => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      const a = scan({ lookup: null });
      const b = item({ lookup: null }, { title: "Copper Lantern" });
      h.items = [a, b];
      photo.lookupIsbn.mockRejectedValueOnce(new LookupError("OpenLibrary sent a reply that isn't JSON", false));
      render(<InboxPage />);
      await waitFor(() => expect(repo.saveLookup).toHaveBeenCalledTimes(1));
      expect(repo.saveLookup.mock.calls[0][0]).toBe(b.id);
      expect(screen.queryByText("Online lookup paused. It will retry.")).toBeNull();
    });
  });

  describe("bulk editions", () => {
    it("sets the edition on the checked entries and adds only those", async () => {
      h.books = [book("b7", "Paper Moth", { copies: [copy({ bookId: "b7", editionNote: "Invented Box" })] })];
      const eligible = [
        item({}, { title: "Copper Lantern" }),
        item({}, { title: "Northern Kettle" }),
        item({}, { title: "Silent Harbor" }),
      ];
      h.items = eligible;
      render(<InboxPage />);
      fireEvent.click(await screen.findByRole("button", { name: "Add 3 new books" }));
      const sheet = screen.getByRole("dialog");
      for (const e of eligible) {
        expect(within(sheet).getByRole("checkbox", { name: e.extraction!.title! })).toBeChecked();
      }
      fireEvent.click(within(sheet).getByRole("checkbox", { name: "Northern Kettle" }));
      fireEvent.click(within(sheet).getByRole("button", { name: "Set edition for selected: none" }));
      fireEvent.click(
        within(screen.getByRole("dialog", { name: "Set edition for selected" })).getByRole("button", {
          name: "Invented Box",
        }),
      );
      fireEvent.click(within(sheet).getByRole("button", { name: "Apply" }));
      await waitFor(() => expect(repo.setItemEdition).toHaveBeenCalledTimes(2));
      expect(repo.setItemEdition.mock.calls.map((c) => c[0]).sort()).toEqual([eligible[0].id, eligible[2].id].sort());
      for (const call of repo.setItemEdition.mock.calls) expect(call[1]).toBe("Invented Box");
      expect(within(sheet).getAllByText("Edition: Invented Box")).toHaveLength(2);

      fireEvent.click(within(sheet).getByRole("button", { name: "Add 2 books" }));
      await waitFor(() => expect(repo.confirmItem).toHaveBeenCalledTimes(2));
      expect(repo.confirmItem.mock.calls.map((c) => c[0]).sort()).toEqual([eligible[0].id, eligible[2].id].sort());
      for (const call of repo.confirmItem.mock.calls) {
        expect(call[2]).toMatchObject({ editionNote: "Invented Box" });
      }
    });
  });

  describe("batch edition", () => {
    it("creates each uploaded photo with the batch's edition", async () => {
      render(<InboxPage />);
      fireEvent.click(await screen.findByRole("button", { name: "Edition for this batch: none" }));
      const picker = screen.getByRole("dialog", { name: "Edition for this batch" });
      fireEvent.change(within(picker).getByLabelText("Filter editions"), { target: { value: "Invented Box" } });
      fireEvent.click(within(picker).getByRole("button", { name: 'Add "Invented Box"' }));
      expect(screen.getByRole("button", { name: "Edition for this batch: Invented Box" })).toBeInTheDocument();
      fireEvent.change(screen.getByLabelText("Choose photos"), { target: { files: files(1) } });
      await waitFor(() => expect(repo.createIntakeItem).toHaveBeenCalledTimes(1));
      expect(repo.createIntakeItem.mock.calls[0][0]).toMatchObject({ editionLabel: "Invented Box" });
    });

    it("links to the barcode scanner", async () => {
      render(<InboxPage />);
      expect(await screen.findByRole("link", { name: "Scan barcodes" })).toHaveAttribute("href", "#/scan");
    });
  });
});

describe("scans saved on this phone (D6, D10)", () => {
  afterEach(() => vi.restoreAllMocks());
  const outbox = (ids: string[]) =>
    localStorage.setItem(
      "tpl_scan_outbox_h1",
      JSON.stringify(
        ids.map((id, n) => ({
          id,
          householdId: "h1",
          batchId: "batch-s",
          ownerUserId: "u1",
          isbn: "9780000000002",
          editionLabel: null,
          extraCopy: false,
          createdAt: `2026-11-10T09:00:0${n}.000Z`,
        })),
      ),
    );

  it("says how many scans wait on this phone while offline", async () => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    outbox(["scan-1", "scan-2"]);
    render(<InboxPage />);
    expect(
      await screen.findByText("2 scans are saved on this phone and will upload when you're online."),
    ).toBeInTheDocument();
    expect(repo.createScanItem).not.toHaveBeenCalled();
  });

  it("uploads them on mount and shows each as a ready scan", async () => {
    outbox(["scan-1"]);
    repo.createScanItem.mockResolvedValue("created");
    photo.lookupIsbn.mockImplementation(() => new Promise(() => {}));
    render(<InboxPage />);
    await waitFor(() => expect(repo.createScanItem).toHaveBeenCalledTimes(1));
    expect(repo.createScanItem.mock.calls[0][0]).toMatchObject({ id: "scan-1", isbn: "9780000000002" });
    await waitFor(() => expect(localStorage.getItem("tpl_scan_outbox_h1")).toBeNull());
    await waitFor(() =>
      expect(screen.queryByText(/saved on this phone and will upload/)).toBeNull(),
    );
    expect(screen.queryByText("No photos yet.")).toBeNull();
  });
});
