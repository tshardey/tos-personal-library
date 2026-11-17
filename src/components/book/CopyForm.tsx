import { useState } from "react";
import { Button, Select } from "@/components/ui";
import type { CopyInput, HouseholdMember } from "@/lib/types";
import { normalizeCopyInput } from "@/lib/normalize";
import EditionPicker from "@/components/edition/EditionPicker";

export default function CopyForm({
  initial,
  members,
  labels,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  initial: CopyInput;
  members: HouseholdMember[];
  labels: string[];
  submitLabel: string;
  onSubmit(value: CopyInput): Promise<void>;
  onCancel?(): void;
}) {
  const [owner, setOwner] = useState(initial.ownerUserId ?? "");
  const [editionNote, setEditionNote] = useState<string | null>(initial.editionNote);
  const [copyNote, setCopyNote] = useState(initial.copyNote ?? "");
  const [location, setLocation] = useState(initial.location ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await onSubmit(normalizeCopyInput({ ownerUserId: owner, editionNote, copyNote, location }));
    } catch (err) {
      console.error("Failed to save copy", err);
      setError("Couldn't save the copy.");
    } finally {
      setBusy(false);
    }
  }

  const input = "mt-1 block w-full min-h-11 sm:min-h-9 rounded-md border border-field bg-control px-3 text-sm text-fg";
  return (
    <form onSubmit={submit} className="space-y-2">
      <label className="block text-sm">
        Owner
        <Select value={owner} onChange={(e) => setOwner(e.target.value)} className="mt-1 block w-full">
          <option value="">Shared</option>
          {members.map((m) => (
            <option key={m.userId} value={m.userId}>
              {m.displayName}
            </option>
          ))}
        </Select>
      </label>
      <EditionPicker value={editionNote} labels={labels} onChange={setEditionNote} />
      <label className="block text-sm">
        Copy note
        <textarea
          value={copyNote}
          onChange={(e) => setCopyNote(e.target.value)}
          placeholder="Sprayed edges, signed, damage…"
          rows={2}
          className={input + " py-2"}
        />
      </label>
      <label className="block text-sm">
        Location
        <input value={location} onChange={(e) => setLocation(e.target.value)} className={input} />
      </label>
      {error && (
        <p role="alert" className="rounded-md bg-danger-surface p-3 text-danger">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <Button type="submit" variant="primary" disabled={busy}>
          {submitLabel}
        </Button>
        {onCancel && (
          <Button variant="ghost" onClick={onCancel} className="underline">
            Cancel
          </Button>
        )}
      </div>
    </form>
  );
}
