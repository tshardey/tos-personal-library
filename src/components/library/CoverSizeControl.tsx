import { IconButton, MinusIcon, PlusIcon } from "@/components/ui";
import { COVER_SIZES, type CoverSize } from "@/lib/cover-size";

/** D4: − / + buttons over the five steps, each disabled at its end, with dots showing the step. */
export default function CoverSizeControl({ size, onSize }: { size: CoverSize; onSize(s: CoverSize): void }) {
  const at = COVER_SIZES.indexOf(size);
  return (
    <div role="group" aria-label="Cover size" className="flex items-center gap-1">
      <IconButton label="Smaller covers" disabled={at <= 0} onClick={() => onSize(COVER_SIZES[at - 1])}>
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
        onClick={() => onSize(COVER_SIZES[at + 1])}
      >
        <PlusIcon className="size-4" />
      </IconButton>
    </div>
  );
}
