/** Synthetic StoryGraph export shape (D6). Invented rows only. */
export const SG_HEADER =
  "Title,Authors,Contributors,ISBN/UID,Format,Read Status,Date Added,Last Date Read,Dates Read,Read Count,Moods,Pace,Character- or Plot-Driven?,Strong Character Development?,Loveable Characters?,Diverse Characters?,Flawed Characters?,Star Rating,Review,Content Warnings,Content Warning Description,Tags,Owned?";

const quote = (v: string): string => (/[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

export function sgCsv(
  rows: Partial<Record<string, string>>[],
  opts: { bom?: boolean; crlf?: boolean; header?: string } = {},
): string {
  const header = opts.header ?? SG_HEADER;
  const cols = header.split(",");
  const lines = [header, ...rows.map((r) => cols.map((c) => quote(r[c] ?? "")).join(","))];
  return (opts.bom ? "\uFEFF" : "") + lines.join(opts.crlf ? "\r\n" : "\n") + "\n";
}
