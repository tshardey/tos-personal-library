import { useCoverFinder } from "@/contexts/CoverFinderContext";
import type { CoverStop } from "@/lib/covers/drain";

const COPY: Record<Exclude<CoverStop, null>, string> = {
  budget: "This month's cover-finding budget is used up. The rest wait for next month or a manual retry.",
  misconfigured: "Cover finding isn't set up yet.",
  billing: "Cover finding stopped: the Claude account's spending limit is reached.",
  rejected: "Cover finding stopped: the requests were refused. Check the Claude workspace limit, then try again.",
};

/** Shown under the tab bar when the session's drain has stopped. */
export default function CoverStopBanner() {
  const { available, stop, clearStop } = useCoverFinder();
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
