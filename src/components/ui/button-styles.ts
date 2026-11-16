export type Variant = "primary" | "secondary" | "ghost" | "danger";
export type Size = "md" | "sm";

const BASE =
  "inline-flex items-center justify-center gap-2 rounded-md text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed";

const VARIANT: Record<Variant, string> = {
  primary: "bg-accent text-on-accent",
  secondary: "bg-control text-fg border border-field",
  ghost: "text-fg hover:bg-control",
  danger: "bg-danger-surface text-danger border border-danger",
};

const SIZE: Record<Size, string> = {
  md: "min-h-11 sm:min-h-9 px-4",
  sm: "min-h-11 sm:min-h-9 px-3",
};

export function buttonClass(variant: Variant = "secondary", size: Size = "md"): string {
  return `${BASE} ${VARIANT[variant]} ${SIZE[size]}`;
}

