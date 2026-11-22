import { describe, expect, it } from "vitest";
import { mkBook } from "../covers/fixtures.test-util";
import {
  booksCoveredBy,
  FULL_TAG_PER_BOOK_ESTIMATE_MICRO,
  NEW_TAGS_PER_BOOK_ESTIMATE_MICRO,
  SERIES_PER_BOOK_ESTIMATE_MICRO,
  SERIES_SEARCH_JOB_ESTIMATE_MICRO,
  TAG_PER_BOOK_ESTIMATE_MICRO,
  UNSURE_FOLLOWUP_RATE,
} from "./cost";
import {
  newestJobByBook,
  newTagsEligible,
  retagAllEligible,
  runEligible,
  runProgress,
  seriesEligible,
  seriesProgress,
  seriesRetryCount,
  vocabVersion,
} from "./eligibility";
import { groupLibraryTags } from "./group";
import { tagIdFromLabel } from "./slug";
import type { AiBudget, BookCardMeta, LibraryTag, TagJob } from "./types";

const job = (id: string, bookId: string, status: TagJob["status"], createdAt: string, runId: string | null = null): TagJob => ({
  id, bookId, runId, kind: "full", reason: "run", status, attempts: 0, claimedAt: null, retryAt: null, errorCode: null, createdAt,
});
const card = (bookId: string, vocabVersion: number): BookCardMeta => ({ bookId, vocabVersion, writtenAt: "2026-11-01T00:00:00Z" });
const tag = (id: string, category: LibraryTag["category"], v = 1): LibraryTag => ({
  id, label: id.toUpperCase(), category, active: true, addedVersion: v, householdId: null,
});

describe("eligibility", () => {
  it("vocabVersion is the max addedVersion", () => {
    expect(vocabVersion([tag("a", "trope"), tag("b", "mood", 4), tag("c", "era", 2)])).toBe(4);
    expect(vocabVersion([])).toBe(1);
  });

  it("newestJobByBook picks newest, ties by id", () => {
    const m = newestJobByBook([
      job("j1", "a", "failed", "2026-11-01T00:00:00Z"),
      job("j2", "a", "done", "2026-11-02T00:00:00Z"),
      job("j3", "b", "done", "2026-11-01T00:00:00Z"),
      job("j4", "b", "failed", "2026-11-01T00:00:00Z"),
    ]);
    expect(m.get("a")?.id).toBe("j2");
    expect(m.get("b")?.id).toBe("j4");
  });

  it("runEligible follows D5 in catalogue order", () => {
    const books = [
      mkBook("carded"), mkBook("unhauled", { onShelf: false }), mkBook("queued"), mkBook("failed"),
      mkBook("recovered"), mkBook("fresh"),
    ];
    const cards = new Map([["carded", card("carded", 1)]]);
    const jobs = [
      job("1", "queued", "queued", "2026-11-02T00:00:00Z"),
      job("2", "failed", "failed", "2026-11-02T00:00:00Z"),
      job("3", "recovered", "failed", "2026-11-01T00:00:00Z"),
      job("4", "recovered", "done", "2026-11-02T00:00:00Z"),
    ];
    expect(runEligible(books, cards, jobs)).toEqual(["recovered", "fresh"]);
  });

  it("retagAllEligible is runEligible without the no-card rule, in catalogue order", () => {
    const books = [
      mkBook("carded"), mkBook("unhauled", { onShelf: false }), mkBook("queued"), mkBook("busy"), mkBook("failed"),
      mkBook("recovered"), mkBook("fresh"),
    ];
    const jobs = [
      job("1", "queued", "queued", "2026-11-02T00:00:00Z"),
      job("2", "busy", "processing", "2026-11-02T00:00:00Z"),
      job("3", "failed", "failed", "2026-11-02T00:00:00Z"),
      job("4", "recovered", "failed", "2026-11-01T00:00:00Z"),
      job("5", "recovered", "done", "2026-11-02T00:00:00Z"),
      job("6", "carded", "done", "2026-11-01T00:00:00Z"),
    ];
    expect(retagAllEligible(books, jobs)).toEqual(["carded", "recovered", "fresh"]);
    expect(retagAllEligible([], jobs)).toEqual([]);
  });

  it("newTagsEligible takes cards below the version only", () => {
    const cards = new Map([["old", card("old", 1)], ["cur", card("cur", 3)], ["busy", card("busy", 1)], ["bad", card("bad", 1)]]);
    const jobs = [job("1", "busy", "processing", "2026-11-02T00:00:00Z"), job("2", "bad", "failed", "2026-11-02T00:00:00Z")];
    expect(newTagsEligible(cards, 3, jobs)).toEqual(["old"]);
  });

  it("runProgress counts done and failed of the run", () => {
    const jobs = [
      job("1", "a", "done", "t", "r1"), job("2", "b", "failed", "t", "r1"),
      job("3", "c", "queued", "t", "r1"), job("4", "d", "done", "t", "r2"),
    ];
    expect(runProgress(jobs, "r1")).toEqual({ done: 2, total: 3 });
    expect(runProgress(jobs, "nope")).toBeNull();
    expect(runProgress(jobs, null)).toBeNull();
  });
});

