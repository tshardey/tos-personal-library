import { expect, type Locator, type Page } from "@playwright/test";
import { FIRST, SECOND, SURNAMES } from "./routes";
import type { TestUser } from "./supabase";
import { insert } from "./tag-jobs";

/**
 * Accessibility and seeding helpers for the e2e specs (Plan 9, D11). Invented titles and authors
 * only; every cover is a generated gradient answered from a `.invalid` host.
 */

const CONTROLS = 'button, a[href], [role="tab"], select, input[type="checkbox"]';

/**
 * Every visible button, link, tab, select and checkbox in `scope` has a box at least `min` x `min`
 * (D11). A checkbox may meet it through its wrapping label. Inline links inside a sentence (`<p>`)
 * are skipped.
 */
export async function expectTapTargets(page: Page, scope: Locator, min = 44): Promise<void> {
  await expect(scope).toBeVisible();
  const small = await scope.evaluate(
    (root, [selector, least]) => {
      const out: string[] = [];
      const visible = (el: Element) => {
        const r = el.getBoundingClientRect();
        const s = getComputedStyle(el);
        return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none";
      };
      for (const el of Array.from(root.querySelectorAll(selector))) {
        if (!visible(el)) continue;
        if (el.tagName === "A" && el.closest("p")) continue;
        let box = el.getBoundingClientRect();
        if (el instanceof HTMLInputElement && el.type === "checkbox") {
          const label = el.closest("label");
          if (label) box = label.getBoundingClientRect();
        }
        // Half a pixel of rounding is not a miss.
        if (box.width + 0.5 < least || box.height + 0.5 < least) {
          const name = el.getAttribute("aria-label") ?? el.textContent?.trim().slice(0, 40) ?? "";
          out.push(`${el.tagName.toLowerCase()} "${name}" ${Math.round(box.width)}x${Math.round(box.height)}`);
        }
      }
      return out;
    },
    [CONTROLS, min] as const,
  );
  expect(small, `controls smaller than ${min}x${min}px`).toEqual([]);
}

/** After keyboard focus, `target` is focused and shows the accent focus ring (D11). */
export async function expectFocusRing(page: Page, target: Locator): Promise<void> {
  await expect(target).toBeFocused();
  const ring = await target.evaluate((el) => {
    const s = getComputedStyle(el);
    return { style: s.outlineStyle, color: s.outlineColor, focusVisible: el.matches(":focus-visible") };
  });
  expect(ring).toEqual({ style: "solid", color: "rgb(232, 180, 76)", focusVisible: true });
}

/**
 * `n` invented books in the `e2e/routes.ts` title pattern, one copy each: every 5th Deluxe, every
 * 7th Signed, and a fake cover URL on two thirds of them. Returned in insertion order.
 */
export async function seedShelf(user: TestUser, n: number): Promise<{ id: string; title: string }[]> {
  const books = Array.from({ length: n }, (_, i) => ({
    household_id: user.householdId,
    title: `The ${FIRST[i % 10]} ${SECOND[Math.floor(i / 10) % 10]} ${String(i + 1).padStart(4, "0")}`,
    authors: [`${FIRST[Math.floor(i / 10) % 10]} ${SURNAMES[i % 10]}`],
    cover_url: i % 3 === 2 ? null : `https://covers.invalid/${i}.svg`,
  }));
  const rows = await insert<{ id: string; title: string }>(user, "books", books);
  const byTitle = new Map(rows.map((r) => [r.title, r.id]));
  const ordered = books.map((b) => ({ id: byTitle.get(b.title)!, title: b.title }));
  await insert(
    user,
    "copies",
    ordered.map((b, i) => ({ book_id: b.id, origin: "manual", deluxe: (i + 1) % 5 === 0, signed: (i + 1) % 7 === 0 })),
  );
  return ordered;
}

/** Answers `https://covers.invalid/*` with a generated two-colour SVG gradient (no real cover is fetched). */
export async function routeFakeCovers(page: Page): Promise<void> {
  await page.route(/^https:\/\/covers\.invalid\//, (route) => {
    const n = Number(/\/(\d+)\.svg/.exec(route.request().url())?.[1] ?? 0);
    const a = (n * 47) % 360;
    const b = (a + 70) % 360;
    const svg =
      `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="300" viewBox="0 0 200 300">` +
      `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">` +
      `<stop offset="0" stop-color="hsl(${a} 55% 45%)"/><stop offset="1" stop-color="hsl(${b} 60% 25%)"/>` +
      `</linearGradient></defs><rect width="200" height="300" fill="url(#g)"/></svg>`;
    return route.fulfill({ status: 200, contentType: "image/svg+xml", body: svg });
  });
}
