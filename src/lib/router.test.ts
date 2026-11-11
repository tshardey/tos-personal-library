import { describe, expect, it } from "vitest";
import { parseHash, routeToHash } from "./router";

describe("parseHash", () => {
  it("decodes book ids", () => {
    expect(parseHash("#/book/abc%20def")).toEqual({ name: "book", id: "abc def" });
  });
  it("falls back to library on malformed encoding", () => {
    expect(parseHash("#/book/%E0%A4%A")).toEqual({ name: "library" });
  });
  it("falls back to library on empty id and unknown routes", () => {
    expect(parseHash("#/book/")).toEqual({ name: "library" });
    expect(parseHash("#/nope")).toEqual({ name: "library" });
  });
  it("parses add", () => {
    expect(parseHash("#/add")).toEqual({ name: "add" });
  });
  it("parses import and round-trips it", () => {
    expect(parseHash("#/import")).toEqual({ name: "import" });
    expect(parseHash(routeToHash({ name: "import" }))).toEqual({ name: "import" });
  });
  it("parses inbox and round-trips it", () => {
    expect(parseHash("#/inbox")).toEqual({ name: "inbox" });
    expect(routeToHash({ name: "inbox" })).toBe("#/inbox");
    expect(parseHash(routeToHash({ name: "inbox" }))).toEqual({ name: "inbox" });
  });
});

describe("scan route", () => {
  it("parses scan and round-trips it", () => {
    expect(parseHash("#/scan")).toEqual({ name: "scan" });
    expect(routeToHash({ name: "scan" })).toBe("#/scan");
    expect(parseHash(routeToHash({ name: "scan" }))).toEqual({ name: "scan" });
  });
});

describe("series route", () => {
  it("parses and round-trips #/series/<name>", () => {
    expect(parseHash("#/series/Salt%20Road")).toEqual({ name: "library", series: "Salt Road" });
    expect(routeToHash({ name: "library", series: "Salt Road" })).toBe("#/series/Salt%20Road");
    expect(parseHash(routeToHash({ name: "library", series: "A/B ?" }))).toEqual({ name: "library", series: "A/B ?" });
  });
  it("keeps plain library routes", () => {
    expect(parseHash("#/")).toEqual({ name: "library" });
    expect(routeToHash({ name: "library" })).toBe("#/");
  });
});
