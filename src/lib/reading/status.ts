import type { ReadState, ReadStatusMap, ReadStatusRow } from "./types";

/** The one place a stored `cleared` becomes unread. */
export function effectiveStatus(row: ReadStatusRow | undefined): ReadState {
  if (!row || row.status === "cleared") return "unread";
  return row.status;
}

export function toStatusMap(rows: ReadStatusRow[]): ReadStatusMap {
  const map: ReadStatusMap = new Map();
  for (const row of rows) {
    const state = effectiveStatus(row);
    if (state === "unread") continue;
    let members = map.get(row.bookId);
    if (!members) map.set(row.bookId, (members = new Map()));
    members.set(row.userId, { state, finishedOn: row.finishedOn });
  }
  return map;
}

export function stateFor(map: ReadStatusMap, bookId: string, userId: string): ReadState {
  return map.get(bookId)?.get(userId)?.state ?? "unread";
}
