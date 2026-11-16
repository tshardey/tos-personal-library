import { describe, expect, it } from "vitest";
import { FUZZY_THRESHOLD, matchesSearchWords, searchWords } from "./search-words";

const matches = (query: string, fields: string[]) => matchesSearchWords(searchWords(query), fields);

describe("searchWords", () => {
  it("folds, splits on whitespace and punctuation, and drops the articles", () => {
    expect(searchWords("  The Lantern-Keeper's  ATLAS ")).toEqual(["lantern", "keeper", "s", "atlas"]);
    expect(searchWords("a map of an island")).toEqual(["map", "of", "island"]);
  });

  it("keeps the articles when they are the whole search", () => {
    expect(searchWords("the")).toEqual(["the"]);
    expect(searchWords("The, a")).toEqual(["the", "a"]);
  });

  it("gives no words for a blank search", () => {
    expect(searchWords("")).toEqual([]);
    expect(searchWords("   ")).toEqual([]);
  });
});

describe("matchesSearchWords", () => {
  const fields = ["Lanternhold", "Wren Quillby", "Invented box set"];

  it("finds a title saved without its leading article", () => {
    expect(matches("the lanternhold", fields)).toBe(true);
    expect(matches("lanternhold the", fields)).toBe(true);
  });

  it("matches words across the title, authors and notes in any order", () => {
    expect(matches("lanternhold quillby", fields)).toBe(true);
    expect(matches("quillby lanternhold", fields)).toBe(true);
    expect(matches("box wren", fields)).toBe(true);
  });

  it("ignores accents on either side", () => {
    expect(matches("poete", ["Le Poète d'Ombre"])).toBe(true);
    expect(matches("Poète", ["le poete d'ombre"])).toBe(true);
  });

  it("searches for 'the' when that is the whole search", () => {
    expect(matches("the", ["The Hollow Ferry"])).toBe(true);
    expect(matches("the", ["Lanternhold"])).toBe(false);
  });

  it("matches partial typing", () => {
    expect(matches("lantern", fields)).toBe(true);
    expect(matches("the lant quil", fields)).toBe(true);
  });

  it("excludes a book missing any one word", () => {
    expect(matches("lanternhold ferry", fields)).toBe(false);
    expect(matches("the lanternhold zebra", fields)).toBe(false);
  });

  it("does not join words across fields", () => {
    expect(matches("dwr", fields)).toBe(false);
  });

  it("matches everything with no words", () => {
    expect(matches("", fields)).toBe(true);
  });
});

describe("typo tolerance", () => {
  const fields = ["Lanternhold", "Odile Thistlewood"];

  it("starts at the documented threshold", () => {
    expect(FUZZY_THRESHOLD).toBe(0.45);
  });

  it("matches a dropped letter in the title", () => {
    expect(matches("the lanterhold", fields)).toBe(true);
  });

  it("matches a transposition or a substitution in an author surname", () => {
    expect(matches("thistlweood", fields)).toBe(true);
    expect(matches("thistlewoad", fields)).toBe(true);
  });

  it("matches one exact word plus one typo'd word", () => {
    expect(matches("lanternhold thistlwood", fields)).toBe(true);
    expect(matches("lantern thistlewod", fields)).toBe(true);
  });

  it("never fuzzes a word under four letters", () => {
    expect(matches("odi", ["Odile"])).toBe(true);
    expect(matches("oli", ["Odile"])).toBe(false);
    expect(matches("bot", ["Boat"])).toBe(false);
  });

  it("does not match an unrelated word below the threshold", () => {
    expect(matches("harrow", ["Hollow"])).toBe(false);
    expect(matches("lantern pattern", ["Lanternhold"])).toBe(false);
    expect(matches("thistlewood", ["Lanternhold"])).toBe(false);
  });

  it("still matches exact partial typing without needing a fuzzy hit", () => {
    expect(matches("lant", fields)).toBe(true);
    expect(matches("thist", fields)).toBe(true);
  });

  it("needs every word, exactly or fuzzily", () => {
    expect(matches("lanterhold zebra", fields)).toBe(false);
  });
});
