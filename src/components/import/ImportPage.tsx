import { useMemo, useRef, useState } from "react";
import { useHousehold } from "@/contexts/HouseholdContext";
import { googleBooksApiKey } from "@/lib/google-books";
import { enrichMissing } from "@/lib/libib/enrich";
import { applyImportPlan, type ApplyResult } from "@/lib/libib/apply";
import { loadSavedMapping, saveMapping, suggestOwners, type CollectionMapping } from "@/lib/libib/owner-map";
import { LibibFileError, readLibibFile, type LibibFileErrorCode, type ParsedFile } from "@/lib/libib/parse";
import {
  buildImportPlan,
  sameSummary,
  type ImportSummary,
  type ReviewDecision,
} from "@/lib/libib/plan";
import { libibStore, listBooks, listLibibLedger } from "@/lib/library-repo";
import { routeToHash } from "@/lib/router";
import type { BookWithCopies } from "@/lib/types";
import ImportPreview from "./ImportPreview";

const LOAD_FAILED = "Couldn't read the library, so nothing was imported.";
const CHANGED =
  "The library changed while you were reviewing. Check the updated summary, then confirm again.";
const FAILED =
  "The import stopped partway. Everything saved so far is kept, and running it again adds only what's missing.";

function fileErrorText(err: LibibFileError): string {
  const text: Record<Exclude<LibibFileErrorCode, "not_libib">, string> = {
    not_text: "This isn't a CSV file. In libib, use Export, then upload the .csv it gives you.",
    empty: "This file has no books in it.",
    malformed: "This file looks damaged, so nothing was imported. Try exporting it from libib again.",
    too_large: "This file is too big to be a libib export (over 10 MB).",
    too_many_rows: "This file has more than 10,000 rows, which is too many to import at once.",
  };
  if (err.code === "not_libib") {
    return `This doesn't look like a libib export. Missing column: ${err.missingColumns[0]}.`;
  }
  return text[err.code];
}

type Lookup =
  | { status: "idle" }
  | { status: "running"; progress: { done: number; total: number } | null }
  | { status: "done"; looked: number; filled: number }
  | { status: "failed" };

type Stage =
  | { name: "pick"; error: string | null }
  | { name: "loading" }
  | { name: "preview"; notice: string | null }
  | { name: "writing"; progress: { done: number; total: number } | null }
  | { name: "done"; summary: ImportSummary; result: ApplyResult }
  | { name: "failed"; error: string | null };

interface Snapshot {
  catalog: BookWithCopies[];
  ledger: Map<string, number>;
}

async function readSnapshot(householdId: string): Promise<Snapshot> {
  const [catalog, ledger] = await Promise.all([listBooks(householdId), listLibibLedger(householdId)]);
  return { catalog, ledger };
}

