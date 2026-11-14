import { useTagging } from "@/contexts/TaggingContext";
import type { TagStop } from "@/lib/tagging/drain";

const COPY: Record<Exclude<TagStop, null>, string> = {
  budget:
    "This month's tagging budget is used up. The rest carry on next month.",
  misconfigured: "Tagging isn't set up yet.",
  billing: "Tagging stopped: the Claude account's spending limit is reached.",
  rejected:
    "Tagging stopped: the requests were refused. Check the Claude workspace limit, then try again.",
};

/** Shown under the cover banner when the session's tagging drain has stopped. */
export default function TagStopBanner() {
  const { available, stop, clearStop } = useTagging();
  if (!available || stop === null) return null;
  return (
    <div
      role="status"
      className="flex flex-wrap items-center justify-between gap-2 border-b bg-amber-50 px-3 py-2 text-sm text-amber-900 sm:px-4"
    >
      <p>{COPY[stop]}</p>
      {stop !== "budget" && (
        <button
          type="button"
          onClick={clearStop}
          className="min-h-10 rounded border border-amber-300 bg-white px-3 text-amber-900"
        >
          Try again
        </button>
      )}
    </div>
  );
}
