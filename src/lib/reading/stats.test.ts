import { describe, expect, it } from "vitest";
import { bookFixture, copyFixture } from "../flag-fixtures.test-util";
import { ownsBook, readingStats } from "./stats";
import { toStatusMap } from "./status";
import type { ReadStatusRow } from "./types";

const row = (bookId: string, userId: string, over: Partial<ReadStatusRow> = {}): ReadStatusRow => ({
  bookId,
  userId,
  status: "read",
  finishedOn: null,
  source: "app",
  markedAt: "2026-01-01T00:00:00Z",
  ...over,
});
const owned = (title: string, owner: string | null = "a") => bookFixture(title, [copyFixture({ ownerUserId: owner })]);
const opts = { today: "2026-11-15", since: null };

describe("ownsBook", () => {
  it("counts my copies and Shared copies", () => {
    expect(ownsBook(owned("X", "a"), "a")).toBe(true);
    expect(ownsBook(owned("X", null), "a")).toBe(true);
  });
  it("does not count another member's only copy", () => expect(ownsBook(owned("X", "b"), "a")).toBe(false));
  it("does not count a book whose only copies are unhauled", () => {
    const b = bookFixture("X", [copyFixture({ ownerUserId: "a", unhauledAt: "2026-11-01T00:00:00" })]);
    expect(ownsBook(b, "a")).toBe(false);
  });
});

describe("readingStats", () => {
  it("gives 142 of 205 as 69 percent", () => {
    const books = Array.from({ length: 205 }, (_, i) => owned(`B${i}`));
    const rows = books.slice(0, 142).map((b) => row(b.id, "a"));
    const s = readingStats(books, toStatusMap(rows), "a", opts);
    expect(s).toMatchObject({ owned: 205, read: 142, pct: 69 });
  });
  it("gives 0 percent when nothing is owned", () => {
    expect(readingStats([], new Map(), "a", opts)).toEqual({
      owned: 0,
      read: 0,
      pct: 0,
      readThisYear: 0,
      readSince: null,
      dnf: 0,
    });
  });
  it("does not count DNF as read, and counts it as dnf", () => {
    const b = owned("X");
    expect(readingStats([b], toStatusMap([row(b.id, "a", { status: "dnf" })]), "a", opts)).toMatchObject({
      read: 0,
      dnf: 1,
    });
  });
  it("does not count a cleared row as read (Review Focus 1)", () => {
    const b = owned("X");
    const map = toStatusMap([row(b.id, "a", { status: "cleared" })]);
    expect(readingStats([b], map, "a", opts)).toMatchObject({ owned: 1, read: 0, dnf: 0 });
  });
  it("counts this year from Jan 1 through today only", () => {
    const dates = ["2025-12-31", "2026-01-01", "2026-11-15", "2026-11-16"];
    const books = dates.map((d) => owned(d));
    const rows = books.map((b, i) => row(b.id, "a", { finishedOn: dates[i] }));
    expect(readingStats(books, toStatusMap(rows), "a", opts).readThisYear).toBe(2);
  });
  it("counts since a date, and null when since is null", () => {
    const books = [owned("old"), owned("new")];
    const map = toStatusMap([
      row("old", "a", { finishedOn: "2026-02-01" }),
      row("new", "a", { finishedOn: "2026-06-01" }),
    ]);
    expect(readingStats(books, map, "a", { today: "2026-11-15", since: "2026-03-01" }).readSince).toBe(1);
    expect(readingStats(books, map, "a", opts).readSince).toBeNull();
  });
  it("counts a read book with no date in read only", () => {
    const b = owned("X");
    const s = readingStats([b], toStatusMap([row(b.id, "a")]), "a", { today: "2026-11-15", since: "2000-01-01" });
    expect(s).toMatchObject({ read: 1, readThisYear: 0, readSince: 0 });
  });
  it("counts an unowned read book nowhere", () => {
    const b = owned("X", "b");
    const s = readingStats([b], toStatusMap([row(b.id, "a", { finishedOn: "2026-05-01" })]), "a", {
      today: "2026-11-15",
      since: "2026-01-01",
    });
    expect(s).toEqual({ owned: 0, read: 0, pct: 0, readThisYear: 0, readSince: 0, dnf: 0 });
  });
});
