import { isbnFromBarcode } from "./isbn-input";

/** D4: sliding; every read of an ISBN, even an ignored one, refreshes its last-seen time. */
export const REPEAT_WINDOW_MS = 3000;
export const NUDGE_AFTER_MS = 8000;
export const IDLE_PAUSE_MS = 120_000;
export const DECODE_GAP_MS = 120;

export type GateVerdict =
  | { kind: "ignored" }
  | { kind: "not_isbn" }
  | { kind: "add"; isbn13: string }
  | { kind: "ask_another_copy"; isbn13: string };

export interface ReadGate {
  onBarcode(text: string, now: number, sessionIsbns: ReadonlySet<string>): GateVerdict;
  onTyped(isbn13: string, sessionIsbns: ReadonlySet<string>): GateVerdict;
}

const fresh = (isbn13: string, sessionIsbns: ReadonlySet<string>): GateVerdict =>
  sessionIsbns.has(isbn13) ? { kind: "ask_another_copy", isbn13 } : { kind: "add", isbn13 };

/** Pure apart from its own last-seen map (D4, Review Focus 1). */
export function createReadGate(windowMs: number = REPEAT_WINDOW_MS): ReadGate {
  const lastSeen = new Map<string, number>();
  return {
    onBarcode(text, now, sessionIsbns) {
      const verdict = isbnFromBarcode(text);
      if (verdict.kind === "not_isbn") return { kind: "not_isbn" };
      const { isbn13 } = verdict;
      const prev = lastSeen.get(isbn13);
      lastSeen.set(isbn13, now);
      if (prev !== undefined && now - prev < windowMs) return { kind: "ignored" };
      return fresh(isbn13, sessionIsbns);
    },
    onTyped(isbn13, sessionIsbns) {
      return fresh(isbn13, sessionIsbns);
    },
  };
}

/** `since` is the latest of camera start, the last accepted read and the last nudge dismissal. */
export function nudgeDue(now: number, since: number): boolean {
  return now - since >= NUDGE_AFTER_MS;
}

export function idleDue(now: number, lastActivity: number): boolean {
  return now - lastActivity >= IDLE_PAUSE_MS;
}
