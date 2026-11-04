import { useState } from "react";
import { useHousehold } from "@/contexts/HouseholdContext";

export default function InviteCode() {
  const { household } = useHousehold();
  const [copied, setCopied] = useState(false);
  if (!household) return null;
  const code = household.inviteCode;

  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      <span>Invite code:</span>
      <code className="rounded bg-stone-100 px-2 py-1">{code}</code>
      <button type="button" onClick={() => void copy()} className="underline">
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}
