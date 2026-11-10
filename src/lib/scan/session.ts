export interface ScanSession {
  householdId: string;
  batchId: string;
  edition: string | null;
  ownerUserId: string | null;
  startedAt: string;
}

const KEY = "tpl_scan_session";

const isStringOrNull = (v: unknown): v is string | null => v === null || typeof v === "string";

function parse(raw: string | null): ScanSession | null {
  if (raw === null) return null;
  try {
    const v = JSON.parse(raw) as Record<string, unknown> | null;
    if (typeof v !== "object" || v === null) return null;
    const { householdId, batchId, edition, ownerUserId, startedAt } = v;
    if (typeof householdId !== "string" || typeof batchId !== "string" || typeof startedAt !== "string") return null;
    if (!isStringOrNull(edition) || !isStringOrNull(ownerUserId)) return null;
    return { householdId, batchId, edition, ownerUserId, startedAt };
  } catch {
    return null;
  }
}

/** D10: a stored session of another household reads as null. */
export function loadSession(householdId: string): ScanSession | null {
  try {
    const s = parse(localStorage.getItem(KEY));
    return s !== null && s.householdId === householdId ? s : null;
  } catch {
    return null;
  }
}

export function saveSession(s: ScanSession): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // Not remembered: a reload starts a new session.
  }
}

export function clearSession(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // Nothing to clear when storage is blocked.
  }
}
