import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearSession, loadSession, saveSession, type ScanSession } from "./session";

const s: ScanSession = {
  householdId: "h1",
  batchId: "batch-1",
  edition: "Paperback",
  ownerUserId: null,
  startedAt: "2026-01-01T10:00:00Z",
};

beforeEach(() => localStorage.clear());
afterEach(() => vi.unstubAllGlobals());

describe("scan session", () => {
  it("round-trips under tpl_scan_session", () => {
    saveSession(s);
    expect(loadSession("h1")).toEqual(s);
    expect(Object.keys(localStorage)).toEqual(["tpl_scan_session"]);
    clearSession();
    expect(loadSession("h1")).toBeNull();
  });

  it("reads another household's session as null", () => {
    saveSession(s);
    expect(loadSession("h2")).toBeNull();
  });

  it("reads malformed storage as null", () => {
    localStorage.setItem("tpl_scan_session", "not json");
    expect(loadSession("h1")).toBeNull();
    localStorage.setItem("tpl_scan_session", JSON.stringify({ householdId: "h1" }));
    expect(loadSession("h1")).toBeNull();
  });

  it("degrades to not remembered when storage is blocked", () => {
    const boom = () => {
      throw new Error("blocked");
    };
    vi.stubGlobal("localStorage", { getItem: boom, setItem: boom, removeItem: boom });
    expect(() => saveSession(s)).not.toThrow();
    expect(loadSession("h1")).toBeNull();
    expect(() => clearSession()).not.toThrow();
  });
});
