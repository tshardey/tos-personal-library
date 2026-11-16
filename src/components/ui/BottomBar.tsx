import type { ReactNode } from "react";

/** A fixed bar that sits above the phone tab bar (D7). `label` makes it a named region. */
export function BottomBar({ label, children }: { label?: string; children: ReactNode }) {
  return (
    <div
      {...(label ? { role: "region", "aria-label": label } : {})}
      className="fixed inset-x-0 bottom-[var(--nav-bottom)] z-20 border-t border-line bg-raised p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]"
    >
      {children}
    </div>
  );
}
