import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { contrastRatio, themeTokens } from "../lib/contrast";

const EXPECTED: Record<string, string> = {
  "--color-surface": "#0f1115",
  "--color-raised": "#171a21",
  "--color-control": "#232835",
  "--color-line": "#262a33",
  "--color-line-strong": "#2f3440",
  "--color-field": "#6b7285",
  "--color-fg": "#e6e6e6",
  "--color-fg-strong": "#ffffff",
  "--color-muted": "#8a909c",
  "--color-accent": "#e8b44c",
  "--color-on-accent": "#111111",
  "--color-danger": "#f2726b",
  "--color-danger-surface": "#3a1d1f",
  "--color-success": "#7ccf96",
  "--color-notice": "#2a2619",
  "--color-notice-line": "#5c4d24",
};

// Vitest stubs CSS imports (even ?raw) to an empty string, so read the file directly.
// Resolved from this file, so the test passes from any working directory.
const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(resolve(here, "../index.css"), "utf8");
const tokens = themeTokens(css);
const t = (name: string) => tokens[`--color-${name}`];
const backgrounds = ["surface", "raised", "control"];

describe("theme tokens", () => {
  it.each(Object.entries(EXPECTED))("%s is %s", (name, value) => {
    expect(tokens[name]).toBe(value);
  });
});

describe("contrast", () => {
  it("pins the tightest pair", () => {
    expect(contrastRatio("#8a909c", "#232835")).toBeCloseTo(4.59, 2);
  });

  describe.each(["fg", "fg-strong", "muted", "accent", "danger", "success"])(
    "%s text",
    (fg) => {
      it.each(backgrounds)(`is at least 4.5:1 on %s`, (bg) => {
        expect(contrastRatio(t(fg), t(bg))).toBeGreaterThanOrEqual(4.5);
      });
    },
  );

  it.each(backgrounds)("field border is at least 3:1 on %s", (bg) => {
    expect(contrastRatio(t("field"), t(bg))).toBeGreaterThanOrEqual(3);
  });

  it("on-accent text is at least 4.5:1 on accent", () => {
    expect(contrastRatio(t("on-accent"), t("accent"))).toBeGreaterThanOrEqual(4.5);
  });

  it("danger is at least 4.5:1 on danger-surface", () => {
    expect(contrastRatio(t("danger"), t("danger-surface"))).toBeGreaterThanOrEqual(4.5);
  });
});

describe("control borders", () => {
  it("buttons get the field border colour in the base layer", () => {
    expect(css).toMatch(
      /button,\s*\[role="button"\],\s*a\[role="button"\]\s*\{\s*border-color:\s*var\(--color-field\);\s*\}/,
    );
  });
});
