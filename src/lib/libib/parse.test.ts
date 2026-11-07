import { describe, expect, it } from "vitest";
import { libibCsv, LIBIB_HEADER } from "./fixtures";
import { decodeLibibBytes, LibibFileError, parseLibibCsv, readLibibFile } from "./parse";

const authorsOf = (creators: string) =>
  parseLibibCsv(libibCsv([{ creators }])).rows[0].book.authors;

function fileError(fn: () => unknown): LibibFileError {
  try {
    fn();
  } catch (e) {
    return e as LibibFileError;
  }
  throw new Error("expected a LibibFileError");
}

describe("parseLibibCsv rows", () => {
  it("round-trips quotes, commas and newlines in a description", () => {
    const desc = 'He said "hi", twice,\nthen left';
    const r = parseLibibCsv(libibCsv([{ description: desc }, { id: "BBBBBBBBBB" }]));
    expect(r.rows).toHaveLength(2);
    expect(r.rows[0].book.synopsis).toBe(desc);
  });

  it("handles reordered and extra columns, BOM and CRLF", () => {
    const csv =
      "﻿extra,copies,title,id,item_type,creators,collection,ean_isbn13,upc_isbn10,description,publisher,publish_date,length\r\n" +
      "x,2,Odd Order,CCCCCCCCCC,book,Wren Halloway,Test Books,9780000000002,,,,,\r\n";
    const r = parseLibibCsv(csv);
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]).toMatchObject({ libibId: "CCCCCCCCCC", copies: 2 });
    expect(r.rows[0].book.title).toBe("Odd Order");
  });

  it("drops role-marked names", () => {
    expect(authorsOf("Wren Halloway, Ada Lund (Translator), Ben Ito (Translator)")).toEqual(["Wren Halloway"]);
    expect(authorsOf("Cass Mori (Illustrator, Created by)")).toEqual(["Cass Mori"]);
    expect(authorsOf("Wren Halloway, Ada Lund")).toEqual(["Wren Halloway", "Ada Lund"]);
    expect(authorsOf("Vale")).toEqual(["Vale"]);
  });

  it("keeps suffixes with their name (D7)", () => {
    expect(authorsOf("Wren Halloway, Jr")).toEqual(["Wren Halloway, Jr"]);
    expect(authorsOf("Wren Halloway, Jr., Ada Lund")).toEqual(["Wren Halloway, Jr.", "Ada Lund"]);
    expect(authorsOf("Ada Lund, Wren Halloway, iii")).toEqual(["Ada Lund", "Wren Halloway, iii"]);
    for (const s of ["Jr", "Sr", "II", "III", "IV", "PhD", "MD"]) {
      for (const v of [s, s.toLowerCase(), `${s}.`, `${s.toLowerCase()}.`]) {
        expect(authorsOf(`Wren Halloway, ${v}`)).toEqual([`Wren Halloway, ${v}`]);
      }
    }
    expect(authorsOf("Wren Halloway, Jr, Ph.D.")).toEqual(["Wren Halloway, Jr, Ph.D."]);
    expect(authorsOf("Wren Halloway, M.D.")).toEqual(["Wren Halloway, M.D."]);
    expect(authorsOf("Wren Halloway, Ivy Mdala")).toEqual(["Wren Halloway", "Ivy Mdala"]);
    expect(authorsOf("Jr, Ada Lund")).toEqual(["Jr", "Ada Lund"]);
    expect(authorsOf("Wren Halloway, Ada Lund (Translator), Jr")).toEqual(["Wren Halloway"]);
  });

  it("moves an edition parenthetical to editionNote (D6)", () => {
    const r = parseLibibCsv(
      libibCsv([
        { title: "The Glass Orchard (Deluxe Limited Edition)" },
        { id: "BBBBBBBBBB", title: "The Glass Orchard (Original)" },
      ]),
    );
    expect(r.rows[0].book.title).toBe("The Glass Orchard");
    expect(r.rows[0].editionNote).toBe("Deluxe Limited Edition");
    expect(r.rows[1].book.title).toBe("The Glass Orchard (Original)");
    expect(r.rows[1].editionNote).toBeNull();
  });

  it("validates ISBNs", () => {
    const a = parseLibibCsv(libibCsv([{ upc_isbn10: "12345678901" }]));
    expect(a.rows[0].book.isbn13).toEqual(["9780000000002"]);
    expect(a.rows[0].book.isbn10).toEqual([]);
    expect(a.warnings).toEqual([]);

    const b = parseLibibCsv(libibCsv([{ ean_isbn13: "", upc_isbn10: "000000006X" }]));
    expect(b.rows[0].book.isbn10).toEqual(["000000006X"]);
    expect(b.rows[0].book.isbn13).toEqual(["9780000000064"]);

    const c = parseLibibCsv(libibCsv([{ ean_isbn13: "9780000000003" }]));
    expect(c.rows[0].book.isbn13).toEqual([]);
    expect(c.warnings.map((w) => w.warning)).toEqual(["invalid_isbn"]);
  });

  it("flags spreadsheet damage", () => {
    const r = parseLibibCsv(libibCsv([{ ean_isbn13: "9.78E+12" }]));
    expect(r.spreadsheetDamage).toBe(true);
    expect(r.rows[0].book.isbn13).toEqual([]);
    expect(parseLibibCsv(libibCsv([{}])).spreadsheetDamage).toBe(false);
  });

  it("decodes windows-1252", () => {
    expect(decodeLibibBytes(new Uint8Array([0x63, 0x61, 0x66, 0xe9]))).toBe("café");
    expect(decodeLibibBytes(new TextEncoder().encode("café"))).toBe("café");
  });

  it("reads copies", () => {
    const copies = (v: string) => parseLibibCsv(libibCsv([{ copies: v }]));
    expect(copies("2").rows[0].copies).toBe(2);
    expect(copies("").rows[0].copies).toBe(1);
    expect(copies("").warnings).toEqual([]);
    for (const v of ["0", "abc", "51"]) {
      const r = copies(v);
      expect(r.rows[0].copies).toBe(1);
      expect(r.warnings.map((w) => w.warning)).toEqual(["unreadable_copies"]);
    }
  });

  it("reads length and blanks", () => {
    const r = parseLibibCsv(libibCsv([{ length: "320" }, { id: "BBBBBBBBBB", length: "x" }]));
    expect(r.rows[0].book.pageCount).toBe(320);
    expect(r.rows[1].book.pageCount).toBeNull();
    expect(r.rows[1].book.publisher).toBeNull();
  });

  it("treats a length above 100000 as unknown, so it can't overflow int4", () => {
    const r = parseLibibCsv(
      libibCsv([{ length: "100000" }, { id: "BBBBBBBBBB", length: "100001" }, { id: "CCCCCCCCCC", length: "9999999999" }]),
    );
    expect(r.rows.map((x) => x.book.pageCount)).toEqual([100000, null, null]);
  });

  it("skips bad rows and keeps good ones", () => {
    const short = LIBIB_HEADER.slice(0, 5).join(",");
    const csv =
      libibCsv([
        { id: "MMMMMMMMMM", item_type: "movie", title: "A Film" },
        { id: "", title: "No Id" },
        { id: "NNNNNNNNNN", title: "" },
        { id: "GGGGGGGGGG", title: "Good", collection: "Other" },
      ]) + `${short}\n`;
    const r = parseLibibCsv(csv);
    expect(r.rows.map((x) => x.libibId)).toEqual(["GGGGGGGGGG"]);
    expect(r.skipped).toEqual([
      { rowNumber: 1, title: "A Film", reason: "not_a_book" },
      { rowNumber: 2, title: "No Id", reason: "missing_id" },
      { rowNumber: 3, title: null, reason: "missing_title" },
      { rowNumber: 5, title: null, reason: "wrong_column_count" },
    ]);
    expect(r.allIds.has("MMMMMMMMMM")).toBe(true);
    expect(r.collections).toEqual(["Other"]);
  });

  it("merges duplicate ids", () => {
    const r = parseLibibCsv(libibCsv([{ copies: "1", title: "First" }, { copies: "3", title: "Second" }]));
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0].copies).toBe(3);
    expect(r.rows[0].book.title).toBe("First");
    expect(r.warnings.map((w) => w.warning)).toEqual(["duplicate_id"]);
  });
});

