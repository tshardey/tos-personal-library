import type { SelectHTMLAttributes } from "react";

export function Select({
  label,
  className = "",
  ...rest
}: SelectHTMLAttributes<HTMLSelectElement> & { label?: string }) {
  return (
    <select
      aria-label={label}
      className={`min-h-11 sm:min-h-9 rounded-md border border-field bg-control px-3 text-sm text-fg disabled:opacity-50 ${className}`.trim()}
      {...rest}
    />
  );
}
