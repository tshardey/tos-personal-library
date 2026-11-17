import { CloseIcon } from "./icons";

// D11: a short label ("All") still gives a 44px-wide target on the phone.
const BASE = "inline-flex items-center justify-center gap-1 rounded-full text-sm min-h-11 min-w-11 sm:min-h-9 sm:min-w-0 px-3";

export function Chip({
  label,
  onRemove,
  pressed,
  onClick,
}: {
  label: string;
  onRemove?: () => void;
  pressed?: boolean;
  onClick?: () => void;
}) {
  if (onRemove) {
    return (
      <span className={`${BASE} bg-control text-fg border border-field`}>
        {label}
        <button
          type="button"
          aria-label={`Remove filter: ${label}`}
          onClick={onRemove}
          className="-mr-3 inline-flex size-11 sm:size-6 items-center justify-center rounded-full"
        >
          <CloseIcon className="size-4" />
        </button>
      </span>
    );
  }
  const tone = pressed ? "bg-accent text-on-accent border border-accent" : "bg-control text-fg border border-field";
  return (
    <button type="button" aria-pressed={pressed} onClick={onClick} className={`${BASE} ${tone}`}>
      {label}
    </button>
  );
}
