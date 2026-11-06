import { describe, expect, it } from "vitest";
import { canonicalIsbns, isbn10To13, normalizeIsbn10, normalizeIsbn13 } from "./isbn";

describe("isbn", () => {
  it("normalizeIsbn13", () => {
    expect(normalizeIsbn13("978-0-00-000000-2")).toBe("9780000000002");
    expect(normalizeIsbn13("9790000000001")).toBe("9790000000001");
    expect(normalizeIsbn13("9780000000003")).toBeNull();
    expect(normalizeIsbn13("9.78E+12")).toBeNull();
    expect(normalizeIsbn13("")).toBeNull();
  });
  it("normalizeIsbn10", () => {
    expect(normalizeIsbn10("000000006x")).toBe("000000006X");
    expect(normalizeIsbn10("12345678901")).toBeNull();
    expect(normalizeIsbn10("0000000007")).toBeNull();
  });
  it("isbn10To13 and canonicalIsbns", () => {
    expect(isbn10To13("000000006X")).toBe("9780000000064");
    const set = canonicalIsbns({ isbn13: ["9780000000002"], isbn10: ["000000006X"] });
    expect(set).toEqual(new Set(["9780000000002", "9780000000064"]));
  });
});
