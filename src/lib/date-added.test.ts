import { describe, expect, it } from "vitest";
import { dateAddedOptions, dayLabel, localDay } from "./date-added";
import { bookFixture, copyFixture } from "./flag-fixtures";

const at = (m: number, d: number) => new Date(2026, m, d, 10).toISOString();

describe("localDay", () => {
  it("respects local midnight", () => {
    expect(localDay(new Date(2026, 10, 12, 0, 0, 0).toISOString())).toBe("2026-11-12");
    expect(localDay(new Date(2026, 10, 11, 23, 59, 59).toISOString())).toBe("2026-11-11");
  });
});

describe("dateAddedOptions", () => {
  const books = [
    bookFixture("The Salt Road", [
      copyFixture({ createdAt: at(10, 12) }),
      copyFixture({ createdAt: at(10, 12), unhauledAt: "2026-11-13T00:00:00Z" }),
    ]),
    bookFixture("Glass Orchard", [copyFixture({ createdAt: at(10, 12) }), copyFixture({ createdAt: at(10, 11) })]),
  ];
  it("counts copies, newest first", () => {
    expect(dateAddedOptions(books, false, null)).toEqual([
      { day: "2026-11-12", copies: 2 },
      { day: "2026-11-11", copies: 1 },
    ]);
    expect(dateAddedOptions(books, true, null)[0]).toEqual({ day: "2026-11-12", copies: 3 });
  });
  it("keeps a selected absent day at 0", () => {
    expect(dateAddedOptions(books, false, "2026-11-10").at(-1)).toEqual({ day: "2026-11-10", copies: 0 });
  });
});

describe("dayLabel", () => {
  it("omits the current year only", () => {
    expect(dayLabel("2026-11-12", new Date(2026, 5, 1))).toBe("Nov 12");
    expect(dayLabel("2026-11-12", new Date(2027, 5, 1))).toBe("Nov 12, 2026");
  });
});