export default function ImportPage() {
  const { household, members } = useHousehold();
  const householdId = household?.id ?? null;
  const [stage, setStage] = useState<Stage>({ name: "pick", error: null });
  const [file, setFile] = useState<ParsedFile | null>(null);
  const [snapshot, setSnapshot] = useState<Snapshot>({ catalog: [], ledger: new Map() });
  const [mapping, setMapping] = useState<CollectionMapping>({});
  const [decisions, setDecisions] = useState<Map<string, ReviewDecision>>(new Map());
  const [restore, setRestore] = useState<Set<string>>(new Set());
  const busy = useRef(false);
  const lookupBusy = useRef(false);
  const [lookup, setLookup] = useState<Lookup>({ status: "idle" });

  const plan = useMemo(
    () =>
      file
        ? buildImportPlan({
            file,
            catalog: snapshot.catalog,
            ledger: snapshot.ledger,
            mapping,
            decisions,
            restore,
          })
        : null,
    [file, snapshot, mapping, decisions, restore],
  );

  if (!householdId) return null;

  /**
   * Fetches the catalog and ledger. A failure shows the load error with nothing planned: on `pick`
   * for a fresh file, but on `failed` for a retry, so the in-memory choices stay reachable.
   */
  async function load(parsed: ParsedFile, retry = false) {
    setStage({ name: "loading" });
    try {
      setSnapshot(await readSnapshot(householdId!));
    } catch (err) {
      console.error("Failed to read the library for import", err);
      setStage(retry ? { name: "failed", error: LOAD_FAILED } : { name: "pick", error: LOAD_FAILED });
      return;
    }
    setFile(parsed);
    setStage({ name: "preview", notice: null });
  }

  async function onPick(picked: File) {
    setStage({ name: "loading" });
    let parsed: ParsedFile;
    try {
      parsed = await readLibibFile(picked);
    } catch (err) {
      if (err instanceof LibibFileError) {
        setStage({ name: "pick", error: fileErrorText(err) });
        return;
      }
      console.error("Failed to read the import file", err);
      setStage({ name: "pick", error: "Couldn't read that file." });
      return;
    }
    setMapping(suggestOwners(parsed.collections, members, loadSavedMapping(householdId!)));
    setDecisions(new Map());
    setRestore(new Set());
    await load(parsed);
  }

  async function onConfirm() {
    if (!file || busy.current) return;
    busy.current = true;
    try {
      saveMapping(householdId!, mapping);
      let fresh: Snapshot;
      try {
        fresh = await readSnapshot(householdId!);
      } catch (err) {
        console.error("Failed to re-read the library before importing", err);
        setStage({ name: "preview", notice: LOAD_FAILED });
        return;
      }
      const current = buildImportPlan({
        file,
        catalog: fresh.catalog,
        ledger: fresh.ledger,
        mapping,
        decisions,
        restore,
      });
      if (!plan || !sameSummary(plan.summary, current.summary)) {
        setSnapshot(fresh);
        setStage({ name: "preview", notice: CHANGED });
        return;
      }
      setStage({ name: "writing", progress: null });
      try {
        const result = await applyImportPlan(current, householdId!, libibStore, {
          newId: () => crypto.randomUUID(),
          onProgress: (done, total) => setStage({ name: "writing", progress: { done, total } }),
        });
        setSnapshot(fresh);
        setStage({ name: "done", summary: current.summary, result });
        setLookup({ status: "idle" });
        void runLookup();
      } catch (err) {
        console.error("Import failed", err);
        setStage({ name: "failed", error: null });
      }
    } finally {
      busy.current = false;
    }
  }

  /**
   * Re-reads the household's books and fills missing covers and synopses from OpenLibrary, then
   * Google Books when a key is configured. Started
   * from handlers only (never an effect), and a lookup already under way is not doubled. Any
   * failure here is a lookup failure: the import itself is already complete.
   */
  async function runLookup() {
    if (lookupBusy.current) return;
    lookupBusy.current = true;
    setLookup({ status: "running", progress: null });
    try {
      const books = await listBooks(householdId!);
      const r = await enrichMissing(books, libibStore, {
        fetchImpl: (...args) => fetch(...args),
        googleBooksKey: googleBooksApiKey(),
        onProgress: (done, total) => setLookup({ status: "running", progress: { done, total } }),
      });
      setLookup(r.failed ? { status: "failed" } : { status: "done", looked: r.looked, filled: r.filled });
    } catch (err) {
      console.error("Failed to read the library for the cover lookup", err);
      setLookup({ status: "failed" });
    } finally {
      lookupBusy.current = false;
    }
  }

  const sources = googleBooksApiKey() ? "OpenLibrary and Google Books" : "OpenLibrary";

  function lookupStatus(failedPrefix: string) {
    if (lookup.status === "running" && lookup.progress) {
      return (
        <>
          <p role="status" className="mb-2">
            {`Looking up covers on ${sources}. ${lookup.progress.done} of ${lookup.progress.total} books.`}
          </p>
          <p className="mb-2 text-sm">
            Covers keep arriving after you leave this page. Reload the library to see them.
          </p>
        </>
      );
    }
    if (lookup.status === "done" && lookup.looked > 0) {
      return <p className="mb-2">{`Found details for ${lookup.filled} of ${lookup.looked} books.`}</p>;
    }
    if (lookup.status === "failed") {
      return (
        <div className="mb-2">
          <p>{failedPrefix}</p>
          <button type="button" onClick={() => void runLookup()} className="mt-1 rounded border px-3 py-1">
            Try again
          </button>
        </div>
      );
    }
    return null;
  }

  function reset() {
    setFile(null);
    setStage({ name: "pick", error: null });
  }

  if (stage.name === "pick") {
    return (
      <div className="p-4">
        <h2 className="mb-3 text-lg font-semibold">Import from libib</h2>
        <p className="mb-3">In libib, use Export, then upload the .csv it gives you.</p>
        {stage.error && (
          <p role="alert" className="mb-3 text-red-700">
            {stage.error}
          </p>
        )}
        <label htmlFor="libib-file" className="mb-1 block text-sm">
          libib CSV file
        </label>
        <input
          id="libib-file"
          type="file"
          accept=".csv,text/csv"
          onChange={(e) => {
            const picked = e.target.files?.[0];
            e.target.value = "";
            if (picked) void onPick(picked);
          }}
          className="block w-full"
        />
        <p className="mb-2 mt-6 text-sm">
          Already imported? This looks up ISBNs on {sources} to fill in missing covers and descriptions.
        </p>
        <button
          type="button"
          disabled={lookup.status === "running"}
          onClick={() => void runLookup()}
          className="mb-2 rounded border px-3 py-2 disabled:opacity-50"
        >
          Find missing covers
        </button>
        {lookupStatus(`The ${sources} lookup didn't finish.`)}
      </div>
    );
  }

  if (stage.name === "loading") return <p className="p-6">Reading the file and the library…</p>;

  if (stage.name === "writing") {
    const { progress } = stage;
    return (
      <div className="p-6" role="status">
        <p className="mb-2">{progress ? `Importing… ${progress.done} of ${progress.total}` : "Importing…"}</p>
        <progress className="w-full" value={progress?.done} max={progress?.total} />
      </div>
    );
  }

  if (stage.name === "done") {
    const { summary, result } = stage;
    return (
      <div className="p-4">
        <h2 className="mb-2 text-lg font-semibold">Import complete</h2>
        <p className="mb-2">
          {`Added ${summary.newBooks} ${summary.newBooks === 1 ? "new book" : "new books"} and ${summary.newCopies} extra ${summary.newCopies === 1 ? "copy" : "copies"}.`}
        </p>
        {result.patchesSkipped.length > 0 && (
          <div className="mb-2">
            <p>These books changed while importing, so their details weren't filled in:</p>
            <ul className="list-disc pl-6">
              {result.patchesSkipped.map((title, i) => (
                <li key={`${title}-${i}`}>{title}</li>
              ))}
            </ul>
          </div>
        )}
        {lookupStatus(`Your import is complete, but the ${sources} lookup didn't finish.`)}
        <a href={routeToHash({ name: "library" })} className="underline">
          Back to the library
        </a>
      </div>
    );
  }

  if (stage.name === "failed") {
    return (
      <div className="p-4">
        <p role="alert" className="mb-3 text-red-700">
          {FAILED}
        </p>
        {stage.error && (
          <p role="alert" className="mb-3 text-red-700">
            {stage.error}
          </p>
        )}
        <button
          type="button"
          onClick={() => file && void load(file, true)}
          className="rounded bg-stone-800 px-3 py-2 text-white"
        >
          Run it again
        </button>
      </div>
    );
  }

  if (!file || !plan) return null;
  return (
    <ImportPreview
      file={file}
      plan={plan}
      catalog={snapshot.catalog}
      members={members}
      mapping={mapping}
      restore={restore}
      notice={stage.notice}
      onMapping={(collection, choice) => setMapping((m) => ({ ...m, [collection]: choice }))}
      onDecision={(libibId, decision) => setDecisions((d) => new Map(d).set(libibId, decision))}
      onRestore={(libibId, on) =>
        setRestore((r) => {
          const next = new Set(r);
          if (on) next.add(libibId);
          else next.delete(libibId);
          return next;
        })
      }
      onConfirm={() => void onConfirm()}
      onReset={reset}
    />
  );
}
