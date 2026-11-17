import { useReading } from "@/contexts/ReadingContext";
import { useTagging } from "@/contexts/TaggingContext";
import InviteCode from "@/components/household/InviteCode";
import ReadSummary from "@/components/reading/ReadSummary";
import { Button, Sheet } from "@/components/ui";

const linkClass = "flex min-h-11 items-center rounded-md px-3 text-sm text-fg hover:bg-control";

interface Props {
  email: string | undefined;
  onSignOut(): void;
  onNavigate(): void;
}

/** The More list (D7), shared by the phone sheet and the desktop menu. Mounted only while open. */
export function MoreContent({ email, onSignOut, onNavigate }: Props) {
  const { available: taggingAvailable } = useTagging();
  const { available: readingAvailable } = useReading();

  const links = [
    readingAvailable && { href: "#/reading", label: "Reading history" },
    taggingAvailable && { href: "#/tags", label: "Tag suggestions" },
    { href: "#/editions", label: "Edition labels" },
    { href: "#/import", label: "Import" },
    { href: "#/inbox", label: "Photos" },
  ].filter((l) => l !== false);

  return (
    <div className="flex flex-col gap-3">
      <ReadSummary className="px-3 text-sm text-muted" />
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