describe("cost", () => {
  const b = (o: Partial<AiBudget> = {}): AiBudget => ({
    month: "2026-11-01", spentMicro: 0, budgetMicro: 5_000_000, reserveMicro: 80_000,
    globalSpentMicro: 0, globalBudgetMicro: 5_000_000, ...o,
  });
  it("exposes the measured estimates", () => {
    expect(TAG_PER_BOOK_ESTIMATE_MICRO).toBe(6800);
    expect(NEW_TAGS_PER_BOOK_ESTIMATE_MICRO).toBe(3600);
  });
  it("booksCoveredBy floors, counts the last claim's reserve, and is 0 below it", () => {
    expect(booksCoveredBy(b(), 4300)).toBe(1145);
    expect(booksCoveredBy(b({ spentMicro: 4_930_000 }), 4300)).toBe(0);
    expect(booksCoveredBy(b({ spentMicro: 4_920_000 }), 4300)).toBe(1);
    expect(booksCoveredBy(b({ spentMicro: 4_900_000 }), 4300)).toBe(5);
    expect(booksCoveredBy(b({ globalSpentMicro: 4_950_000 }), 4300)).toBe(0);
  });
});

describe("tagIdFromLabel", () => {
  const ok = /^[a-z0-9]+(-[a-z0-9]+)*$/;
  it("slugs labels", () => {
    expect(tagIdFromLabel("Cozy Mystery!")).toBe("cozy-mystery");
    expect(tagIdFromLabel("Ünder  the Sea")).toBe("under-the-sea");
    expect(tagIdFromLabel("LGBTQ+ hero")).toBe("lgbtq-hero");
  });
  it("is empty with no usable characters", () => {
    expect(tagIdFromLabel("  !!! ")).toBe("");
    expect(tagIdFromLabel("")).toBe("");
  });
  it("cuts long labels at a hyphen within 40", () => {
    const id = tagIdFromLabel("alpha bravo charlie delta echo foxtrot golf hotel india juliet kilo lima");
    expect(id.length).toBeLessThanOrEqual(40);
    expect(id).toBe("alpha-bravo-charlie-delta-echo-foxtrot");
    expect(id).toMatch(ok);
    const long = tagIdFromLabel("a".repeat(60));
    expect(long).toHaveLength(40);
    expect(tagIdFromLabel("x".repeat(39) + " yy")).toBe("x".repeat(39));
  });
});

describe("groupLibraryTags", () => {
  it("orders by D3 and puts unknown ids under Other", () => {
    const vocab = [tag("slow", "mood"), tag("elf", "creature"), tag("dragon", "creature"), tag("heist", "trope")];
    const g = groupLibraryTags(["slow", "mystery-id", "dragon", "heist", "elf"], vocab);
    expect(g.map((x) => x.category)).toEqual(["trope", "creature", "mood", "other"]);
    expect(g[1].label).toBe("Creatures and beings");
    expect(g[1].tags.map((t) => t.id)).toEqual(["dragon", "elf"]);
    expect(g[3]).toEqual({ category: "other", label: "Other", tags: [{ id: "mystery-id", label: "mystery-id" }] });
    expect(groupLibraryTags([], vocab)).toEqual([]);
  });
});

