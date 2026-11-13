import { describe, expect, it } from "vitest";
import { publishYear } from "./publish-year";

describe("publishYear", () => {
  it.each(["2019", "2019-03-05", "March 5, 2019", "05/03/2019"])("reads %s", (t) => {
    expect(publishYear(t)).toBe(2019);
  });
  it.each(["", null, "n.d.", "junk", "12345", "0999"])("gives null for %s", (t) => {
    expect(publishYear(t)).toBeNull();
  });
  it("reads c. 1887", () => expect(publishYear("c. 1887")).toBe(1887));
});
