import { describe, expect, it } from "vitest";
import { effectiveStatus, stateFor, toStatusMap } from "./status";
import type { ReadStatusRow } from "./types";

const row = (over: Partial<ReadStatusRow>): ReadStatusRow => ({
  bookId: "b1",
  userId: "a",
  status: "read",
  finishedOn: null,
  source: "app",
  markedAt: "2026-01-01T00:00:00Z",
  ...over,
});

describe("effectiveStatus", () => {
  it("treats cleared as unread", () => expect(effectiveStatus(row({ status: "cleared" }))).toBe("unread"));
  it("treats a missing row as unread", () => expect(effectiveStatus(undefined)).toBe("unread"));
  it("passes read and dnf through", () => {
    expect(effectiveStatus(row({ status: "read" }))).toBe("read");
    expect(effectiveStatus(row({ status: "dnf" }))).toBe("dnf");
  });
});

describe("toStatusMap", () => {
  it("drops cleared rows and keeps dates", () => {
    const map = toStatusMap([
      row({ userId: "a", status: "read", finishedOn: "2026-02-03" }),
      row({ userId: "b", status: "cleared" }),
      row({ bookId: "b2", userId: "b", status: "dnf" }),
    ]);
    expect(map.get("b1")?.has("b")).toBe(false);
    expect(map.get("b1")?.get("a")).toEqual({ state: "read", finishedOn: "2026-02-03" });
    expect(map.get("b2")?.get("b")?.state).toBe("dnf");
  });
  it("leaves no entry for a book whose only row is cleared", () => {
    expect(toStatusMap([row({ status: "cleared" })]).has("b1")).toBe(false);
  });
});

describe("stateFor", () => {
  it("is unread for a missing member or book", () => {
    const map = toStatusMap([row({})]);
    expect(stateFor(map, "b1", "a")).toBe("read");
    expect(stateFor(map, "b1", "zz")).toBe("unread");
    expect(stateFor(map, "nope", "a")).toBe("unread");
  });
});
