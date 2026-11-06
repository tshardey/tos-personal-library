import { describe, expect, it } from "vitest";
import { authorKey, authorsOverlap, baseTitleKey, titleKey } from "./match-keys";

describe("titleKey", () => {
  it("strips the edition parenthetical and leading article", () => {
    expect(titleKey("The Glass Orchard (Deluxe Limited Edition)")).toBe(titleKey("glass orchard"));
  });
  it("ignores apostrophe style", () => {
    expect(titleKey("Moon's Tide")).toBe(titleKey("Moon’s Tide"));
  });
  it("treats & as and", () => {
    expect(titleKey("Salt & Ember")).toBe(titleKey("Salt and Ember"));
  });
  it("strips accents", () => {
    expect(titleKey("Poète")).toBe(titleKey("Poete"));
  });
  it("keeps non-edition parentheticals", () => {
    expect(titleKey("The Glass Orchard (Original)")).not.toBe(titleKey("The Glass Orchard"));
  });
  it("handles Cyrillic and CJK", () => {
    expect(titleKey("Стеклянный сад")).not.toBe("");
    expect(titleKey("Стеклянный сад")).toBe(titleKey("СТЕКЛЯННЫЙ САД"));
    expect(titleKey("Стеклянный сад")).not.toBe(titleKey("Соляная дорога"));
    expect(titleKey("硝子の果樹園")).not.toBe("");
    expect(titleKey("硝子の果樹園")).not.toBe(titleKey("塩の道"));
  });
  it("gives an empty key for punctuation only", () => {
    expect(titleKey("!!!")).toBe("");
  });
});

describe("baseTitleKey", () => {
  it("uses the text before the first colon", () => {
    expect(baseTitleKey("Ember Road: Book 2")).toBe(baseTitleKey("Ember Road: Book 3"));
  });
  it("uses the text before the first spaced dash", () => {
    expect(baseTitleKey("Ember Road - Book 2")).toBe(baseTitleKey("Ember Road"));
  });
  it("is empty when nothing precedes the separator", () => {
    expect(baseTitleKey(": Book 2")).toBe("");
  });
});

describe("authorKey", () => {
  it("joins initials in every style", () => {
    const k = authorKey("J. K. Vale");
    expect(k).toBe("jk vale");
    expect(authorKey("J K Vale")).toBe(k);
    expect(authorKey("JK Vale")).toBe(k);
  });
  it("handles non-Latin names", () => {
    expect(authorKey("波多野 蓮")).not.toBe("");
  });
});

describe("authorsOverlap", () => {
  it("matches on a shared key", () => {
    expect(authorsOverlap(["A B"], ["C D", "a b"])).toBe(true);
  });
  it("is false when only one side is empty", () => {
    expect(authorsOverlap(["A B"], [])).toBe(false);
  });
  it("is true when both are empty", () => {
    expect(authorsOverlap([], [])).toBe(true);
  });
  it("ignores empty keys", () => {
    expect(authorsOverlap(["!!!"], ["!!!"])).toBe(false);
    expect(authorsOverlap(["!!!"], [])).toBe(false);
  });
});
