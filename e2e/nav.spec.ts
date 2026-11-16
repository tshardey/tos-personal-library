import { expect, test, type Locator, type Page } from "@playwright/test";
import { expectFocusRing, expectTapTargets, routeFakeCovers, seedShelf } from "./a11y";
import { newUserWithHousehold, signIn } from "./supabase";

/** Plan 9 PR 1 (D7, D11): the phone's bottom tab bar, the Add and More sheets, and the computer's top nav. */

const count = (page: Page) => page.locator("p[aria-live='polite']");
const bar = (page: Page) => page.getByRole("navigation", { name: "Main" });

async function signedIn(page: Page) {
  const user = await newUserWithHousehold("Member A");
  await seedShelf(user, 3);
  await routeFakeCovers(page);
  await signIn(page, user);
  await page.goto("#/");
  await expect(count(page)).toHaveText("3 books");
  return user;
}

/** Presses Tab until `target` has focus (at most `limit` presses). */
async function tabTo(page: Page, target: Locator, limit = 80) {
  for (let i = 0; i < limit; i++) {
    if (await target.evaluate((el) => el === document.activeElement)) return;
    await page.keyboard.press("Tab");
  }
  await expect(target).toBeFocused();
}

test.describe("phone (390px)", () => {
  test("every bar item reaches its route, and Add and More open their sheets", async ({ page }) => {
    await signedIn(page);
    const nav = bar(page);
    await expect(nav.getByRole("link")).toHaveText(["Library", "Scan", "Covers"]);

    await nav.getByRole("link", { name: "Scan" }).click();
    await expect(page).toHaveURL(/#\/scan$/);
    await expect(page.getByRole("button", { name: "Start scanning" })).toBeVisible();
    await expect(nav.getByRole("link", { name: "Scan" })).toHaveAttribute("aria-current", "page");

    // No searches wait: the tab is just "Covers", and the page says it's empty or not available.
    await expect(nav.getByRole("link", { name: "Covers", exact: true })).toBeVisible();
    await nav.getByRole("link", { name: "Covers", exact: true }).click();
    await expect(page).toHaveURL(/#\/covers$/);
    await expect(page.getByText(/^(No covers to review\.|The cover finder isn't available yet\.)$/)).toBeVisible();

    await nav.getByRole("link", { name: "Library" }).click();
    await expect(page).toHaveURL(/#\/$/);
    await expect(count(page)).toHaveText("3 books");
    await expect(nav.getByRole("link", { name: "Library" })).toHaveAttribute("aria-current", "page");

    await nav.getByRole("button", { name: "Add" }).click();
    const add = page.getByRole("dialog", { name: "Add books" });
    await expect(add.getByRole("link")).toHaveText([/^Type it in/, /^Photos/, /^Import/]);
    await add.getByRole("link", { name: "Type it in" }).click();
    await expect(add).toBeHidden();
    await expect(page).toHaveURL(/#\/add$/);
    await expect(nav.getByRole("button", { name: "Add" })).toHaveAttribute("aria-current", "page");

    await nav.getByRole("button", { name: "More" }).click();
    const more = page.getByRole("dialog", { name: "More" });
    await expect(more.getByRole("button", { name: "Sign out" })).toBeVisible();
    await more.getByRole("link", { name: "Edition labels" }).click();
    await expect(more).toBeHidden();
    await expect(page.getByRole("heading", { name: "Edition labels" })).toBeVisible();
    await expect(nav.getByRole("button", { name: "More" })).toHaveAttribute("aria-current", "page");
  });

  test("tap targets: the bar and both sheets are 44px or more", async ({ page }) => {
    await signedIn(page);
    await expectTapTargets(page, bar(page));

    await bar(page).getByRole("button", { name: "Add" }).click();
    await expectTapTargets(page, page.getByRole("dialog", { name: "Add books" }));
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);

    await bar(page).getByRole("button", { name: "More" }).click();
    await expectTapTargets(page, page.getByRole("dialog", { name: "More" }));
  });

  test("keyboard: More opens on Enter, Tab reaches Sign out, Escape closes and returns focus", async ({ page }) => {
    await signedIn(page);
    const moreButton = bar(page).getByRole("button", { name: "More" });
    await tabTo(page, moreButton);
    await expectFocusRing(page, moreButton);
    await page.keyboard.press("Enter");
    const more = page.getByRole("dialog", { name: "More" });
    await expect(more).toBeVisible();
    // Focus moved into the sheet.
    await expect.poll(() => more.evaluate((el) => el.contains(document.activeElement))).toBe(true);
    await tabTo(page, more.getByRole("button", { name: "Sign out" }), 15);
    // The trap: one more Tab wraps inside the sheet.
    await page.keyboard.press("Tab");
    await expect.poll(() => more.evaluate((el) => el.contains(document.activeElement))).toBe(true);
    await page.keyboard.press("Escape");
    await expect(more).toBeHidden();
    await expectFocusRing(page, moreButton);

    // The Add sheet: Enter opens, Escape closes, focus back on Add.
    const addButton = bar(page).getByRole("button", { name: "Add" });
    await tabTo(page, addButton);
    await page.keyboard.press("Enter");
    const add = page.getByRole("dialog", { name: "Add books" });
    await expect(add.getByRole("link", { name: "Type it in" })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(add).toBeHidden();
    await expectFocusRing(page, addButton);
  });

  test("reduced motion: the open More sheet has no transition", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await signedIn(page);
    await bar(page).getByRole("button", { name: "More" }).click();
    const more = page.getByRole("dialog", { name: "More" });
    await expect(more).toBeVisible();
    const duration = await more.evaluate((el) => getComputedStyle(el).transitionDuration);
    expect(duration).toMatch(/^(0s|1e-05s)(, (0s|1e-05s))*$/);
  });
});

test.describe("computer (1280px)", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test("the top nav shows, the bottom bar doesn't, and More is a menu Escape closes", async ({ page }) => {
    await signedIn(page);
    await expect(page.getByRole("navigation", { name: "Main" })).toHaveCount(1);
    await expect(page.getByTestId("bottom-tab-bar")).toHaveCount(0);
    const nav = bar(page);
    await expect(page.locator("header").getByRole("navigation", { name: "Main" })).toBeVisible();
    await expect(nav.getByRole("link", { name: "Library" })).toHaveAttribute("aria-current", "page");

    const more = nav.getByRole("button", { name: "More" });
    await more.click();
    await expect(more).toHaveAttribute("aria-expanded", "true");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(nav.getByRole("button", { name: "Sign out" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(more).toHaveAttribute("aria-expanded", "false");
    await expect(nav.getByRole("button", { name: "Sign out" })).toHaveCount(0);
    await expect(more).toBeFocused();

    const add = nav.getByRole("button", { name: "Add" });
    await add.click();
    await nav.getByRole("link", { name: "Type it in" }).click();
    await expect(page).toHaveURL(/#\/add$/);
    await expect(add).toHaveAttribute("aria-expanded", "false");
  });
});
