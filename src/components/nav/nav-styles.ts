/** A bottom tab bar item: icon over a text-xs label, a 44px+ target, accent when current (D7). */
export function barItemClass(current: boolean): string {
  return `flex min-h-11 min-w-11 flex-1 flex-col items-center justify-center gap-0.5 text-xs ${
    current ? "text-accent" : "text-muted hover:text-fg"
  }`;
}

/** A top nav link. The label inside it carries the underline, so links and Menu buttons match. */
export const topLinkClass = "inline-flex min-h-9 items-center rounded-md px-3 hover:bg-control";

/** The top nav label: an accent underline when current (D7). */
export function topLabelClass(current: boolean): string {
  return `border-b-2 py-1 ${current ? "border-accent text-fg-strong" : "border-transparent text-muted"}`;
}
