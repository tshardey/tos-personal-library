import { LIBRARY_TAG_CATEGORIES, type LibraryTag, type LibraryTagCategory } from "./types";

export interface TagGroup {
  category: LibraryTagCategory | "other";
  label: string;
  tags: { id: string; label: string }[];
}

/** Group tag ids by category in D3 order; ids not in the vocabulary go under Other (label = id). Input order kept within a group. */
export function groupLibraryTags(ids: string[], vocab: LibraryTag[]): TagGroup[] {
  const byId = new Map(vocab.map((t) => [t.id, t]));
  const buckets = new Map<LibraryTagCategory | "other", { id: string; label: string }[]>();
  for (const id of ids) {
    const t = byId.get(id);
    const key = t ? t.category : "other";
    const list = buckets.get(key) ?? [];
    list.push({ id, label: t ? t.label : id });
    buckets.set(key, list);
  }
  const out: TagGroup[] = [];
  for (const c of LIBRARY_TAG_CATEGORIES) {
    const tags = buckets.get(c.id);
    if (tags) out.push({ category: c.id, label: c.label, tags });
  }
  const other = buckets.get("other");
  if (other) out.push({ category: "other", label: "Other", tags: other });
  return out;
}
