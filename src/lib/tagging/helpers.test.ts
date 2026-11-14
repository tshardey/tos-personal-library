import { describe, expect, it } from "vitest";
import { mkBook } from "../covers/fixtures.test-util";
import { booksCoveredBy, NEW_TAGS_PER_BOOK_ESTIMATE_MICRO, TAG_PER_BOOK_ESTIMATE_MICRO } from "./cost";
import { newestJobByBook, newTagsEligible, retagAllEligible, runEligible, runProgress, vocabVersion } from "./eligibility";
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
    expect(TAG_PER_BOOK_ESTIMATE_MICRO).toBe(4300);
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
