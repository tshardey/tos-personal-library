import type { HouseholdMember } from "../types";
import { baseNormalize } from "./match-keys";

export type OwnerChoice = string /* member userId */ | "shared" | "skip";
export type CollectionMapping = Record<string, OwnerChoice | undefined>;

const STORAGE_KEY = "tpl_libib_owner_map";

/** Normalised words of a name, ignoring a possessive 's. */
const nameKey = (s: string): string => baseNormalize(s.replace(/['’]s\b/gi, ""));

/** Per collection: a saved choice (if still valid), else the one member whose name is a whole word of it, else unset. */
export function suggestOwners(
  collections: string[],
  members: HouseholdMember[],
  saved: CollectionMapping,
): CollectionMapping {
  const out: CollectionMapping = {};
  for (const collection of collections) {
    const choice = saved[collection];
    if (choice === "skip" || choice === "shared" || (choice && members.some((m) => m.userId === choice))) {
      out[collection] = choice;
      continue;
    }
    const ck = ` ${nameKey(collection)} `;
    const hits =
      ck.trim() === ""
        ? []
        : members.filter((m) => {
            const dk = nameKey(m.displayName);
            return dk !== "" && ck.includes(` ${dk} `);
          });
    out[collection] = hits.length === 1 ? hits[0].userId : undefined;
  }
  return out;
}

function readAll(): Record<string, CollectionMapping> {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, CollectionMapping>)
      : {};
  } catch {
    return {};
  }
}

export function loadSavedMapping(householdId: string): CollectionMapping {
  const mapping = readAll()[householdId];
  return mapping && typeof mapping === "object" ? mapping : {};
}

export function saveMapping(householdId: string, mapping: CollectionMapping): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...readAll(), [householdId]: mapping }));
  } catch {
    // Storage unavailable: the choice just isn't remembered.
  }
}

/** The copy's owner for a non-skip choice: "shared" is a household copy (null). */
export function ownerUserIdFor(choice: OwnerChoice): string | null {
  return choice === "shared" ? null : choice;
}
