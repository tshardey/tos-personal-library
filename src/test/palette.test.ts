import { describe, expect, it } from "vitest";

const sources = import.meta.glob("/src/**/*.{ts,tsx}", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

const BANNED =
  /\b(?:bg|text|border|ring|accent|divide|outline|from|to|placeholder)-(?:white|stone|gray|slate|zinc|neutral|red|amber|yellow|green|emerald|blue)\b/g;

/** Tests, the guard itself and test-only helpers (only ever imported by tests) are not app code. */
const TEST_ONLY =
  /(?:\.test\.tsx?|\.test-util\.ts|\/testkit\.ts|\/fixtures\.ts)$|^\/src\/test\//;

describe("palette guard", () => {
  const files = Object.entries(sources).filter(([path]) => !TEST_ONLY.test(path));

  it("scans real, non-empty source files, .ts style files included", () => {
    // About 70 .tsx and 80 .ts app files today; the floor catches a broken glob.
    expect(files.length).toBeGreaterThan(100);
    const paths = files.map(([path]) => path);
    expect(paths).toContain("/src/components/ui/button-styles.ts");
    expect(paths).toContain("/src/components/nav/nav-styles.ts");
    expect(paths.some((path) => path.endsWith(".test.ts") || path.endsWith(".test.tsx"))).toBe(false);
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
