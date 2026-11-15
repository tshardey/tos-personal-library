import type { LibraryView } from "@/lib/library-view";
import type { HouseholdMember } from "@/lib/types";
import type { ReadState } from "./types";

export interface ReadStatusOption {
  /** Stable select value: `any`, or `<userId>:<state>`. */
  value: string;
  label: string;
  readStatus: LibraryView["readStatus"];
}

/** D10: `Any read status`, then me, then each other member in household order. */
export function readStatusOptions(members: HouseholdMember[], me: string): ReadStatusOption[] {
  const block = (userId: string, who: string, mine: boolean): ReadStatusOption[] => {
    const states: [ReadState, string][] = [
      ["unread", `Unread by ${who}`],
      ["read", `Read by ${who}`],
      ["dnf", mine ? "Did not finish (me)" : `Did not finish (${who})`],
    ];
    return states.map(([state, label]) => ({ value: `${userId}:${state}`, label, readStatus: { userId, state } }));
  };
  return [
    { value: "any", label: "Any read status", readStatus: null },
    ...block(me, "me", true),
    ...members.filter((m) => m.userId !== me).flatMap((m) => block(m.userId, m.displayName, false)),
  ];
}
