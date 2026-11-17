import { useEffect, useRef } from "react";
import type { KeyboardEvent, ReactNode, RefObject } from "react";
import { createPortal } from "react-dom";

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** FOCUSABLE minus controls disabled by a `<fieldset disabled>` around them, which `[disabled]` can't see. */
function focusables(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => !el.matches(":disabled"));
}

/**
 * The page behind doesn't scroll while any sheet is open. Open sheets are counted: the first saves
 * the body's overflow and the last to close restores it. A per-sheet saved value would break for
 * nested sheets that mount together, since React runs the inner sheet's effect first.
 */
let openSheets = 0;
let savedOverflow = "";

function lockBodyScroll() {
  if (openSheets === 0) {
    savedOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
  }
  openSheets++;
  return () => {
    openSheets--;
    if (openSheets === 0) document.body.style.overflow = savedOverflow;
  };
}

export function Sheet({
  label,
  title,
  onClose,
  children,
  footer,
  initialFocus,
  className = "",
  dismissOnScrim = true,
}: {
  label: string;
  title?: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  initialFocus?: RefObject<HTMLElement | null>;
  className?: string;
  /** False for forms with unsaved input: a tap on the scrim then does nothing (Escape still closes). */
  dismissOnScrim?: boolean;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const target =
      initialFocus?.current ?? (dialogRef.current ? focusables(dialogRef.current)[0] : undefined);
    (target ?? dialogRef.current)?.focus();
    return () => {
      // The opener may have gone (a row removed by the action the sheet took).
      if (opener?.isConnected) opener.focus();
    };
    // Focus is captured and restored once per mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(lockBodyScroll, []);

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === "Escape") {
      e.stopPropagation();
      onClose();
      return;
    }
    if (e.key !== "Tab") return;
    const items = focusables(e.currentTarget);
    if (items.length === 0) {
      e.preventDefault();
      return;
    }
    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement;
    if (e.shiftKey && (active === first || active === e.currentTarget)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus();
    }
  }

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      <div
        data-testid="sheet-scrim"
        aria-hidden="true"
        className="absolute inset-0 bg-black/60"
        onClick={dismissOnScrim ? onClose : undefined}
      />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
        onKeyDown={onKeyDown}
        className={`relative flex w-full max-h-[85dvh] flex-col rounded-t-xl border border-line-strong bg-raised pb-[env(safe-area-inset-bottom)] text-fg sm:max-w-lg sm:rounded-xl ${className}`.trim()}
      >
        {title && (
          <h2 className="px-4 pt-4 text-lg font-semibold text-fg-strong">{title}</h2>
        )}
        <div className="overflow-y-auto p-4">{children}</div>
        {footer && (
          <div className="sticky bottom-0 flex flex-wrap justify-end gap-2 border-t border-line-strong bg-raised p-4">
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
