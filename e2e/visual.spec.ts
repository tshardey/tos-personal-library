import { expect, test, type Page } from "@playwright/test";
import { routeFakeCovers, seedShelf } from "./a11y";
import { newMemberOf, newUserWithHousehold, signIn, type TestUser } from "./supabase";

/**
 * Screenshots for a by-eye check against the mockups (Plan 9). Skipped unless E2E_SCREENSHOTS=1.
 * They land in E2E_SCREENSHOT_DIR (git-ignored under .superpowers/) and are never committed.
 *
 *   E2E_SUPABASE_PUBLISHABLE_KEY=<local key> docker compose run --rm -e E2E_SCREENSHOTS=1 \
 *     -e E2E_SCREENSHOT_DIR=.superpowers/screenshots/plan9/pr1 e2e npx playwright test e2e/visual.spec.ts
 */

const dir = process.env.E2E_SCREENSHOT_DIR ?? ".superpowers/screenshots/plan9/current";
const WIDTHS = [390, 1280];

test.skip(process.env.E2E_SCREENSHOTS !== "1", "screenshots only on request (E2E_SCREENSHOTS=1)");

const nav = (page: Page) => page.getByRole("navigation", { name: "Main" });
const count = (page: Page) => page.locator("p[aria-live='polite']");

/** Lets lazy data and images settle; a page that keeps polling doesn't hold the run. */
async function settle(page: Page) {
  await page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => undefined);
  await page.waitForTimeout(400);
}

async function library(page: Page) {
  await page.goto("#/");
  await expect(count(page)).toHaveText("36 books");
}

async function closeOverlays(page: Page) {
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
}

interface Ctx {
  bookId: string;
}

