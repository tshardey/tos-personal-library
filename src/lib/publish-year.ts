/** The first standalone run of exactly four digits, if it lies in 1000-2100. */
export function publishYear(text: string | null): number | null {
  if (!text) return null;
  const m = /(?<!\d)\d{4}(?!\d)/.exec(text);
  if (!m) return null;
  const year = Number(m[0]);
  return year >= 1000 && year <= 2100 ? year : null;
}
