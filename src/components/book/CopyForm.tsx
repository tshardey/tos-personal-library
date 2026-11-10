import { useState } from "react";
import type { CopyInput, HouseholdMember } from "@/lib/types";
import { normalizeCopyInput } from "@/lib/normalize";

export default function CopyForm({
  initial,
  members,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  initial: CopyInput;
  members: HouseholdMember[];
  submitLabel: string;
  onSubmit(value: CopyInput): Promise<void>;
  onCancel?(): void;
}) {
  const [owner, setOwner] = useState(initial.ownerUserId ?? "");
  const [editionNote, setEditionNote] = useState(initial.editionNote ?? "");
  const [location, setLocation] = useState(initial.location ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await onSubmit(normalizeCopyInput({ ownerUserId: owner, editionNote, copyNote: initial.copyNote, location }));
    } catch (err) {
      console.error("Failed to save copy", err);
      setError("Couldn't save the copy.");
    } finally {
      setBusy(false);
    }
  }

  const input = "mt-1 block w-full rounded border p-2";
  return (
    <form onSubmit={submit} className="space-y-2">
      <label className="block text-sm">
        Owner
        <select value={owner} onChange={(e) => setOwner(e.target.value)} className={input}>
          <option value="">Shared</option>
          {members.map((m) => (
            <option key={m.userId} value={m.userId}>
              {m.displayName}
            </option>
          ))}
        </select>
      </label>
      <label className="block text-sm">
        Edition note
        <input value={editionNote} onChange={(e) => setEditionNote(e.target.value)} className={input} />
      </label>
      <label className="block text-sm">
        Location
        <input value={location} onChange={(e) => setLocation(e.target.value)} className={input} />
      </label>
      {error && (
        <p role="alert" className="text-red-700">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <button type="submit" disabled={busy} className="rounded bg-stone-800 px-3 py-2 text-white">
          {submitLabel}
        </button>
        {onCancel && (
          <button type="button" onClick={onCancel} className="underline">
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}