/** Each state leaves the page ready for its screenshot; `after` puts it back. */
const STATES: { name: string; open(page: Page, ctx: Ctx): Promise<void>; after?(page: Page): Promise<void> }[] = [
  { name: "library", open: library },
  {
    name: "add-chooser",
    async open(page) {
      await library(page);
      await nav(page).getByRole("button", { name: "Add" }).click();
      await expect(page.getByRole("link", { name: "Type it in" })).toBeVisible();
    },
    after: closeOverlays,
  },
  {
    name: "more",
    async open(page) {
      await library(page);
      await nav(page).getByRole("button", { name: "More" }).click();
      await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
    },
    after: closeOverlays,
  },
  {
    // The Covers filter on the library (its batch footer sits above the tab bar), or the Covers tab's page
    // when the cover finder isn't available on this stack.
    name: "covers-tab",
    async open(page) {
      await library(page);
      const filter = page.getByLabel("Covers", { exact: true });
      if ((await filter.count()) > 0) {
        await filter.selectOption("no_cover");
      } else {
        await nav(page).getByRole("link", { name: /^Covers/ }).click();
        await expect(page).toHaveURL(/#\/covers$/);
      }
    },
    async after(page) {
      const filter = page.getByLabel("Covers", { exact: true });
      if ((await filter.count()) > 0) await filter.selectOption("all");
    },
  },
  {
    name: "scan-start",
    async open(page) {
      await page.goto("#/scan");
      await expect(page.getByRole("button", { name: "Start scanning" })).toBeVisible();
    },
  },
  {
    name: "book",
    async open(page, { bookId }) {
      await page.goto(`#/book/${bookId}`);
      await expect(page.getByRole("link", { name: "Back to library" })).toBeVisible();
    },
  },
  {
    name: "reading-history",
    async open(page) {
      await page.goto("#/reading");
    },
  },
  {
    name: "tag-suggestions",
    async open(page) {
      await page.goto("#/tags");
    },
  },
  {
    name: "edition-labels",
    async open(page) {
      await page.goto("#/editions");
      await expect(page.getByRole("heading", { name: "Edition labels" })).toBeVisible();
    },
  },
  {
    name: "import",
    async open(page) {
      await page.goto("#/import");
    },
  },
  {
    name: "photos",
    async open(page) {
      await page.goto("#/inbox");
      await expect(page.getByRole("heading", { name: "Photo inbox" })).toBeVisible();
    },
  },
  {
    name: "covers-review",
    async open(page) {
      await page.goto("#/covers");
      await expect(page.getByRole("heading", { name: "Covers to review" })).toBeVisible();
    },
  },
  // Plan 9 PR 2: the library toolbar, Filters (the sheet at 390, the panel at 1280), select mode,
  // the smallest and largest cover sizes, and a series wall.
  {
    name: "library-filters-open",
    async open(page) {
      await library(page);
      await page.getByRole("button", { name: /^Filters/ }).click();
      await expect(page.getByRole("group", { name: "Owner & Copy" })).toBeVisible();
    },
    async after(page) {
      if ((await page.getByRole("dialog", { name: "Filters" }).count()) > 0) await closeOverlays(page);
      else await page.getByRole("button", { name: /^Filters/ }).click();
      await expect(page.getByRole("group", { name: "Owner & Copy" })).toHaveCount(0);
    },
  },
  {
    // With a filter on, so the Filters button carries its count badge beside the search box.
    name: "library-select",
    async open(page) {
      await library(page);
      await page.getByRole("button", { name: /^Filters/ }).click();
      await page.getByRole("button", { name: "Deluxe", exact: true }).click();
      const sheet = page.getByRole("dialog", { name: "Filters" });
      if ((await sheet.count()) > 0) await sheet.getByRole("button", { name: "Done" }).click();
      else await page.getByRole("button", { name: /^Filters/ }).click();
      await expect(count(page)).toHaveText("7 books");
      await page.getByRole("button", { name: "Select", exact: true }).click();
      const cards = page.locator("[data-book-id]");
      for (let i = 0; i < 3; i++) await cards.nth(i).getByRole("checkbox").check();
      await expect(page.getByRole("region", { name: "Selection" }).getByText("3 selected")).toBeVisible();
    },
    async after(page) {
      await page.getByRole("region", { name: "Selection" }).getByRole("button", { name: "Done" }).click();
      await page.getByRole("button", { name: "Remove filter: Deluxe" }).click();
      await expect(count(page)).toHaveText("36 books");
    },
  },
  ...(
    [
      ["library-size-1", "Smaller covers", 3],
      ["library-size-5", "Larger covers", 1],
    ] as const
  ).map(([name, step, times]) => ({
    name,
    async open(page: Page) {
      await library(page);
      const phone = (page.viewportSize()?.width ?? 0) < 640;
      if (phone) await page.getByRole("button", { name: /^Filters/ }).click();
      for (let i = 0; i < times; i++) await page.getByRole("button", { name: step }).click();
      if (phone) await page.getByRole("dialog", { name: "Filters" }).getByRole("button", { name: "Done" }).click();
      await expect(page.locator(".cover-grid")).toHaveAttribute("data-cover-size", name.slice(-1));
    },
    async after(page: Page) {
      // Back to the default size, so the states after this one see the usual wall.
      await page.evaluate(() => window.localStorage.removeItem("tpl_cover_size"));
      await page.reload();
      await expect(page.locator(".cover-grid")).toHaveAttribute("data-cover-size", "4");
    },
  })),
  {
    // Four of the shelf's books put in one invented series, volumes in reverse title order.
    name: "library-series",
    async open(page) {
      const { supabaseEnv } = await import("./supabase");
      const { url, key } = supabaseEnv();
      for (const [i, book] of books.slice(0, 4).entries()) {
        const res = await fetch(`${url}/rest/v1/books?id=eq.${book.id}`, {
          method: "PATCH",
          headers: {
            apikey: key,
            Authorization: `Bearer ${owner.accessToken}`,
            "Content-Type": "application/json",
            "Content-Profile": "library",
          },
          body: JSON.stringify({ series_name: "The Lantern Cycle", series_volume: 4 - i }),
        });
        expect(res.ok, `series PATCH answered ${res.status}`).toBe(true);
      }
      await page.goto(`#/series/${encodeURIComponent("The Lantern Cycle")}`);
      // A reload, so the catalog is read again with the series in it.
      await page.reload();
      await expect(count(page)).toHaveText("4 books");
    },
    async after(page) {
      await page.goto("#/");
      await expect(count(page)).toHaveText("36 books");
    },
  },
];

let owner: TestUser;
let books: { id: string; title: string }[];

test.beforeAll(async () => {
  owner = await newUserWithHousehold("Member A");
  await newMemberOf(owner, "Member B");
  books = await seedShelf(owner, 36);
});

for (const width of WIDTHS) {
  test(`screenshots at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: width < 640 ? 844 : 800 });
    await routeFakeCovers(page);
    await signIn(page, owner);
    for (const state of STATES) {
      await state.open(page, { bookId: books[0].id });
      await settle(page);
      await page.screenshot({ path: `${dir}/${state.name}-${width}.png`, fullPage: false });
      await state.after?.(page);
      // Escape returns focus to the opener; drop it so its ring doesn't show in the next state.
      await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    }
  });

  test(`sign-in screenshot at ${width}px`, async ({ browser, baseURL }) => {
    const context = await browser.newContext({ baseURL, viewport: { width, height: width < 640 ? 844 : 800 } });
    const page = await context.newPage();
    await page.goto("#/");
    await expect(page.getByRole("button", { name: /sign in|send/i }).first()).toBeVisible();
    await settle(page);
    await page.screenshot({ path: `${dir}/sign-in-${width}.png`, fullPage: false });
    await context.close();
  });
}
