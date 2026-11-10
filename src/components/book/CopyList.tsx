import { useState } from "react";
import { deleteBook, deleteCopy, updateCopy } from "@/lib/library-repo";
import { diffPatch, markEdited } from "@/lib/edited-fields";
import { normalizeCopyInput } from "@/lib/normalize";
import type { Copy, CopyInput, HouseholdMember } from "@/lib/types";
import CopyForm from "./CopyForm";

const EDITABLE: (keyof CopyInput)[] = ["ownerUserId", "editionNote", "location"];

function ownerLabel(ownerUserId: string | null, members: HouseholdMember[]): string {
  if (ownerUserId === null) return "Shared";
  return members.find((m) => m.userId === ownerUserId)?.displayName ?? "Unknown";
}

export default function CopyList({
  copies,
  members,
  onChanged,
  onBookDeleted,
}: {
  copies: Copy[];
  members: HouseholdMember[];
  onChanged(): void | Promise<void>;
  onBookDeleted(): void;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

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
    <div>
      {error && (
        <p role="alert" className="mb-2 text-red-700">
          {error}
        </p>
      )}
      <ul className="space-y-3">
        {copies.map((copy) => (
          <li key={copy.id} className="rounded border p-3">
            {editingId === copy.id ? (
              <CopyForm
                initial={copy}
                members={members}
                submitLabel="Save copy"
                onSubmit={(v) => save(copy, v)}
                onCancel={() => setEditingId(null)}
              />
            ) : (
              <>
                <p className="font-medium">{ownerLabel(copy.ownerUserId, members)}</p>
                {copy.editionNote && <p className="text-sm">{copy.editionNote}</p>}
                {copy.location && <p className="text-sm">Location: {copy.location}</p>}
                <p className="text-xs text-stone-600">Origin: {copy.origin}</p>
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
