import type { BookWithCopies } from "@/lib/types";

export const MAX_LABEL = 120;

function key(s: string): string {
  return s.toLowerCase();
}

/** D12: household edition labels from every copy's note plus open items' labels. */
export function editionLabels(catalog: BookWithCopies[], openLabels: string[]): string[] {
  const raw = [...catalog.flatMap((b) => b.copies.map((c) => c.editionNote ?? "")), ...openLabels];
  const groups = new Map<string, Map<string, number>>();
  for (const value of raw) {
    const label = value.trim();
    if (label === "" || label.length > MAX_LABEL) continue;
    const spellings = groups.get(key(label)) ?? new Map<string, number>();
    spellings.set(label, (spellings.get(label) ?? 0) + 1);
    groups.set(key(label), spellings);
  }
  const labels = [...groups.values()].map(
    (spellings) => [...spellings.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0],
  );
  return labels.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
}

/** The label to store for typed text: the existing spelling on a case-insensitive hit, else the trimmed text. */
export function canonicalLabel(typed: string, labels: string[]): string | null {
  const text = typed.trim();
  if (text === "" || text.length > MAX_LABEL) return null;
  return labels.find((l) => key(l) === key(text)) ?? text;
}
