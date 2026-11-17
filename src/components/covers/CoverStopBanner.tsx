import { AlertIcon, Button } from "@/components/ui";
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
      className="mx-4 mt-2 flex flex-wrap items-center justify-between gap-2 rounded-md border border-notice-line bg-notice px-3 py-2 text-sm text-fg sm:mx-6"
    >
      <p className="flex min-w-0 flex-1 items-start gap-2">
        <AlertIcon className="mt-0.5 size-5 shrink-0" />
        <span>{COPY[stop]}</span>
      </p>
      {stop !== "budget" && (
        <Button size="sm" onClick={clearStop}>
          Try again
        </Button>
      )}
    </div>
  );
}
