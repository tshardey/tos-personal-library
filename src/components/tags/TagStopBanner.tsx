import { AlertIcon, Button } from "@/components/ui";
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
