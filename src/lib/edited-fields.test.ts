import { describe, expect, it } from "vitest";
import { changedFields, markEdited } from "./edited-fields";

describe("changedFields", () => {
  it("returns only keys whose values differ", () => {
    expect(
      changedFields({ title: "A", authors: ["x"] }, { title: "B", authors: ["x"] }, ["title", "authors"]),
    ).toEqual(["title"]);
  });
  it("compares arrays element-wise", () => {
    expect(changedFields({ a: ["x"] }, { a: ["x", "y"] }, ["a"])).toEqual(["a"]);
    expect(changedFields({ a: ["x", "y"] }, { a: ["x", "y"] }, ["a"])).toEqual([]);
  });
});

describe("markEdited", () => {
  it("returns a sorted union without duplicates", () => {
    expect(markEdited(["title"], ["authors", "title"])).toEqual(["authors", "title"]);
  });
});
