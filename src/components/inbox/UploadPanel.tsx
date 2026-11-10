import { useEffect, useRef, useState } from "react";
import EditionPicker from "@/components/edition/EditionPicker";
import { browserUploadDeps, runUploadBatch, type UploadEntry } from "@/lib/photo/upload-queue";
import type { HouseholdMember } from "@/lib/types";

const OWNER_KEY = "tpl_intake_owner";
const SHARED = "shared";

export const HEIC_TEXT =
  "This photo's format can't be read here. Set the camera to JPEG (\"Most compatible\"), or take the photo from this app.";

function loadOwner(members: HouseholdMember[], fallback: string): string {
  try {
    const saved = localStorage.getItem(OWNER_KEY);
    if (saved === SHARED || members.some((m) => m.userId === saved)) return saved!;
  } catch {
    // Storage blocked: fall back to the uploader.
  }
  return fallback;
}

function saveOwner(value: string) {
  try {
    localStorage.setItem(OWNER_KEY, value);
  } catch {
    // Not remembered; harmless.
  }
}

function rowText(entry: UploadEntry): string {
  switch (entry.state) {
    case "queued":
      return "Waiting";
    case "preparing":
      return "Preparing";
    case "uploading":
      return "Uploading";
    case "duplicate":
      return "Already uploaded";
    case "unreadable":
      if (entry.errorCode === "too_small") return "This photo is too small to read.";
      if (entry.errorCode === "too_large") return "This photo is too large to upload.";
      return HEIC_TEXT;
    case "failed":
      return "Upload failed.";
    default:
      return "";
  }
}

const FINISHED = new Set(["done", "duplicate", "unreadable", "failed"]);

interface Row {
  key: string;
  file: File;
  batchId: string;
  titlePage?: File;
  /** The batch edition when the row was queued, so a retry keeps it. */
  editionLabel: string | null;
  entry: UploadEntry;
}

interface Props {
  householdId: string;
  members: HouseholdMember[];
  userId: string;
  onItemCreated(itemId: string): void;
  onUploadingChange(uploading: boolean): void;
  /** D12: the household's edition labels for the batch picker. */
  labels: string[];
}

