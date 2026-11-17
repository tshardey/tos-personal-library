import { Button, CheckIcon } from "@/components/ui";
import type { YourReading } from "./useYourReading";

export default function MarkReadButton({
  reading,
  onShowReading,
  disabled = false,
}: {
  reading: YourReading;
  onShowReading(): void;
  disabled?: boolean;
}) {
  if (!reading.available) return null;
  const { state } = reading.shown;
  const off = disabled || reading.busy;
  if (state === "unread") {
    return (
      <Button variant="secondary" disabled={off} onClick={() => reading.choose("read")}>
        Mark read
      </Button>
    );
  }
  const label = state === "read" ? "Read" : "Did not finish";
  return (
    <Button
      variant="secondary"
      aria-label={`Your reading: ${label}`}
      disabled={off}
      onClick={onShowReading}
    >
      {state === "read" && <CheckIcon className="size-4" />}
      {label}
    </Button>
  );
}
