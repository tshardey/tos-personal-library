import type { ButtonHTMLAttributes, ReactNode } from "react";

export function IconButton({
  label,
  children,
  className = "",
  type = "button",
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; children: ReactNode }) {
  return (
    <button
      type={type}
      aria-label={label}
      className={`inline-flex size-11 sm:size-9 items-center justify-center rounded-md text-fg hover:bg-control disabled:opacity-50 disabled:cursor-not-allowed ${className}`.trim()}
      {...rest}
    >
      {children}
    </button>
  );
}
