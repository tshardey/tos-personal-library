import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useHousehold } from "@/contexts/HouseholdContext";
import { useIntake } from "@/hooks/useIntake";
import { bulkEligible, proposeMatch } from "@/lib/photo/propose";
import type { IntakeItem } from "@/lib/photo/types";
import { holdWakeLock } from "@/lib/photo/wake-lock";
import BulkConfirmSheet, { type BulkEntry } from "./BulkConfirmSheet";
import IntakeCard from "./IntakeCard";
import UploadPanel from "./UploadPanel";

const DAY_MS = 24 * 3600_000;
const OPEN = new Set(["pending", "processing", "ready", "failed"]);

const STOP_TEXT = {
  daily_cap: "Today's photo limit is reached (500). The rest will be read tomorrow.",
  misconfigured: "Photo reading isn't set up yet. Photos are saved and will be read once it is.",
} as const;

/** Newest batch first; within a batch, in upload order. */
function ordered(items: IntakeItem[]): IntakeItem[] {
  const newest = new Map<string, string>();
  for (const i of items) {
    const seen = newest.get(i.batchId);
    if (!seen || i.createdAt > seen) newest.set(i.batchId, i.createdAt);
  }
  return [...items].sort(
    (a, b) =>
      newest.get(b.batchId)!.localeCompare(newest.get(a.batchId)!) ||
      a.batchId.localeCompare(b.batchId) ||
      a.createdAt.localeCompare(b.createdAt) ||
      a.id.localeCompare(b.id),
  );
}

