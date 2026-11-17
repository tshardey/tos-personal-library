import { expect, test, type Locator, type Page } from "@playwright/test";
import { expectFocusRing, expectTapTargets, routeFakeCovers, seedShelf } from "./a11y";
import { newUserWithHousehold, signIn, type TestUser } from "./supabase";
import { insert } from "./tag-jobs";

/**
 * Plan 9 PR 2 (D4–D7, D11): the library's pinned toolbar, the Filters sheet and panel, sort and
 * cover size kept per device, the filter chips, and the bottom bars clearing the wall. Invented
 * titles and authors only; covers are generated gradients.
 */

const TOTAL = 41;
// seedShelf's authors sort in the same order as its titles, so one extra book sorts first by
// author ("Aalderink" before "Abernathy") and last by title ("Zinnia" after "The ...").
const BY_AUTHOR_FIRST = "Zinnia Quay Almanac";

let user: TestUser;

test.beforeAll(async () => {
  user = await newUserWithHousehold("Member A");
  await seedShelf(user, 40);
  const [extra] = await insert<{ id: string }>(user, "books", [
    { household_id: user.householdId, title: BY_AUTHOR_FIRST, authors: ["Petra Aalderink"], cover_url: null },
  ]);
  await insert(user, "copies", [{ book_id: extra.id, origin: "manual" }]);
});

const count = (page: Page) => page.locator("p[aria-live='polite']");
const nav = (page: Page) => page.getByRole("navigation", { name: "Main" });
const search = (page: Page) => page.getByRole("searchbox", { name: "Search books" });
const filtersButton = (page: Page) => page.getByRole("button", { name: /^Filters/ });
const sheet = (page: Page) => page.getByRole("dialog", { name: "Filters" });
const pinned = (page: Page) => page.locator("div.sticky").filter({ has: search(page) });
const cards = (page: Page) => page.locator("[data-book-id]");
const selection = (page: Page) => page.getByRole("region", { name: "Selection" });

async function open(page: Page) {
  await routeFakeCovers(page);
  await signIn(page, user);
  await page.goto("#/");
  await expect(count(page)).toHaveText(`${TOTAL} books`);
}

async function done(page: Page) {
  await sheet(page).getByRole("button", { name: "Done" }).click();
  await expect(sheet(page)).toBeHidden();
}

async function scrollToEnd(page: Page) {
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await expect
    .poll(() =>
      page.evaluate(() => Math.ceil(window.scrollY + window.innerHeight) >= document.documentElement.scrollHeight - 1),
    )
    .toBe(true);
}

async function box(target: Locator) {
  const b = await target.boundingBox();
  expect(b, "the element has a box").not.toBeNull();
  return b!;
}

/** How many cards share the first card's row. */
async function firstRow(page: Page): Promise<number> {
  const ys = await cards(page).evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().y)));
  return ys.filter((y) => y === ys[0]).length;
}

const firstTitle = (page: Page) => cards(page).first().locator("p").first();

/** Presses Tab until `target` has focus (at most `limit` presses). */
async function tabTo(page: Page, target: Locator, limit = 40) {
  for (let i = 0; i < limit; i++) {
    if (await target.evaluate((el) => el === document.activeElement)) return;
    await page.keyboard.press("Tab");
  }
  await expect(target).toBeFocused();
}

