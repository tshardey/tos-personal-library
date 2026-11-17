import { Button, CheckIcon } from "@/components/ui";
import type { YourReading } from "./useYourReading";

export default function MarkReadButton({ reading, onShowReading }: { reading: YourReading; onShowReading(): void }) {
  if (!reading.available) return null;
  const { state } = reading.shown;
  if (state === "unread") {
    return (
      <Button variant="secondary" disabled={reading.busy} onClick={() => reading.choose("read")}>
        Mark read
      </Button>
    );
  }
  const label = state === "read" ? "Read" : "Did not finish";
  return (
    <Button
      variant="secondary"
      aria-label={`Your reading: ${label}`}
      disabled={reading.busy}
      onClick={onShowReading}
    >
      {state === "read" && <CheckIcon />}
      {label}
    </Button>
  );
}
