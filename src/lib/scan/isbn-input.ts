import { isbn10To13, normalizeIsbn10, normalizeIsbn13 } from "../libib/isbn";

export type BarcodeVerdict = { kind: "isbn"; isbn13: string } | { kind: "not_isbn" };

/**
 * An ISBN from the text of a scanned barcode. Digits only: 13 is itself; 15 or 18 digits are an
 * ISBN with an EAN-2 or EAN-5 add-on appended, so the first 13 are taken. The 13 must pass
 * normalizeIsbn13 (978 or any 979, valid checksum). Anything else is not an ISBN.
 */
export function isbnFromBarcode(text: string): BarcodeVerdict {
  if (!/^\d+$/.test(text)) return { kind: "not_isbn" };
  if (text.length !== 13 && text.length !== 15 && text.length !== 18) return { kind: "not_isbn" };
  const isbn13 = normalizeIsbn13(text.slice(0, 13));
  return isbn13 === null ? { kind: "not_isbn" } : { kind: "isbn", isbn13 };
}

/** An ISBN-13 from typed text: an ISBN-13, or an ISBN-10 converted. Spaces, hyphens and "x" are fine. */
export function isbnFromTyped(text: string): string | null {
  const as13 = normalizeIsbn13(text);
  if (as13 !== null) return as13;
  const as10 = normalizeIsbn10(text);
  return as10 === null ? null : isbn10To13(as10);
}