test.describe("phone (390px)", () => {
  test("pinned: search, Filters and Select stay in view at the bottom of the wall", async ({ page }) => {
    await open(page);
    await scrollToEnd(page);
    expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(1000);
    await expect(search(page)).toBeInViewport();
    await expect(filtersButton(page)).toBeInViewport();
    await expect(page.getByRole("button", { name: "Select", exact: true })).toBeInViewport();
  });

  test("sort: Author in the sheet reorders the wall and survives a reload", async ({ page }) => {
    await open(page);
    await expect(firstTitle(page)).toHaveText("The Amber Atlas 0001");
    await filtersButton(page).click();
    const sort = sheet(page).getByLabel("Sort", { exact: true });
    await expect(sort).toHaveValue("title");
    await sort.selectOption({ label: "Author" });
    await done(page);
    await expect(firstTitle(page)).toHaveText(BY_AUTHOR_FIRST);

    await page.reload();
    await expect(count(page)).toHaveText(`${TOTAL} books`);
    await expect(firstTitle(page)).toHaveText(BY_AUTHOR_FIRST);
    await filtersButton(page).click();
    await expect(sheet(page).getByLabel("Sort", { exact: true })).toHaveValue("author");
  });

  test("cover size: Smaller covers twice gives four to a row, kept after a reload", async ({ page }) => {
    await open(page);
    expect(await firstRow(page)).toBe(2);
    await filtersButton(page).click();
    const smaller = sheet(page).getByRole("button", { name: "Smaller covers" });
    await smaller.click();
    await smaller.click();
    await done(page);
    await expect(page.locator(".cover-grid")).toHaveAttribute("data-cover-size", "2");
    expect(await firstRow(page)).toBe(4);

    await page.reload();
    await expect(count(page)).toHaveText(`${TOTAL} books`);
    await expect(page.locator(".cover-grid")).toHaveAttribute("data-cover-size", "2");
    expect(await firstRow(page)).toBe(4);
  });

  test("chips: Deluxe shows its chip and count, and removing it restores the count", async ({ page }) => {
    await open(page);
    await filtersButton(page).click();
    await sheet(page).getByRole("button", { name: "Deluxe", exact: true }).click();
    await done(page);
    const chip = page.getByRole("button", { name: "Remove filter: Deluxe" });
    await expect(chip).toBeVisible();
    await expect(count(page)).toHaveText("8 books");
    await expect(page.getByRole("button", { name: "Filters, 1 active" })).toBeVisible();
    await chip.click();
    await expect(chip).toHaveCount(0);
    await expect(count(page)).toHaveText(`${TOTAL} books`);
    await expect(page.getByRole("button", { name: "Filters", exact: true })).toBeVisible();
  });

  test("bars: the Selection bar sits above the tab bar and the last card clears it", async ({ page }) => {
    await open(page);
    await page.getByRole("button", { name: "Select", exact: true }).click();
    for (let i = 0; i < 3; i++) await cards(page).nth(i).getByRole("checkbox").check();
    await expect(selection(page).getByText("3 selected")).toBeVisible();
    const bar = await box(selection(page));
    const tabs = await box(nav(page));
    expect(bar.y + bar.height).toBeLessThanOrEqual(tabs.y + 0.5);

    await scrollToEnd(page);
    const last = await box(cards(page).last());
    const barAfter = await box(selection(page));
    expect(last.y + last.height).toBeLessThanOrEqual(barAfter.y + 0.5);
  });

  test("bars: the cover batch footer (No cover) sits above the tab bar and the last card clears it", async ({ page }) => {
    await open(page);
    await filtersButton(page).click();
    const covers = sheet(page).getByLabel("Covers", { exact: true });
    test.skip((await covers.count()) === 0, "the cover finder isn't available on this stack");
    await covers.selectOption("no_cover");
    await done(page);
    await expect(count(page)).toHaveText("14 books");
    const footer = page.locator("div.fixed").filter({ has: page.getByRole("button", { name: "Find covers" }) });
    const bar = await box(footer);
    const tabs = await box(nav(page));
    expect(bar.y + bar.height).toBeLessThanOrEqual(tabs.y + 0.5);

    await scrollToEnd(page);
    const last = await box(cards(page).last());
    const barAfter = await box(footer);
    expect(last.y + last.height).toBeLessThanOrEqual(barAfter.y + 0.5);
  });

  test("tap targets: the pinned block (with chips) and the Filters sheet are 44px or more", async ({ page }) => {
    await open(page);
    await filtersButton(page).click();
    await expectTapTargets(page, sheet(page));
    await sheet(page).getByRole("button", { name: "Deluxe", exact: true }).click();
    await sheet(page).getByRole("button", { name: "Signed", exact: true }).click();
    await done(page);
    await expect(page.getByRole("button", { name: "Clear all" })).toBeVisible();
    await expectTapTargets(page, pinned(page));
  });

  test("keyboard: Tab reaches Filters, Enter opens the sheet, Escape closes it back onto Filters", async ({ page }) => {
    await open(page);
    const button = page.getByRole("button", { name: "Filters", exact: true });
    await tabTo(page, button);
    await expectFocusRing(page, button);
    await page.keyboard.press("Enter");
    await expect(sheet(page)).toBeVisible();
    await expect.poll(() => sheet(page).evaluate((el) => el.contains(document.activeElement))).toBe(true);
    await page.keyboard.press("Escape");
    await expect(sheet(page)).toBeHidden();
    await expectFocusRing(page, button);
  });
});

test.describe("computer (1280px)", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test("the panel opens under the toolbar and pushes the wall down; Escape closes it", async ({ page }) => {
    await open(page);
    const grid = page.locator(".cover-grid");
    const before = await box(grid);
    await filtersButton(page).click();
    const panel = page.getByRole("region", { name: "Filters" });
    await expect(panel).toBeVisible();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    const button = await box(filtersButton(page));
    const panelBox = await box(panel);
    expect(panelBox.y).toBeGreaterThanOrEqual(button.y + button.height);
    const after = await box(grid);
    expect(after.y).toBeGreaterThan(before.y + 50);

    await panel.getByRole("button", { name: "Deluxe", exact: true }).focus();
    await page.keyboard.press("Escape");
    await expect(panel).toHaveCount(0);
    await expect(filtersButton(page)).toBeFocused();
  });

  test("Smaller covers changes the column count from six, and Sort is in the toolbar", async ({ page }) => {
    await open(page);
    expect(await firstRow(page)).toBe(6);
    const toolbar = pinned(page);
    await expect(toolbar.getByLabel("Sort", { exact: true })).toBeVisible();
    await expect(toolbar.getByRole("group", { name: "Cover size" })).toBeVisible();
    await toolbar.getByRole("button", { name: "Smaller covers" }).click();
    await expect(page.locator(".cover-grid")).toHaveAttribute("data-cover-size", "3");
    expect(await firstRow(page)).toBeGreaterThan(6);

    await toolbar.getByLabel("Sort", { exact: true }).selectOption({ label: "Author" });
    await expect(firstTitle(page)).toHaveText(BY_AUTHOR_FIRST);
  });
});
