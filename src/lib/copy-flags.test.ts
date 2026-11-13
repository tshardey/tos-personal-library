import { describe, expect, it } from "vitest";
import { bookBadges, countedCopies, hasUnhauledCopy, isUnhauled } from "./copy-flags";
import { copyFixture, bookFixture } from "./flag-fixtures.test-util";

describe("copy-flags", () => {
  const onShelf = copyFixture({ deluxe: true });
  const gone = copyFixture({ unhauledAt: "2026-11-01T00:00:00Z", signed: true });
  const b = bookFixture("The Salt Road", [onShelf, gone]);

  it("detects unhauled copies", () => {
    expect(isUnhauled(gone)).toBe(true);
    expect(isUnhauled(onShelf)).toBe(false);
    expect(hasUnhauledCopy(b)).toBe(true);
  });
  it("counts copies by showUnhauled", () => {
    expect(countedCopies(b, false)).toEqual([onShelf]);
    expect(countedCopies(b, true)).toEqual([onShelf, gone]);
  });
  it("badges ignore unhauled copies; unhauled follows onShelf", () => {
    expect(bookBadges(b)).toEqual({ unhauled: false, deluxe: true, signed: false });
    expect(bookBadges({ ...b, onShelf: false }).unhauled).toBe(true);
  });
});
