import { coverPath, createIntakeItem, sourceHashExists, titlePagePath, uploadPhoto } from "./intake-repo";
import { PhotoError, preparePhoto, type PhotoErrorCode } from "./prepare";

export type UploadState = "queued" | "preparing" | "uploading" | "done" | "duplicate" | "unreadable" | "failed";

export interface UploadEntry {
  key: string;
  fileName: string;
  state: UploadState;
  itemId: string | null;
  /** Set with `unreadable`, so the UI can pick the right copy. */
  errorCode?: PhotoErrorCode;
}

export interface UploadDeps {
  prepare: typeof preparePhoto;
  upload: typeof uploadPhoto;
  create: typeof createIntakeItem;
  exists: typeof sourceHashExists;
  newId(): string;
  sleep(ms: number): Promise<void>;
  onItemCreated(itemId: string): void;
}

export const browserUploadDeps: UploadDeps = {
  prepare: preparePhoto,
  upload: uploadPhoto,
  create: createIntakeItem,
  exists: sourceHashExists,
  newId: () => crypto.randomUUID(),
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  onItemCreated: () => {},
};

const BACKOFF_MS = [2000, 8000, 30000];

async function withRetry(fn: () => Promise<void>, sleep: UploadDeps["sleep"]): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (e) {
      if (attempt >= BACKOFF_MS.length) throw e;
      await sleep(BACKOFF_MS[attempt]);
    }
  }
}

export async function runUploadBatch(
  files: File[],
  opts: {
    householdId: string;
    ownerUserId: string | null;
    batchId: string;
    titlePage?: File;
    onChange(entries: UploadEntry[]): void;
  },
  deps: UploadDeps = browserUploadDeps,
): Promise<UploadEntry[]> {
  const entries: UploadEntry[] = files.map((f, i) => ({
    key: `f${i}`,
    fileName: f.name,
    state: "queued",
    itemId: null,
  }));
  const emit = () => opts.onChange(entries.map((e) => ({ ...e })));
  const set = (e: UploadEntry, state: UploadState) => {
    e.state = state;
    emit();
  };
  emit();

  const seen = new Set<string>();
  for (let i = 0; i < files.length; i++) {
    const entry = entries[i];
    try {
      set(entry, "preparing");
      const cover = await deps.prepare(files[i]);
      if (seen.has(cover.sourceHash)) {
        set(entry, "duplicate");
        continue;
      }
      // A prior run (or killed tab) may already have stored this photo; skip the upload entirely.
      // If the lookup itself fails the entry is marked failed, and a re-run retries it.
      if (await deps.exists(opts.householdId, cover.sourceHash)) {
        seen.add(cover.sourceHash);
        set(entry, "duplicate");
        continue;
      }
      const title = opts.titlePage ? await deps.prepare(opts.titlePage) : null;

      const id = deps.newId();
      set(entry, "uploading");
      const coverKey = coverPath(opts.householdId, id);
      await withRetry(() => deps.upload(coverKey, cover.blob), deps.sleep);
      let titleKey: string | null = null;
      if (title) {
        titleKey = titlePagePath(opts.householdId, id);
        const blob = title.blob;
        const key = titleKey;
        await withRetry(() => deps.upload(key, blob), deps.sleep);
      }
      const result = await deps.create({
        id,
        householdId: opts.householdId,
        batchId: opts.batchId,
        ownerUserId: opts.ownerUserId,
        coverPath: coverKey,
        titlePagePath: titleKey,
        sourceHash: cover.sourceHash,
      });
      seen.add(cover.sourceHash);
      if (result === "duplicate") {
        set(entry, "duplicate");
      } else {
        entry.itemId = id;
        set(entry, "done");
        try {
          deps.onItemCreated(id);
        } catch (e) {
          console.error("onItemCreated failed", (e as Error | undefined)?.name);
        }
      }
    } catch (e) {
      if (e instanceof PhotoError) {
        entry.errorCode = e.code;
        set(entry, "unreadable");
      } else {
        const code = (e as { code?: unknown; status?: unknown } | null) ?? {};
        console.error("photo upload failed", (e as Error | null)?.name, code.code ?? code.status);
        set(entry, "failed");
      }
    }
  }
  return entries;
}
