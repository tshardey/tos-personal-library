import { useRef } from "react";
import { IconButton, MinusIcon, PlusIcon } from "@/components/ui";
import { COVER_SIZES, type CoverSize } from "@/lib/cover-size";

/** D4: − / + buttons over the five steps, each disabled at its end, with dots showing the step. */
export default function CoverSizeControl({ size, onSize }: { size: CoverSize; onSize(s: CoverSize): void }) {
  const at = COVER_SIZES.indexOf(size);
  const groupRef = useRef<HTMLDivElement>(null);
  // A step that reaches an end disables the pressed button, which would drop focus to the page,
  // so focus moves to the other button (enabled, since this step moved away from its end).
  const step = (by: -1 | 1) => {
    const next = at + by;
    onSize(COVER_SIZES[next]);
    if (next <= 0 || next >= COVER_SIZES.length - 1) {
      groupRef.current?.querySelector<HTMLButtonElement>(`button[aria-label="${by < 0 ? "Larger" : "Smaller"} covers"]`)?.focus();
    }
  };
  return (
    <div ref={groupRef} role="group" aria-label="Cover size" className="flex items-center gap-1">
      <IconButton label="Smaller covers" disabled={at <= 0} onClick={() => step(-1)}>
        <MinusIcon className="size-4" />
      </IconButton>
      <span className="flex items-center gap-1">
        {COVER_SIZES.map((s, i) => (
          <span
            key={s}
            aria-hidden="true"
            data-step={s}
            className={`size-1.5 rounded-full ${i <= at ? "bg-accent" : "bg-control"}`}
          />
        ))}
      </span>
      <IconButton
        label="Larger covers"
        disabled={at >= COVER_SIZES.length - 1}
        onClick={() => step(1)}
      >
        <PlusIcon className="size-4" />
      </IconButton>
    </div>
  );
}
