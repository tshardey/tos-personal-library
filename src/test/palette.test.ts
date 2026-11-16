import { describe, expect, it } from "vitest";

const sources = import.meta.glob("/src/**/*.tsx", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

const BANNED =
  /\b(?:bg|text|border|ring|accent|divide|outline|from|to|placeholder)-(?:white|stone|gray|slate|zinc|neutral|red|amber|yellow|green|emerald|blue)\b/g;

describe("palette guard", () => {
  const files = Object.entries(sources).filter(
    ([path]) => !path.endsWith(".test.tsx"),
  );

  it("scans real, non-empty source files", () => {
    expect(files.length).toBeGreaterThan(20);
    for (const [path, src] of files) {
      expect(src.length, `${path} loaded empty`).toBeGreaterThan(0);
    }
  });

  it("uses only design tokens, never raw Tailwind palette colours", () => {
    const offenders: string[] = [];
    for (const [path, src] of files) {
      const hits = new Set(src.match(BANNED) ?? []);
      if (hits.size > 0) offenders.push(`${path}: ${[...hits].join(", ")}`);
    }
    expect(offenders, offenders.join("\n")).toEqual([]);
  });
});
