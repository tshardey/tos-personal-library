import { describe, expect, it } from "vitest";
import { readStatusOptions } from "./filter-options";

const member = (userId: string, displayName: string) => ({ householdId: "h1", userId, displayName, createdAt: "" });

describe("readStatusOptions", () => {
  const members = [member("u-b", "Member B"), member("u-a", "Member A"), member("u-c", "Member C")];
  it("lists Any, then me, then each other member in household order", () => {
    const opts = readStatusOptions(members, "u-a");
    expect(opts.map((o) => o.label)).toEqual([
      "Any read status",
      "Unread by me",
      "Read by me",
      "Did not finish (me)",
      "Unread by Member B",
      "Read by Member B",
      "Did not finish (Member B)",
      "Unread by Member C",
      "Read by Member C",
      "Did not finish (Member C)",
    ]);
  });
  it("carries the read status and unique values", () => {
    const opts = readStatusOptions(members, "u-a");
    expect(opts[0]).toEqual({ value: "any", label: "Any read status", readStatus: null });
    expect(opts[3].readStatus).toEqual({ userId: "u-a", state: "dnf" });
    expect(opts[5].readStatus).toEqual({ userId: "u-b", state: "read" });
    expect(new Set(opts.map((o) => o.value)).size).toBe(opts.length);
  });
});
