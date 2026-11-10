import { describe, expect, it } from "vitest";
import { isbnFromBarcode, isbnFromTyped } from "./isbn-input";

describe("isbnFromBarcode", () => {
  it("accepts a valid EAN-13 ISBN", () => {
    expect(isbnFromBarcode("9780000000002")).toEqual({ kind: "isbn", isbn13: "9780000000002" });
  });
  it("cuts an EAN-5 or EAN-2 add-on", () => {
    expect(isbnFromBarcode("978000000000251299")).toEqual({ kind: "isbn", isbn13: "9780000000002" });
    expect(isbnFromBarcode("978000000000212")).toEqual({ kind: "isbn", isbn13: "9780000000002" });
  });
  it("rejects bad checksums, UPC-style codes, lone add-ons and empty text", () => {
    for (const t of ["9780000000003", "0012345678905", "51299", ""]) {
      expect(isbnFromBarcode(t)).toEqual({ kind: "not_isbn" });
    }
  });
  it("accepts any 979 prefix, including 9790 (D13)", () => {
    expect(isbnFromBarcode("9791000000008")).toEqual({ kind: "isbn", isbn13: "9791000000008" });
    expect(isbnFromBarcode("9790000000001")).toEqual({ kind: "isbn", isbn13: "9790000000001" });
  });
});

describe("isbnFromTyped", () => {
  it("accepts hyphens and spaces", () => {
    expect(isbnFromTyped("978-0-00-000000-2")).toBe("9780000000002");
    expect(isbnFromTyped(" 9780000000002 ")).toBe("9780000000002");
  });
  it("converts an ISBN-10", () => {
    expect(isbnFromTyped("0-00-000000-0")).toBe("9780000000002");
  });
  it("accepts 979 (D13)", () => {
    expect(isbnFromTyped("979-0-000000-00-1")).toBe("9790000000001");
  });
  it("rejects invalid input", () => {
    expect(isbnFromTyped("9780000000003")).toBeNull();
    expect(isbnFromTyped("abc")).toBeNull();
  });
});
