import { describe, expect, it } from "vitest";
import { selectionTargets } from "./eligibility";
import { mkBook, mkSearch } from "./fixtures.test-util";

describe("selectionTargets", () => {
  const books = [
    mkBook("fresh", { coverUrl: null }),
    mkBook("off", { onShelf: false }),
    mkBook("queued"),
    mkBook("ready"),
    mkBook("nf"),
    mkBook("failed"),
    mkBook("applied"),
  ];
  const latest = new Map([
    ["off", mkSearch("s0", "off", "nothing_found")],
    ["queued", mkSearch("s1", "queued", "queued")],
    ["ready", mkSearch("s2", "ready", "ready")],
    ["nf", mkSearch("s3", "nf", "nothing_found")],
    ["failed", mkSearch("s4", "failed", "failed")],
    ["applied", mkSearch("s5", "applied", "applied")],
  ]);

  it("splits the selection by the batch rules, keeping ids in order", () => {
    expect(selectionTargets(books, latest)).toEqual({
      eligible: ["fresh", "applied"],
      unhauled: ["off"],
      alreadyOpen: ["queued", "ready"],
      nothingFound: ["nf", "failed"],
    });
  });

  it("is empty for no books", () => {
    expect(selectionTargets([], latest)).toEqual({ eligible: [], unhauled: [], alreadyOpen: [], nothingFound: [] });
  });
});
