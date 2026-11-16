import { CloseIcon } from "./icons";

const BASE = "inline-flex items-center gap-1 rounded-full text-sm min-h-11 sm:min-h-9 px-3 disabled:opacity-50";

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
          className="inline-flex size-6 items-center justify-center rounded-full"
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
