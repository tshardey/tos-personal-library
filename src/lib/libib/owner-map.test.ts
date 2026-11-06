import { afterEach, describe, expect, it, vi } from "vitest";
import type { HouseholdMember } from "../types";
import { loadSavedMapping, ownerUserIdFor, saveMapping, suggestOwners } from "./owner-map";

const member = (userId: string, displayName: string): HouseholdMember => ({
  householdId: "h1",
  userId,
  displayName,
  createdAt: "",
});
const members = [member("u1", "Tierra"), member("u2", "Sam")];

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe("suggestOwners", () => {
  it("matches a whole word, ignoring possessive", () => {
    expect(suggestOwners(["Tierra's Books"], members, {})).toEqual({ "Tierra's Books": "u1" });
  });
  it("leaves unmatched collections undefined", () => {
    expect(suggestOwners(["Garage"], members, {})["Garage"]).toBeUndefined();
  });
  it("leaves ambiguous matches undefined", () => {
    expect(suggestOwners(["Tierra and Sam"], members, {})["Tierra and Sam"]).toBeUndefined();
  });
  it("does not suggest anyone for an empty collection name or empty display name", () => {
    expect(suggestOwners([""], members, {})[""]).toBeUndefined();
    expect(suggestOwners(["!!!"], [member("u3", "!!!")], {})["!!!"]).toBeUndefined();
  });
  it("prefers a saved member", () => {
    expect(suggestOwners(["Tierra's Books"], members, { "Tierra's Books": "u2" })).toEqual({
      "Tierra's Books": "u2",
    });
  });
  it("falls back to name matching when the saved member is gone", () => {
    expect(suggestOwners(["Tierra's Books"], members, { "Tierra's Books": "gone" })).toEqual({
      "Tierra's Books": "u1",
    });
  });
  it("honors saved skip and shared", () => {
    expect(suggestOwners(["Tierra's Books", "Z"], members, { "Tierra's Books": "skip", Z: "shared" })).toEqual({
      "Tierra's Books": "skip",
      Z: "shared",
    });
  });
});

describe("persistence", () => {
  it("round-trips under a tpl_ key", () => {
    saveMapping("h1", { A: "u1" });
    expect(loadSavedMapping("h1")).toEqual({ A: "u1" });
    expect(Object.keys(localStorage).every((k) => k.startsWith("tpl_"))).toBe(true);
    expect(Object.keys(localStorage).length).toBe(1);
  });
  it("returns {} when storage throws", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    });
    expect(loadSavedMapping("h1")).toEqual({});
    expect(() => saveMapping("h1", { A: "u1" })).not.toThrow();
  });
  it("returns {} for malformed data", () => {
    localStorage.setItem("tpl_libib_owner_map", "not json");
    expect(loadSavedMapping("h1")).toEqual({});
  });
});

describe("ownerUserIdFor", () => {
  it("maps shared to null and a member to its id", () => {
    expect(ownerUserIdFor("shared")).toBeNull();
    expect(ownerUserIdFor("u1")).toBe("u1");
  });
});
