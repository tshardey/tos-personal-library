import type { ImportPlan, ImportSummary, ReviewDecision } from "@/lib/libib/plan";
import { planState } from "@/lib/libib/plan";
import type { CollectionMapping } from "@/lib/libib/owner-map";
import type { ParsedFile, RowWarning, SkipReason } from "@/lib/libib/parse";
import type { BookWithCopies, HouseholdMember } from "@/lib/types";
import ReviewList from "./ReviewList";

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

function summaryLine(s: ImportSummary): string {
  let line = [
    plural(s.newBooks, "new book", "new books"),
    plural(s.newCopies, "extra copy", "extra copies"),
    `${s.unchanged} unchanged`,
    `${s.review} to review`,
  ].join(", ");
  if (s.filled > 0) line += `, ${s.filled} with details to fill`;
  if (s.removed > 0) line += `, ${s.removed} removed earlier`;
  return line;
}

const SKIP_TEXT: Record<SkipReason, string> = {
  missing_id: "no id",
  missing_title: "no title",
  wrong_column_count: "wrong number of columns",
  not_a_book: "not a book",
};

const WARNING_TEXT: Record<RowWarning, string> = {
  invalid_isbn: "ISBN looks damaged, so it was ignored",
  unreadable_copies: "copies count couldn't be read",
  duplicate_id: "id appears more than once in the file",
};

const collectionLabel = (c: string) => (c === "" ? "(no collection)" : c);

interface Props {
  file: ParsedFile;
  plan: ImportPlan;
  catalog: BookWithCopies[];
  members: HouseholdMember[];
  mapping: CollectionMapping;
  restore: Set<string>;
  notice: string | null;
  onMapping(collection: string, choice: string): void;
  onDecision(libibId: string, decision: ReviewDecision): void;
  onRestore(libibId: string, on: boolean): void;
  onConfirm(): void;
  onReset(): void;
}

export default function ImportPreview(p: Props) {
  const { file, plan } = p;
  const state = planState(plan);
  const unmapped = file.collections.filter((c) => p.mapping[c] === undefined);
  // A ticked row leaves plan.removed but stays listed, or it couldn't be unticked.
  const removedIds = new Set([...plan.removed.map((r) => r.libibId), ...p.restore]);
  const removedRows = file.rows.filter((r) => removedIds.has(r.libibId));
  // Until every collection has an owner the plan leaves those rows out, so "nothing to do" isn't known.
  const awaitingOwner = unmapped.length > 0;
  const nothingToImport =
    state === "nothing" && (plan.summary.skippedCollection > 0 || file.skipped.length > 0);

  return (
    <div className="p-4">
      <h2 className="mb-3 text-lg font-semibold">Import from libib</h2>
      {p.notice && (
        <p role="alert" className="mb-3 rounded border border-amber-300 bg-amber-50 p-2">
          {p.notice}
        </p>
      )}
      {file.spreadsheetDamage && (
        <p role="alert" className="mb-3 text-red-700">
          Some ISBNs look damaged, which usually means the file was opened in Excel. Export it from libib
          again and upload that file directly.
        </p>
      )}

      <div className="mb-4 space-y-2">
        {file.collections.map((collection, index) => {
          const id = `owner-${index}`;
          return (
            <div key={collection}>
              <label htmlFor={id} className="block text-sm">
                {`Owner for ${collectionLabel(collection)}`}
              </label>
              <select
                id={id}
                value={p.mapping[collection] ?? ""}
                onChange={(e) => p.onMapping(collection, e.target.value)}
                className="w-full rounded border p-2"
              >
                <option value="" disabled>
                  Choose…
                </option>
                {p.members.map((m) => (
                  <option key={m.userId} value={m.userId}>
                    {m.displayName}
                  </option>
                ))}
                <option value="shared">Shared</option>
                <option value="skip">Skip this collection</option>
              </select>
              {p.mapping[collection] === undefined && (
                <p className="text-sm text-red-700">{`Choose an owner for ${collectionLabel(collection)}.`}</p>
              )}
            </div>
          );
        })}
      </div>

      {!awaitingOwner && <p className="mb-2 font-medium">{summaryLine(plan.summary)}</p>}
      {state === "nothing" &&
        !awaitingOwner &&
        (nothingToImport ? (
          <p className="mb-3">Nothing to import from this file.</p>
        ) : (
          <p className="mb-3">Everything in this file is already in the library.</p>
        ))}
      {state === "ledger_only" && (
        <p className="mb-3">
          These books are all here, but an earlier import didn't finish recording them.
        </p>
      )}

      {plan.newBooks.length > 0 && (
        <section aria-labelledby="import-new" className="mb-4">
          <h3 id="import-new" className="mb-2 font-semibold">
            New books
          </h3>
          <ul className="space-y-1">
            {plan.newBooks.map((b) => (
              <li key={b.libibId}>
                {b.input.title}
                {b.input.authors.length > 0 && (
                  <span className="text-stone-600">{` — ${b.input.authors.join(", ")}`}</span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      <ReviewList items={plan.review} catalog={p.catalog} onChoose={p.onDecision} />

      {removedRows.length > 0 && (
        <section aria-labelledby="import-removed" className="mb-4">
          <h3 id="import-removed" className="mb-1 font-semibold">
            Removed here earlier, staying removed
          </h3>
          <ul>
            {removedRows.map((r) => (
              <li key={r.libibId}>
                <label className="flex items-start gap-2 py-1">
                  <input
                    type="checkbox"
                    checked={p.restore.has(r.libibId)}
                    onChange={(e) => p.onRestore(r.libibId, e.target.checked)}
                    className="mt-1"
                  />
                  <span>
                    {r.book.title}
                    <span className="text-stone-600"> — Import again</span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
        </section>
      )}

      {file.skipped.length > 0 && (
        <section aria-labelledby="import-skipped" className="mb-4">
          <h3 id="import-skipped" className="mb-1 font-semibold">
            Skipped rows
          </h3>
          <ul className="text-sm">
            {file.skipped.map((s) => (
              <li key={s.rowNumber}>
                {`Row ${s.rowNumber}: ${s.title ?? "(no title)"}, ${SKIP_TEXT[s.reason]}`}
              </li>
            ))}
          </ul>
        </section>
      )}

      {file.warnings.length > 0 && (
        <section aria-labelledby="import-warnings" className="mb-4">
          <h3 id="import-warnings" className="mb-1 font-semibold">
            Warnings
          </h3>
          <ul className="text-sm">
            {file.warnings.map((w, i) => (
              <li key={`${w.rowNumber}-${i}`}>{`Row ${w.rowNumber}: ${w.title}, ${WARNING_TEXT[w.warning]}`}</li>
            ))}
          </ul>
        </section>
      )}

      <div className="flex gap-3">
        {(state === "writes" || state === "ledger_only" || awaitingOwner) && (
          <button
            type="button"
            onClick={p.onConfirm}
            disabled={awaitingOwner}
            className="rounded bg-stone-800 px-3 py-2 text-white disabled:opacity-50"
          >
            {state === "ledger_only" ? "Finish the earlier import" : "Import"}
          </button>
        )}
        <button type="button" onClick={p.onReset} className="rounded border px-3 py-2">
          Choose a different file
        </button>
      </div>
    </div>
  );
}
