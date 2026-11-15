import { describe, expect, it } from "vitest";
import { MAX_HISTORY_ROWS, parseSgDate, parseStoryGraph, readStoryGraphFile, StoryGraphFileError } from "./storygraph";
import { SG_HEADER, sgCsv } from "./fixtures";

const row = (o: Record<string, string> = {}) => ({
  Title: "The Salt Road", Authors: "Petra Wynnecombe", "ISBN/UID": "9780000000019", "Read Status": "read", ...o,
});
const err = (fn: () => unknown): StoryGraphFileError => {
  try { fn(); } catch (e) { return e as StoryGraphFileError; }
  throw new Error("did not throw");
};

describe("mapping", () => {
  it("maps read and did-not-finish, and counts the rest as skipped", () => {
    const r = parseStoryGraph(sgCsv([
      row({ Title: "A" }), row({ Title: "B", "Read Status": "did-not-finish", "ISBN/UID": "" }),
      row({ Title: "C", "Read Status": "to-read" }), row({ Title: "D", "Read Status": "currently-reading" }),
      row({ Title: "E", "Read Status": "paused" }),
    ]));
    expect(r.rows.map((x) => [x.title, x.status])).toEqual([["A", "read"], ["B", "dnf"]]);
    expect(r.skipped).toBe(3);
  });
  it("splits authors keeping suffixes, and a blank ISBN/UID is null", () => {
    const r = parseStoryGraph(sgCsv([row({ Authors: "Petra Wynnecombe, Oren Vale Jr.", "ISBN/UID": "" })]));
    expect(r.rows[0].authors).toEqual(["Petra Wynnecombe", "Oren Vale Jr."]);
    expect(r.rows[0].isbnUid).toBeNull();
  });
});

describe("real-world shape", () => {
  it("parses a BOM with CRLF", () => {
    expect(parseStoryGraph(sgCsv([row()], { bom: true, crlf: true })).rows).toHaveLength(1);
  });
  it("round-trips a quoted title", () => {
    expect(parseStoryGraph(sgCsv([row({ Title: 'Salt, Smoke "and" Glass' })])).rows[0].title).toBe('Salt, Smoke "and" Glass');
  });
  it("parses reordered columns with extras, and case-insensitive headers", () => {
    const header = "Extra One,read status,Title,Extra Two,ISBN/UID,Authors";
    const r = parseStoryGraph(sgCsv([{ "Extra One": "x", "read status": "read", Title: "T", "Extra Two": "y", "ISBN/UID": "u1", Authors: "Petra Wynnecombe" }], { header }));
    expect(r.rows[0]).toMatchObject({ title: "T", isbnUid: "u1", status: "read" });
  });
  it("gives null for an impossible Last Date Read", () => {
    expect(parseStoryGraph(sgCsv([row({ "Last Date Read": "2026/02/30" })])).rows[0].lastRead).toBeNull();
  });
  it("takes the last date token of Dates Read when Last Date Read is blank", () => {
    const r = parseStoryGraph(sgCsv([row({ "Dates Read": "2025/01/03-2025/01/20, 2026/03/01-2026/03/09" })]));
    expect(r.rows[0].lastRead).toBe("2026-03-09");
  });
  it("prefers a valid Last Date Read", () => {
    expect(parseStoryGraph(sgCsv([row({ "Last Date Read": "2026/04/01", "Dates Read": "2026/05/01" })])).rows[0].lastRead).toBe("2026-04-01");
  });
  it("returns exactly five keys", () => {
    const r = parseStoryGraph(sgCsv([row({ Review: "secret", "Star Rating": "4", Tags: "x", Moods: "m", "Owned?": "Yes", Contributors: "c" })]));
    expect(Object.keys(r.rows[0]).sort()).toEqual(["authors", "isbnUid", "lastRead", "status", "title"]);
    expect(JSON.stringify(r)).not.toContain("secret");
  });
});

describe("merging", () => {
  it("merges the same ISBN: read beats dnf and the later date wins", () => {
    const r = parseStoryGraph(sgCsv([
      row({ "Read Status": "did-not-finish", "Last Date Read": "2026/05/01" }),
      row({ "Read Status": "read", "Last Date Read": "2026/02/01", "ISBN/UID": "978-0-00-000001-9" }),
    ]));
    expect(r.rows).toEqual([{ title: "The Salt Road", authors: ["Petra Wynnecombe"], isbnUid: "9780000000019", status: "read", lastRead: "2026-05-01" }]);
  });
  it("merges title+author when there is no ISBN/UID", () => {
    const r = parseStoryGraph(sgCsv([row({ "ISBN/UID": "" }), row({ "ISBN/UID": "", Title: "the salt road" })]));
    expect(r.rows).toHaveLength(1);
  });
  it("does not merge different books", () => {
    expect(parseStoryGraph(sgCsv([row(), row({ Title: "Other", "ISBN/UID": "uid-2" })])).rows).toHaveLength(2);
  });
});

describe("errors", () => {
  it("names the missing column for a libib file", () => {
    const e = err(() => parseStoryGraph("id,item_type,title,creators\n1,book,T,A\n"));
    expect(e.code).toBe("not_storygraph");
    expect(e.missing).toEqual(["Read Status"]);
  });
  it("is empty for a header-only file", () => {
    expect(err(() => parseStoryGraph(SG_HEADER + "\n")).code).toBe("empty");
  });
  it("is too_large before reading", async () => {
    const file = new File([new Uint8Array(10 * 1024 * 1024 + 1)], "big.csv");
    await expect(readStoryGraphFile(file)).rejects.toMatchObject({ code: "too_large" });
  });
  it("is too_many_rows over the cap", () => {
    const rows = Array.from({ length: MAX_HISTORY_ROWS + 1 }, (_, i) => row({ Title: `T${i}` }));
    expect(err(() => parseStoryGraph(sgCsv(rows))).code).toBe("too_many_rows");
  });
  it("is not_text for a binary blob", async () => {
    await expect(readStoryGraphFile(new File([new Uint8Array([0x61, 0, 0x62])], "x.csv"))).rejects.toMatchObject({ code: "not_text" });
    expect(err(() => parseStoryGraph("a\u0000b")).code).toBe("not_text");
  });
  it("is malformed for unbalanced quotes", () => {
    expect(err(() => parseStoryGraph(SG_HEADER + '\n"unterminated,x\n')).code).toBe("malformed");
  });
  it("reads a good file", async () => {
    const r = await readStoryGraphFile(new File([sgCsv([row()])], "sg.csv"));
    expect(r.rows).toHaveLength(1);
  });
});

describe("parseSgDate", () => {
  it("accepts both separators and rejects impossible dates", () => {
    expect(parseSgDate("2026/03/09")).toBe("2026-03-09");
    expect(parseSgDate("2026-03-09")).toBe("2026-03-09");
    expect(parseSgDate("2024/02/29")).toBe("2024-02-29");
    expect(parseSgDate("2025/02/29")).toBeNull();
    expect(parseSgDate("")).toBeNull();
    expect(parseSgDate("March 9")).toBeNull();
  });
});
