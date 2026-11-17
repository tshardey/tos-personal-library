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
      <span className="whitespace-nowrap">Invite code:</span>
      <code className="rounded bg-control px-2 py-1">{code}</code>
      <button type="button" onClick={() => void copy()} className="inline-flex min-h-11 min-w-11 items-center justify-center underline sm:min-h-0 sm:min-w-0">
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}
