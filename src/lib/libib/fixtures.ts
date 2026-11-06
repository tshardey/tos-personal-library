// Synthetic libib CSV builder for tests. Not imported by app code.
export const LIBIB_HEADER = [
  "id", "item_type", "title", "creators", "first_name", "last_name", "collection",
  "ean_isbn13", "upc_isbn10", "description", "publisher", "publish_date", "group",
  "tags", "notes", "price", "length", "number_of_discs", "number_of_players",
  "age_group", "ensemble", "aspect_ratio", "esrb", "rating", "review", "review_date",
  "status", "began", "completed", "added", "copies",
];

const DEFAULTS: Record<string, string> = {
  id: "AAAAAAAAAA",
  item_type: "book",
  title: "Sample Title",
  creators: "Wren Halloway",
  collection: "Test Books",
  ean_isbn13: "9780000000002",
  copies: "1",
};

const quote = (v: string): string => (/[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

/** Full 31-column header, RFC 4180 quoting, LF line endings, defaults filled in. */
export function libibCsv(rows: Partial<Record<string, string>>[]): string {
  const lines = [LIBIB_HEADER.join(",")];
  for (const row of rows) {
    lines.push(LIBIB_HEADER.map((c) => quote(row[c] ?? DEFAULTS[c] ?? "")).join(","));
  }
  return lines.join("\n") + "\n";
}
