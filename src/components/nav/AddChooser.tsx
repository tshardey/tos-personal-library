import { useId } from "react";
import { Sheet } from "@/components/ui";

const LINKS = [
  { href: "#/add", label: "Type it in", hint: "Title, author or ISBN" },
  { href: "#/inbox", label: "Photos", hint: "Read books from photos" },
  { href: "#/import", label: "Import", hint: "A libib CSV export" },
];

function AddLink({ href, label, hint, onNavigate }: (typeof LINKS)[number] & { onNavigate(): void }) {
  const id = useId();
  return (
    <a
      href={href}
      onClick={onNavigate}
      aria-labelledby={`${id}-label`}
      aria-describedby={`${id}-hint`}
      className="flex min-h-11 flex-col justify-center rounded-md px-3 py-2 hover:bg-control"
    >
      <span id={`${id}-label`} className="text-sm font-medium text-fg-strong">
        {label}
      </span>
      <span id={`${id}-hint`} className="text-xs text-muted">
        {hint}
      </span>
    </a>
  );
}

/** The three ways to add books (D7), shared by the phone sheet and the desktop menu. */
export function AddLinks({ onNavigate }: { onNavigate(): void }) {
  return (
    <div className="flex flex-col gap-1">
      {LINKS.map((l) => (
        <AddLink key={l.href} {...l} onNavigate={onNavigate} />
      ))}
    </div>
  );
}

/** The phone's Add chooser. */
export default function AddChooser({ onClose }: { onClose(): void }) {
  return (
    <Sheet label="Add books" title="Add books" onClose={onClose}>
      <AddLinks onNavigate={onClose} />
    </Sheet>
  );
}
