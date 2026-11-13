import { useLayoutEffect, useRef, type RefObject } from "react";
import { takeScrollAnchor, type ScrollAnchor } from "@/lib/library-view";

/** How long heights changing under the list (the invite code, tags, a refresh) are corrected for. */
export const RESTORE_WINDOW_MS = 2000;
/** The person's own input: restoring stops at once, so their scrolling always wins. */
export const STOP_EVENTS = ["wheel", "touchstart", "pointerdown", "keydown"] as const;

function cardFor(container: HTMLElement | null, bookId: string): Element | null {
  if (!container) return null;
  for (const el of container.querySelectorAll("[data-book-id]")) {
    if (el.getAttribute("data-book-id") === bookId) return el;
  }
  return null;
}

/**
 * D9: once `ready`, takes the saved anchor (once) and scrolls so the clicked card's top is back
 * where it was. A different view, or a card no longer listed, falls back to the saved scrollY. It
 * re-applies on every resize of the container or the page for RESTORE_WINDOW_MS, and stops on the
 * first STOP_EVENTS input.
 */
export function useRestoreScroll(ready: boolean, viewKey: string, container: RefObject<HTMLElement | null>): void {
  // Held in refs, not effect locals: StrictMode re-runs the effect, and the anchor is taken only once.
  const anchorRef = useRef<ScrollAnchor | null>(null);
  const doneRef = useRef(false);

  useLayoutEffect(() => {
    history.scrollRestoration = "manual";
  }, []);

  useLayoutEffect(() => {
    if (!ready || doneRef.current) return;
    anchorRef.current ??= takeScrollAnchor();
    const anchor = anchorRef.current;
    if (!anchor) {
      doneRef.current = true;
      return;
    }

    const apply = () => {
      const card = anchor.viewKey === viewKey ? cardFor(container.current, anchor.bookId) : null;
      const top = card ? window.scrollY + card.getBoundingClientRect().top - anchor.top : anchor.scrollY;
      window.scrollTo({ top, left: 0, behavior: "instant" });
    };
    apply();

    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => apply());
    if (container.current) observer?.observe(container.current);
    observer?.observe(document.body);

    const teardown = () => {
      observer?.disconnect();
      window.clearTimeout(timer);
      for (const type of STOP_EVENTS) window.removeEventListener(type, finish, true);
    };
    const finish = () => {
      doneRef.current = true;
      anchorRef.current = null;
      teardown();
    };
    const timer = window.setTimeout(finish, RESTORE_WINDOW_MS);
    for (const type of STOP_EVENTS) window.addEventListener(type, finish, { capture: true, passive: true });
    return teardown;
  }, [ready, viewKey, container]);
}