describe("series eligibility", () => {
  const sjob = (id: string, bookId: string, status: TagJob["status"], createdAt: string, runId: string | null = null): TagJob => ({
    ...job(id, bookId, status, createdAt, runId), kind: "series", reason: "series",
  });
  const cards = new Map(
    ["ok", "unhauled", "noseries", "nameset", "volset", "checked", "open", "failed", "fullfailed", "retrydone"].map((id) => [id, card(id, 1)] as const),
  );

  it("estimate constant", () => {
    expect(SERIES_PER_BOOK_ESTIMATE_MICRO).toBe(5000);
    expect(SERIES_SEARCH_JOB_ESTIMATE_MICRO).toBe(36700);
    expect(UNSURE_FOLLOWUP_RATE).toBe(0.1);
    expect(FULL_TAG_PER_BOOK_ESTIMATE_MICRO).toBe(TAG_PER_BOOK_ESTIMATE_MICRO + Math.ceil(0.1 * SERIES_SEARCH_JOB_ESTIMATE_MICRO));
    expect(FULL_TAG_PER_BOOK_ESTIMATE_MICRO).toBe(10470);
  });

  it("seriesEligible keeps carded, blank, unmarked, unchecked books in catalogue order", () => {
    const books = [
      mkBook("nocard"),
      mkBook("ok"),
      mkBook("noseries", { seriesName: "Wrenfold Tales" }),
      mkBook("nameset", { userEditedFields: ["seriesName"] }),
      mkBook("volset", { userEditedFields: ["seriesVolume"] }),
      mkBook("checked"),
      mkBook("open"),
      mkBook("failed"),
      mkBook("fullfailed"),
      mkBook("unhauled", { onShelf: false }),
    ];
    const jobs = [
      sjob("1", "open", "processing", "2026-11-02T00:00:00Z"),
      job("3", "fullfailed", "failed", "2026-11-02T00:00:00Z"),
    ];
    expect(seriesEligible(books, cards, new Set(["checked"]), jobs)).toEqual(["ok", "failed", "unhauled"]);
  });

  it("seriesEligible retries a failed series check but not a failed full or new_tags job", () => {
    const books = [mkBook("failed"), mkBook("fullfailed"), mkBook("retrydone"), mkBook("checked"), mkBook("open"), mkBook("noseries", { seriesName: "Wrenfold Tales" }), mkBook("nameset", { userEditedFields: ["seriesName"] })];
    const jobs = [
      job("0", "failed", "done", "2026-11-01T00:00:00Z"),
      sjob("1", "failed", "failed", "2026-11-02T00:00:00Z"),
      sjob("2", "fullfailed", "failed", "2026-11-01T00:00:00Z"),
      { ...job("3", "fullfailed", "failed", "2026-11-02T00:00:00Z"), kind: "new_tags" as const, reason: "new_tags" as const },
      // An older failed series check no longer counts once a newer job finished.
      sjob("4", "retrydone", "failed", "2026-11-01T00:00:00Z"),
      job("5", "retrydone", "done", "2026-11-02T00:00:00Z"),
      sjob("6", "checked", "failed", "2026-11-02T00:00:00Z"),
      sjob("7", "open", "failed", "2026-11-01T00:00:00Z"),
      sjob("8", "open", "queued", "2026-11-02T00:00:00Z"),
      sjob("9", "noseries", "failed", "2026-11-02T00:00:00Z"),
      sjob("10", "nameset", "failed", "2026-11-02T00:00:00Z"),
    ];
    const eligible = seriesEligible(books, cards, new Set(["checked"]), jobs);
    expect(eligible).toEqual(["failed", "retrydone"]);
    expect(seriesRetryCount(eligible, jobs)).toBe(1);
    expect(seriesRetryCount([], jobs)).toBe(0);
  });

  it("seriesProgress counts a run that mixes first checks and retries", () => {
    const jobs = [
      sjob("1", "a", "failed", "2026-11-01T00:00:00Z", "old"),
      sjob("2", "a", "done", "2026-11-03T00:00:00Z", "new"),
      sjob("3", "b", "queued", "2026-11-03T00:00:00Z", "new"),
      sjob("4", "c", "failed", "2026-11-03T00:00:00Z", "new"),
    ];
    expect(seriesProgress(jobs)).toEqual({ done: 2, total: 3 });
  });

  it("seriesProgress counts done and failed of the newest open series run", () => {
    const jobs = [
      sjob("1", "a", "done", "2026-11-01T00:00:00Z", "old"),
      sjob("2", "a", "queued", "2026-11-01T00:00:00Z", "old"),
      sjob("3", "a", "done", "2026-11-03T00:00:00Z", "new"),
      sjob("4", "b", "failed", "2026-11-03T00:00:00Z", "new"),
      sjob("5", "c", "queued", "2026-11-03T00:00:00Z", "new"),
      job("6", "d", "queued", "2026-11-04T00:00:00Z", "full-run"),
    ];
    expect(seriesProgress(jobs)).toEqual({ done: 2, total: 3 });
  });

  it("seriesProgress ignores a queued follow-up with no run", () => {
    const followUp = sjob("f", "a", "queued", "2026-11-05T00:00:00Z", null);
    expect(seriesProgress([followUp])).toBeNull();
    const jobs = [
      followUp,
      sjob("1", "a", "done", "2026-11-03T00:00:00Z", "run"),
      sjob("2", "b", "queued", "2026-11-03T00:00:00Z", "run"),
    ];
    expect(seriesProgress(jobs)).toEqual({ done: 1, total: 2 });
  });

  it("seriesProgress is null with no open series job", () => {
    expect(seriesProgress([sjob("1", "a", "done", "2026-11-01T00:00:00Z", "r")])).toBeNull();
    expect(seriesProgress([job("2", "a", "queued", "2026-11-01T00:00:00Z", "r")])).toBeNull();
    expect(seriesProgress([])).toBeNull();
  });
});
