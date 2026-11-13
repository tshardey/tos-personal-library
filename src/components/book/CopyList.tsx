import { useRef, useState } from "react";
import { deleteBook, deleteCopy, setCopyFlags, updateCopy } from "@/lib/library-repo";
import { diffPatch, markEdited } from "@/lib/edited-fields";
import { normalizeCopyInput } from "@/lib/normalize";
import type { Copy, CopyInput, HouseholdMember } from "@/lib/types";
import { isUnhauled } from "@/lib/copy-flags";
import { dayLabel, localDay } from "@/lib/date-added";
import type { CopyFlagsPatch } from "@/lib/types";
import CopyForm from "./CopyForm";

const EDITABLE: (keyof CopyInput)[] = ["ownerUserId", "editionNote", "copyNote", "location"];

function ownerLabel(ownerUserId: string | null, members: HouseholdMember[]): string {
  if (ownerUserId === null) return "Shared";
  return members.find((m) => m.userId === ownerUserId)?.displayName ?? "Unknown";
}

export default function CopyList({
  copies,
  members,
  labels,
  onChanged,
  onBookDeleted,
}: {
  copies: Copy[];
  members: HouseholdMember[];
  labels: string[];
  onChanged(): void | Promise<void>;
  onBookDeleted(): void;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pendingRef = useRef<Set<string>>(new Set());
  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set());
  // A ref-like guard that updates synchronously, so a double tap in one render still writes once.
  const pending = pendingRef.current;

  async function remove(copy: Copy) {
    setError(null);
    try {
      if (copies.length === 1 && window.confirm("Remove this book from the library too?")) {
        await deleteBook(copy.bookId);
        onBookDeleted();
        return;
      }
      await deleteCopy(copy.id);
      await onChanged();
    } catch (err) {
      console.error("Failed to delete copy", err);
      setError("Couldn't remove the copy.");
    }
  }

  async function toggle(copy: Copy, patch: CopyFlagsPatch) {
    if (pending.has(copy.id)) return;
    pending.add(copy.id);
    setPendingIds(new Set(pending));
    setError(null);
    try {
      await setCopyFlags(copy, patch);
      await onChanged();
    } catch (err) {
      console.error("Failed to save copy flags", err instanceof Error ? err.name : "unknown");
      setError("Couldn't save the copy.");
    } finally {
      pending.delete(copy.id);
      setPendingIds(new Set(pending));
    }
  }

  async function save(copy: Copy, next: CopyInput) {
    const before: CopyInput = normalizeCopyInput({
      ownerUserId: copy.ownerUserId,
      editionNote: copy.editionNote,
      copyNote: copy.copyNote,
      location: copy.location,
    });
    const { changed, patch } = diffPatch(before, next, EDITABLE);
    await updateCopy(copy.id, patch, markEdited(copy.userEditedFields, changed));
    setEditingId(null);
    await onChanged();
  }

  return (
    <div className="mt-2">
      {error && (
        <p role="alert" className="mb-2 text-red-700">
          {error}
        </p>
      )}
      <ul className="space-y-3">
        {copies.map((copy) => (
          <li
            key={copy.id}
            data-unhauled={isUnhauled(copy) ? "true" : undefined}
            className={`rounded border p-3 ${isUnhauled(copy) ? "opacity-60" : ""}`}
          >
            {editingId === copy.id ? (
              <CopyForm
                initial={copy}
                members={members}
                labels={labels}
                submitLabel="Save copy"
                onSubmit={(v) => save(copy, v)}
                onCancel={() => setEditingId(null)}
              />
            ) : (
              <>
                <p className="font-medium">{ownerLabel(copy.ownerUserId, members)}</p>
                {copy.editionNote && <p className="text-sm">{copy.editionNote}</p>}
                {copy.copyNote && <p className="text-sm text-stone-700">{copy.copyNote}</p>}
                {copy.location && <p className="text-sm">Location: {copy.location}</p>}
                <p className="text-xs text-stone-600">Origin: {copy.origin}</p>
                {copy.unhauledAt && <p className="text-sm">Unhauled {dayLabel(localDay(copy.unhauledAt))}</p>}
                <div className="mt-2 flex gap-2 text-sm">
                  {(["deluxe", "signed"] as const).map((flag) => (
                    <button
                      key={flag}
                      type="button"
                      aria-pressed={copy[flag]}
                      disabled={pendingIds.has(copy.id)}
                      onClick={() => void toggle(copy, { [flag]: !copy[flag] })}
                      className={`rounded border px-2 py-1 ${copy[flag] ? "bg-stone-800 text-white" : ""}`}
                    >
                      {flag === "deluxe" ? "Deluxe" : "Signed"}
                    </button>
                  ))}
                  <button
                    type="button"
                    disabled={pendingIds.has(copy.id)}
                    onClick={() =>
                      void toggle(copy, { unhauledAt: isUnhauled(copy) ? null : new Date().toISOString() })
                    }
                    className="rounded border px-2 py-1"
                  >
                    {isUnhauled(copy) ? "Undo unhaul" : "Unhaul"}
                  </button>
                </div>
                <div className="mt-2 flex gap-3 text-sm">
                  <button type="button" onClick={() => setEditingId(copy.id)} className="underline">
                    Edit copy
                  </button>
                  <button type="button" onClick={() => void remove(copy)} className="underline">
                    Delete copy
                  </button>
                </div>
              </>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