/** D10: one file at a time, covers only in batch mode; the title page only in single (camera) mode. */
export default function UploadPanel({
  householdId,
  members,
  userId,
  onItemCreated,
  onUploadingChange,
  labels,
}: Props) {
  const [owner, setOwner] = useState(() => loadOwner(members, userId));
  // D10: component state only; it resets to none on reload, and each item stores its own label.
  const [edition, setEdition] = useState<string | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [cover, setCover] = useState<File | null>(null);
  const [active, setActive] = useState(0);
  const queue = useRef<Promise<void>>(Promise.resolve());
  const runSeq = useRef(0);
  const createdRef = useRef(onItemCreated);
  useEffect(() => {
    createdRef.current = onItemCreated;
  }, [onItemCreated]);

  const uploading = active > 0;
  useEffect(() => {
    onUploadingChange(uploading);
    if (!uploading) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [uploading, onUploadingChange]);

  function enqueue(
    files: File[],
    titlePage?: File,
    batchId: string = crypto.randomUUID(),
    editionLabel: string | null = edition,
  ) {
    if (files.length === 0) return;
    const run = ++runSeq.current;
    const added: Row[] = files.map((file, i) => ({
      key: `r${run}-f${i}`,
      file,
      batchId,
      titlePage,
      editionLabel,
      entry: { key: `r${run}-f${i}`, fileName: file.name, state: "queued", itemId: null },
    }));
    const keys = added.map((r) => r.key);
    // A new selection after everything finished starts a fresh progress list.
    setRows((prev) => (prev.every((r) => FINISHED.has(r.entry.state)) ? added : [...prev, ...added]));
    setActive((n) => n + 1);
    const ownerUserId = owner === SHARED ? null : owner;
    queue.current = queue.current.then(async () => {
      try {
        await runUploadBatch(
          files,
          {
            householdId,
            ownerUserId,
            batchId,
            titlePage,
            editionLabel,
            onChange: (entries) =>
              setRows((prev) =>
                prev.map((r) => {
                  const i = keys.indexOf(r.key);
                  return i < 0 ? r : { ...r, entry: { ...entries[i], key: r.key } };
                }),
              ),
          },
          { ...browserUploadDeps, onItemCreated: (id) => createdRef.current(id) },
        );
      } catch (e) {
        console.error("Upload batch stopped", e instanceof Error ? e.name : "unknown");
      } finally {
        setActive((n) => n - 1);
      }
    });
  }

  function retryFailed() {
    const failed = rows.filter((r) => r.entry.state === "failed");
    setRows((prev) => prev.filter((r) => r.entry.state !== "failed"));
    const byBatch = new Map<string, Row[]>();
    for (const r of failed) byBatch.set(r.batchId, [...(byBatch.get(r.batchId) ?? []), r]);
    for (const [batchId, group] of byBatch) {
      enqueue(
        group.map((r) => r.file),
        group[0].titlePage,
        batchId,
        group[0].editionLabel,
      );
    }
  }

  const total = rows.length;
  const done = rows.filter((r) => FINISHED.has(r.entry.state)).length;
  const pendingRows = rows.filter((r) => r.entry.state !== "done");
  const anyFailed = rows.some((r) => r.entry.state === "failed");
  const uploaded = rows.filter((r) => r.entry.state === "done" || r.entry.state === "duplicate").length;

  return (
    <section aria-labelledby="inbox-upload" className="mb-4 rounded border p-3">
      <h3 id="inbox-upload" className="mb-2 font-semibold">
        Add photos
      </h3>
      <label htmlFor="inbox-owner" className="mb-1 block text-sm">
        Owner
      </label>
      <select
        id="inbox-owner"
        value={owner}
        onChange={(e) => {
          setOwner(e.target.value);
          saveOwner(e.target.value);
        }}
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
        <EditionPicker value={edition} labels={labels} label="Edition for this batch" onChange={setEdition} />
      </div>

      {cover ? (
        <div className="mb-3">
          <p className="mb-2 text-sm">Cover taken.</p>
          <div className="flex flex-wrap gap-2">
            <label className="cursor-pointer rounded border px-3 py-2">
              Add title page
              <input
                type="file"
                accept="image/*"
                capture="environment"
                className="sr-only"
                onChange={(e) => {
                  const page = e.target.files?.[0];
                  e.target.value = "";
                  if (!page) return;
                  enqueue([cover], page);
                  setCover(null);
                }}
              />
            </label>
            <button
              type="button"
              onClick={() => {
                enqueue([cover]);
                setCover(null);
              }}
              className="rounded bg-stone-800 px-3 py-2 text-white"
            >
              Done
            </button>
          </div>
        </div>
      ) : (
        <div className="mb-3 flex flex-wrap gap-2">
          <label className="cursor-pointer rounded bg-stone-800 px-3 py-2 text-white">
            Choose photos
            <input
              type="file"
              accept="image/*"
              multiple
              className="sr-only"
              onChange={(e) => {
                const picked = Array.from(e.target.files ?? []);
                e.target.value = "";
                enqueue(picked);
              }}
            />
          </label>
          <label className="cursor-pointer rounded border px-3 py-2">
            Take a photo
            <input
              type="file"
              accept="image/*"
              capture="environment"
              className="sr-only"
              onChange={(e) => {
                const shot = e.target.files?.[0];
                e.target.value = "";
                if (shot) setCover(shot);
              }}
            />
          </label>
          <a href="#/scan" className="rounded border px-3 py-2">
            Scan barcodes
          </a>
        </div>
      )}

      {uploading && <p className="mb-2 text-sm">Keep this page open until uploads finish.</p>}
      {total > 0 && uploading && (
        <div role="status">
          <p className="mb-1">{`Uploading ${done} of ${total}`}</p>
          <progress className="mb-2 w-full" value={done} max={total} />
        </div>
      )}
      {total > 0 && !uploading && anyFailed && (
        <p role="status" className="mb-1">{`Uploaded ${uploaded} of ${total}`}</p>
      )}
      {pendingRows.length > 0 && (
        <ul className="space-y-1 text-sm">
          {pendingRows.map((r) => (
            <li key={r.key} className="flex justify-between gap-2">
              <span className="truncate">{r.entry.fileName}</span>
              <span className={r.entry.state === "failed" || r.entry.state === "unreadable" ? "text-red-700" : ""}>
                {rowText(r.entry)}
              </span>
            </li>
          ))}
        </ul>
      )}
      {anyFailed && !uploading && (
        <button type="button" onClick={retryFailed} className="mt-2 rounded border px-3 py-1">
          Retry failed uploads
        </button>
      )}
    </section>
  );
}
