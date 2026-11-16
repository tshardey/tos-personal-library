import { useMemo } from "react";
import { useHousehold } from "@/contexts/HouseholdContext";
import { useReading } from "@/contexts/ReadingContext";
import { useTagging } from "@/contexts/TaggingContext";
import InviteCode from "@/components/household/InviteCode";
import { Button, Sheet } from "@/components/ui";
import { readCatalogCache } from "@/lib/catalog-cache";
import { localDay } from "@/lib/date-added";
import { readingStats } from "@/lib/reading/stats";

const linkClass = "flex min-h-11 items-center rounded-md px-3 text-sm text-fg hover:bg-control";

interface Props {
  email: string | undefined;
  onSignOut(): void;
  onNavigate(): void;
}

/** The More list (D7), shared by the phone sheet and the desktop menu. Mounted only while open. */
export function MoreContent({ email, onSignOut, onNavigate }: Props) {
  const { available: taggingAvailable } = useTagging();
  const { household } = useHousehold();
  const { available: readingAvailable, byBook, userId } = useReading();

  // From the cached catalogue (no fetch); omitted when it is missing or the member owns nothing.
  const summary = useMemo(() => {
    if (!readingAvailable || userId === null) return null;
    const cache = readCatalogCache(household?.id ?? null);
    if (cache === null) return null;
    const s = readingStats(cache.books, byBook, userId, { today: localDay(new Date().toISOString()), since: null });
    return s.owned === 0 ? null : s;
  }, [readingAvailable, byBook, userId, household?.id]);

  const links = [
    readingAvailable && { href: "#/reading", label: "Reading history" },
    taggingAvailable && { href: "#/tags", label: "Tag suggestions" },
    { href: "#/editions", label: "Edition labels" },
    { href: "#/import", label: "Import" },
    { href: "#/inbox", label: "Photos" },
  ].filter((l) => l !== false);

  return (
    <div className="flex flex-col gap-3">
      {summary && (
        <p className="px-3 text-sm text-muted">
          {`You've read ${summary.read} of ${summary.owned} (${summary.pct}%)`}
        </p>
      )}
      <div className="flex flex-col gap-1">
        {links.map((l) => (
          <a key={l.href} href={l.href} onClick={onNavigate} className={linkClass}>
            {l.label}
          </a>
        ))}
      </div>
      <div className="flex flex-col gap-3 border-t border-line px-3 pt-3 text-sm">
        <p className="break-words text-muted">{email}</p>
        <InviteCode />
        <Button variant="secondary" onClick={onSignOut}>
          Sign out
        </Button>
      </div>
    </div>
  );
}

/** The phone's More sheet. */
export default function MoreMenu({ onClose, ...props }: Omit<Props, "onNavigate"> & { onClose(): void }) {
  return (
    <Sheet label="More" title="More" onClose={onClose}>
      <MoreContent {...props} onNavigate={onClose} />
    </Sheet>
  );
}
