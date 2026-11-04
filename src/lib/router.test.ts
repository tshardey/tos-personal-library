import { describe, expect, it } from "vitest";
import { parseHash } from "./router";

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
});
