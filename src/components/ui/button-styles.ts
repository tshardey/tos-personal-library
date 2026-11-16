export type Variant = "primary" | "secondary" | "ghost" | "danger";
export type Size = "md" | "sm";

const BASE =
  "inline-flex items-center justify-center gap-2 rounded-md text-sm font-medium disabled:cursor-not-allowed";

// A disabled primary reads as a plain control (muted on control is 4.59:1, D2); faded amber looks muddy.
const VARIANT: Record<Variant, string> = {
  primary: "bg-accent text-on-accent disabled:bg-control disabled:text-muted",
  secondary: "bg-control text-fg border border-field disabled:opacity-50",
  ghost: "text-fg hover:bg-control disabled:opacity-50",
  danger: "bg-danger-surface text-danger border border-danger disabled:opacity-50",
};

const SIZE: Record<Size, string> = {
  md: "min-h-11 sm:min-h-9 px-4",
  sm: "min-h-11 sm:min-h-9 px-3",
};

export function buttonClass(variant: Variant = "secondary", size: Size = "md"): string {
  return `${BASE} ${VARIANT[variant]} ${SIZE[size]}`;
}