export default function InboxPage() {
  const { household, members } = useHousehold();
  const { user } = useAuth();
  const intake = useIntake();
  const { items, catalog, status, thumbs } = intake;
  const [uploading, setUploading] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkResult, setBulkResult] = useState<string | null>(null);

  const keepAwake = uploading || intake.reading;
  useEffect(() => {
    if (!keepAwake) return;
    const lock = holdWakeLock();
    return () => lock.release();
  }, [keepAwake]);

  const openItems = useMemo(() => items.filter((i) => OPEN.has(i.status)), [items]);
  const groups = useMemo(() => {
    const now = Date.now();
    const sorted = ordered(items);
    return {
      review: sorted.filter((i) => i.status === "ready" || i.status === "failed"),
      reading: sorted.filter((i) => i.status === "pending" || i.status === "processing"),
      done: sorted.filter(
        (i) =>
          (i.status === "confirmed" || i.status === "discarded") &&
          now - new Date(i.updatedAt ?? i.createdAt).getTime() < DAY_MS,
      ),
    };
  }, [items]);

  const eligible = useMemo(
    () =>
      groups.review
        .flatMap((item): BulkEntry[] => {
          const input = { item, catalog, openItems };
          const proposal = proposeMatch(input);
          if (!bulkEligible(input, proposal)) return [];
          // What runBulkConfirm writes: the proposal's title and authors (a scan's come from its
          // lookup) and the item's own edition label. D12: Claude's clues never prefill it.
          return [
            {
              id: item.id,
              title: proposal.query.title,
              authors: proposal.query.authors,
              editionNote: item.editionLabel ?? "",
            },
          ];
        }),
    [groups.review, catalog, openItems],
  );

  const onUploadingChange = useCallback((u: boolean) => setUploading(u), []);

  if (!household || !user) return null;

  if (status === "loading") return <p className="p-6">Loading…</p>;
  if (status === "error") {
    return (
      <div className="p-6">
        <p role="alert" className="mb-3 text-red-700">
          Couldn't reach the photo inbox.
        </p>
        <button
          type="button"
          onClick={() => void intake.reload().catch(() => {})}
          className="rounded bg-stone-800 px-3 py-2 text-white"
        >
          Retry
        </button>
      </div>
    );
  }
  // After a later failed read the page stays (uploads keep going), but nothing is confirmed
  // against data that may be stale: a failed read must never look like "no matches".
  const { stale } = intake;

  async function runBulk(ids: string[]) {
    setBulkBusy(true);
    try {
      const r = await intake.bulkConfirm(ids);
      const added = `Added ${r.confirmed} ${r.confirmed === 1 ? "new book" : "new books"}.`;
      setBulkResult(r.skipped > 0 ? `${added} ${r.skipped} left to review.` : added);
    } catch {
      setBulkResult("The bulk add stopped. Anything not added is still in the inbox.");
    } finally {
      setBulkBusy(false);
      setSheetOpen(false);
    }
  }

  const card = (item: IntakeItem) => (
    <li key={item.id}>
      <IntakeCard
        item={item}
        catalog={catalog}
        openItems={openItems}
        members={members}
        thumbUrl={item.coverPath ? thumbs.get(item.coverPath) : undefined}
        lookupPaused={intake.lookupPaused}
        lookupFailed={intake.lookupFailed.has(item.id)}
        stale={stale}
        onConfirm={intake.confirm}
        onRetry={intake.retry}
        onOwner={intake.setOwner}
        labels={intake.labels}
        onEdition={intake.setEdition}
      />
    </li>
  );

  const section = (id: string, title: string, list: IntakeItem[]) =>
    list.length > 0 && (
      <section aria-labelledby={id} className="mb-4">
        <h3 id={id} className="mb-2 font-semibold">
          {title}
        </h3>
        <ul className="space-y-3">{list.map(card)}</ul>
      </section>
    );

  return (
    <div className="mx-auto max-w-2xl p-4">
      <h2 className="mb-3 text-lg font-semibold">Photo inbox</h2>
      <UploadPanel
        householdId={household.id}
        members={members}
        userId={user.id}
        onItemCreated={intake.processNew}
        onUploadingChange={onUploadingChange}
        labels={intake.labels}
      />

      {stale && (
        <div role="alert" className="mb-3 flex items-center gap-2 rounded border border-red-300 bg-red-50 p-2 text-sm">
          <span className="text-red-700">Couldn't reach the photo inbox.</span>
          <button
            type="button"
            onClick={() => void intake.reload().catch(() => {})}
            className="rounded border px-2 py-1"
          >
            Retry
          </button>
        </div>
      )}
      {intake.stop && (
        <p role="status" className="mb-3 rounded border border-amber-400 bg-amber-50 p-2 text-sm">
          {STOP_TEXT[intake.stop]}
        </p>
      )}
      {intake.lookupPaused && (
        <div className="mb-3 flex items-center gap-2 rounded border p-2 text-sm">
          <span>Online lookup paused. It will retry.</span>
          <button type="button" onClick={intake.resumeLookups} className="rounded border px-2 py-1">
            Retry
          </button>
        </div>
      )}

      {eligible.length >= 2 && (
        <button
          type="button"
          disabled={stale}
          onClick={() => {
            setBulkResult(null);
            setSheetOpen(true);
          }}
          className="mb-3 rounded bg-stone-800 px-3 py-2 text-white disabled:opacity-50"
        >
          {`Add ${eligible.length} new books`}
        </button>
      )}
      {bulkResult && (
        <p role="status" className="mb-3 text-sm">
          {bulkResult}
        </p>
      )}
      {sheetOpen && (
        <BulkConfirmSheet
          entries={eligible}
          labels={intake.labels}
          busy={bulkBusy || stale}
          onConfirm={(ids) => void runBulk(ids)}
          onSetEdition={(ids, label) => {
            for (const id of ids) intake.setEdition(id, label);
          }}
          onCancel={() => setSheetOpen(false)}
        />
      )}

      {items.length === 0 && <p className="mb-3 text-sm text-stone-600">No photos yet.</p>}
      {section("inbox-review", "To review", groups.review)}
      {section("inbox-reading", "Reading", groups.reading)}
      {section("inbox-done", "Done today", groups.done)}
    </div>
  );
}