describe("file errors", () => {
  it("rejects non-libib and empty input", () => {
    const noCollection = libibCsv([]).replace(",collection,", ",coll,");
    expect(fileError(() => parseLibibCsv(noCollection)).missingColumns).toEqual(["collection"]);
    expect(fileError(() => parseLibibCsv("Book Id,Title,Author,ISBN13\n1,A,B,C\n")).code).toBe("not_libib");
    expect(fileError(() => parseLibibCsv(libibCsv([]))).code).toBe("empty");
    expect(fileError(() => parseLibibCsv("")).code).toBe("empty");
  });

  it("rejects an unclosed quote", () => {
    const csv = libibCsv([{}]) + 'BBBBBBBBBB,book,"Never closed,x\nmore\n';
    expect(fileError(() => parseLibibCsv(csv)).code).toBe("malformed");
  });

  it("rejects binary bytes", () => {
    expect(fileError(() => decodeLibibBytes(new Uint8Array([0x50, 0x4b, 3, 4]))).code).toBe("not_text");
    expect(fileError(() => decodeLibibBytes(new Uint8Array([0x61, 0, 0x62]))).code).toBe("not_text");
  });

  it("rejects an oversized file before decoding", async () => {
    const file = new File([new Uint8Array(10 * 1024 * 1024 + 1)], "big.csv");
    await expect(readLibibFile(file)).rejects.toMatchObject({ code: "too_large" });
  });

  it("reads a File", async () => {
    const r = await readLibibFile(new File([libibCsv([{}])], "library.csv"));
    expect(r.rows).toHaveLength(1);
  });

  it("limits rows", () => {
    const many = (n: number) =>
      libibCsv(Array.from({ length: n }, (_, i) => ({ id: `ID${i}`, title: `T${i}` })));
    expect(parseLibibCsv(many(10_000)).rows).toHaveLength(10_000);
    expect(fileError(() => parseLibibCsv(many(10_001))).code).toBe("too_many_rows");
  });
});
