const strip = (raw: string): string => raw.replace(/[\s-]/g, "");

function checksum13(first12: string): number {
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(first12[i]) * (i % 2 === 0 ? 1 : 3);
  return (10 - (sum % 10)) % 10;
}

export function normalizeIsbn13(raw: string): string | null {
  const s = strip(raw);
  if (!/^97[89]\d{10}$/.test(s)) return null;
  return checksum13(s.slice(0, 12)) === Number(s[12]) ? s : null;
}

export function normalizeIsbn10(raw: string): string | null {
  const s = strip(raw).toUpperCase();
  if (!/^\d{9}[\dX]$/.test(s)) return null;
  let sum = 0;
  for (let i = 0; i < 10; i++) sum += (10 - i) * (s[i] === "X" ? 10 : Number(s[i]));
  return sum % 11 === 0 ? s : null;
}

/** Converts a valid ISBN-10 to its ISBN-13 (978 prefix). */
export function isbn10To13(isbn10: string): string {
  const first12 = `978${isbn10.slice(0, 9)}`;
  return `${first12}${checksum13(first12)}`;
}

export function canonicalIsbns(b: { isbn13: string[]; isbn10: string[] }): Set<string> {
  return new Set([...b.isbn13, ...b.isbn10.map(isbn10To13)]);
}
