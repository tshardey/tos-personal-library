import { useEffect, useId, useRef, useState } from "react";
import type { FocusEvent, KeyboardEvent, ReactNode } from "react";

export function Menu({
  label,
  button,
  align = "start",
  children,
  current,
}: {
  label: string;
  button: ReactNode;
  align?: "start" | "end";
  children: (close: () => void) => ReactNode;
  current?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (open && e.key === "Escape") {
      e.stopPropagation();
      setOpen(false);
      buttonRef.current?.focus();
    }
  }

  // Tabbing out closes the menu. A blur with no relatedTarget (a click on panel text, or focus
  // leaving the window) is left to the outside-pointerdown handler.
  function onBlur(e: FocusEvent<HTMLDivElement>) {
    const next = e.relatedTarget as Node | null;
    if (open && next && !e.currentTarget.contains(next)) setOpen(false);
  }

  return (
    <div ref={rootRef} className="relative" onKeyDown={onKeyDown} onBlur={onBlur}>
      <button
        ref={buttonRef}
        type="button"
        aria-label={label}
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        aria-current={current ? "page" : undefined}
        onClick={() => setOpen((o) => !o)}
        className="inline-flex min-h-11 sm:min-h-9 items-center gap-1 rounded-md px-3 text-fg hover:bg-control"
      >
        {button}
      </button>
      {open && (
        <div
          id={panelId}
          className={`absolute z-40 mt-1 min-w-56 rounded-lg border border-line-strong bg-raised p-2 shadow-lg ${align === "end" ? "right-0" : "left-0"}`}
        >
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}
