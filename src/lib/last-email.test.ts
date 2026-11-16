import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadLastEmail, saveLastEmail } from "./last-email";

beforeEach(() => localStorage.clear());
afterEach(() => vi.restoreAllMocks());

describe("last email", () => {
  it("is empty until one is saved, then returns it", () => {
    expect(loadLastEmail()).toBe("");
    saveLastEmail("reader@example.com");
    expect(loadLastEmail()).toBe("reader@example.com");
  });

  it("reads as empty when storage is blocked", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("blocked", "SecurityError");
    });
    expect(loadLastEmail()).toBe("");
  });

  it("saves nothing, without throwing, when storage is blocked", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("full", "QuotaExceededError");
    });
    expect(() => saveLastEmail("reader@example.com")).not.toThrow();
  });
});
