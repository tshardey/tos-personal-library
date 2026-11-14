const MAX_LEN = 40;

/**
 * Tag id from a label: NFD, marks stripped, lowercased, runs of non [a-z0-9] become "-",
 * ends trimmed, cut to 40 characters at a hyphen boundary. Returns "" when the label has
 * no usable characters (the caller must reject that). Result matches ^[a-z0-9]+(-[a-z0-9]+)*$.
 */
export function tagIdFromLabel(label: string): string {
  const slug = label
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (slug.length <= MAX_LEN) return slug;
  const head = slug.slice(0, MAX_LEN + 1);
  const cut = head.lastIndexOf("-");
  // One very long word: no hyphen to cut at, so hard-cut it.
  return cut > 0 ? head.slice(0, cut) : slug.slice(0, MAX_LEN);
}
