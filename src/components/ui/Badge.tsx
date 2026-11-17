import type { ReactNode } from "react";

const TONE = {
  accent: "bg-accent text-on-accent",
  success: "bg-control text-success",
  muted: "bg-control text-muted",
  overlay: "bg-surface/85 text-fg",
  "overlay-success": "bg-surface/85 text-success",
};

export function Badge({
  children,
  tone = "muted",
  className = "",
}: {
  children: ReactNode;
  tone?: keyof typeof TONE;
  className?: string;
}) {
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${TONE[tone]} ${className}`.trim()}>
      {children}
    </span>
  );
}
