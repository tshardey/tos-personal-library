export interface TosTag {
  id: string;
  label: string;
  category: string;
  scope?: "reader";
  derivedFromType?: string;
}

const CACHE_KEY = "tpl_tos_book_tags";
const TIMEOUT_MS = 4000;
const DEFAULT_URL = "/tome-of-secrets/assets/data/bookTags.json";

function readCache(storage: Storage | undefined): TosTag[] | null {
  try {
    const raw = storage?.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as TosTag[]) : null;
  } catch {
    return null;
  }
}

function defaultStorage(): Storage | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

/** D4: ToS's published tag list; falls back to the last good copy (stale) and then to an empty list. */
export async function loadTosTags(
  opts: { fetchImpl?: typeof fetch; url?: string; storage?: Storage } = {},
): Promise<{ tags: TosTag[]; stale: boolean }> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const url = opts.url ?? (import.meta.env.VITE_TOS_BOOK_TAGS_URL || DEFAULT_URL);
  const storage = opts.storage ?? defaultStorage();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetchImpl(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`bookTags.json responded ${res.status}`);
    const body: unknown = await res.json();
    if (!Array.isArray(body)) throw new Error("bookTags.json is not a list");
    const tags = body as TosTag[];
    try {
      storage?.setItem(CACHE_KEY, JSON.stringify(tags));
    } catch {
      // A full or blocked storage only costs the offline copy.
    }
    return { tags, stale: false };
  } catch {
    return { tags: readCache(storage) ?? [], stale: true };
  } finally {
    clearTimeout(timer);
  }
}

/** The editor and filter offer only shared tags; reader-scoped and derived ones belong to ToS. */
export function isSharedTag(tag: TosTag): boolean {
  return !tag.scope && !tag.derivedFromType;
}

const CATEGORY_ORDER = ["genre", "content", "provenance", "agency", "form"];

function titleCase(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Tag ids grouped by ToS category (genre, content, provenance, agency, form); unknown ids go under Other. */
export function groupTags(
  ids: string[],
  tags: TosTag[],
): Array<{ category: string; label: string; tags: Array<{ id: string; label: string }> }> {
  const byId = new Map(tags.map((t) => [t.id, t]));
  const groups = new Map<string, { id: string; label: string }[]>();
  for (const id of ids) {
    const tag = byId.get(id);
    const category = tag?.category ?? "other";
    const list = groups.get(category) ?? [];
    list.push({ id, label: tag?.label ?? id });
    groups.set(category, list);
  }
  const rank = (c: string) => {
    const i = CATEGORY_ORDER.indexOf(c);
    return i === -1 ? (c === "other" ? CATEGORY_ORDER.length + 1 : CATEGORY_ORDER.length) : i;
  };
  return [...groups.entries()]
    .sort((a, b) => rank(a[0]) - rank(b[0]) || a[0].localeCompare(b[0]))
    .map(([category, list]) => ({ category, label: titleCase(category), tags: list }));
}
