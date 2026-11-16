import { useRef, useState } from "react";
import { readStoryGraphFile, StoryGraphFileError, type ParsedHistory } from "@/lib/reading/storygraph";
import { uploadHistoryBatch } from "@/lib/reading/reading-repo";
import type { UploadCounts } from "@/lib/reading/types";

const BATCH = 500;

const ERROR_COPY: Record<string, string> = {
  not_text: "That file isn't a CSV.",
  empty: "That export has no books in it.",
  too_large: "That file is over 10 MB.",
  too_many_rows: "That export has more than 20,000 rows.",
  malformed: "That file couldn't be read as a CSV.",
};

function errorText(err: unknown): string {
  if (err instanceof StoryGraphFileError) {
    if (err.code === "not_storygraph") {
      return `This doesn't look like a StoryGraph export. Missing column: ${err.missing.join(", ")}.`;
    }
    return ERROR_COPY[err.code] ?? ERROR_COPY.malformed;
  }
  return ERROR_COPY.malformed;
}

interface Props {
  householdId: string;
  /** Called when batches stop, with what finished (also after a stopped upload that applied some). */
  onDone(counts: UploadCounts): void;
}

export default function HistoryUpload({ householdId, onDone }: Props) {
  const [parsed, setParsed] = useState<ParsedHistory | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [result, setResult] = useState<{ counts: UploadCounts; skipped: number } | null>(null);
  const [stopped, setStopped] = useState<{ done: number; total: number } | null>(null);
  const busy = useRef(false);

  async function choose(file: File | undefined) {
    if (busy.current) return;
    setParsed(null);
    setParseError(null);
    setResult(null);
    setStopped(null);
    if (!file) return;
    try {
      setParsed(await readStoryGraphFile(file));
    } catch (err) {
      console.error("StoryGraph file failed", err instanceof Error ? err.name : "unknown");
      setParseError(errorText(err));
    }
  }

  async function upload() {
    if (busy.current || !parsed || parsed.rows.length === 0) return;
    busy.current = true;
    const { rows, skipped } = parsed;
    const total = rows.length;
    const sum: UploadCounts = { rows: 0, matched: 0, applied: 0, possible: 0, unmatched: 0 };
    let done = 0;
    setResult(null);
    setStopped(null);
    setProgress({ done, total });
    try {
      for (let i = 0; i < total; i += BATCH) {
        const c = await uploadHistoryBatch(householdId, rows.slice(i, i + BATCH));
        sum.rows += c.rows;
        sum.matched += c.matched;
        sum.applied += c.applied;
        sum.possible += c.possible;
        sum.unmatched += c.unmatched;
        done = Math.min(i + BATCH, total);
        setProgress({ done, total });
      }
      setResult({ counts: sum, skipped });
    } catch (err) {
      console.error("History upload failed", err instanceof Error ? err.name : "unknown");
      setStopped({ done, total });
    } finally {
      busy.current = false;
      setProgress(null);
      if (done > 0) onDone(sum);
    }
  }

  return (
    <section aria-label="Upload StoryGraph export" className="space-y-2 rounded border p-3">
      <h3 className="font-medium">Upload StoryGraph export</h3>
      <p className="text-sm text-muted">
        Export your library from StoryGraph, then choose the CSV file here. Only each book's title, authors, ISBN, read
        status and last date read are sent. Reviews, ratings and everything else stay on this device.
      </p>
      <label className="block text-sm">
        StoryGraph CSV file
        <input
          type="file"
          accept=".csv,text/csv"
          disabled={progress !== null}
          onChange={(e) => void choose(e.target.files?.[0])}
          className="mt-1 block w-full"
        />
      </label>
      {parseError && (
        <p role="alert" className="text-sm text-danger">
          {parseError}
        </p>
      )}
      {parsed && (
        <>
          <p className="text-sm">{`${parsed.rows.length} books read or not finished. ${parsed.skipped} to-read or currently reading will be skipped.`}</p>
          {parsed.rows.length > 0 && (
            <button
              type="button"
              disabled={progress !== null}
              onClick={() => void upload()}
              className="min-h-10 rounded bg-accent px-3 text-on-accent disabled:opacity-50"
            >
              Upload
            </button>
          )}
        </>
      )}
      {progress && <p role="status" className="text-sm">{`Uploading ${progress.done} of ${progress.total}…`}</p>}
      {stopped && (
        <p role="alert" className="text-sm text-danger">
          {`Upload stopped after ${stopped.done} of ${stopped.total}. Try again; nothing is duplicated.`}
        </p>
      )}
      {result && (
        <ul className="text-sm">
          <li>{`${result.counts.matched} matched books you own (${result.counts.applied} newly marked)`}</li>
          <li>{`${result.counts.possible} possible matches to review`}</li>
          <li>{`${result.counts.unmatched} kept for later, for books not on the shelf yet`}</li>
          <li>{`${result.skipped} skipped (to-read or currently reading)`}</li>
        </ul>
      )}
    </section>
  );
}
