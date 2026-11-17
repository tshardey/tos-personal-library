import { expect, test, type Page } from "@playwright/test";
import { expectTapTargets } from "./a11y";
import { newUserWithHousehold, signIn } from "./supabase";

/** Tap targets (D11) on the main content of the PR 4 screens, at phone width. */

test.use({ viewport: { width: 390, height: 844 } });

const PAGES = ["#/scan", "#/inbox", "#/import", "#/covers", "#/reading", "#/tags", "#/editions"];

const main = (page: Page) => page.locator("main");

test("the restyled screens keep 44px tap targets", async ({ page }) => {
  const user = await newUserWithHousehold("Tester");
  await signIn(page, user);
  for (const hash of PAGES) {
    await test.step(hash, async () => {
      await page.goto(hash);
      await expect(main(page).locator("h1, h2").first()).toBeVisible();
      // A page that shows only its "unavailable" text on this stack has no control to measure.
      const controls = main(page).locator('button, a[href], [role="tab"], select, input[type="checkbox"]');
      if ((await controls.count()) === 0) return;
      await expectTapTargets(page, main(page));
    });
  }
});

test("the sign-in page keeps 44px tap targets", async ({ browser, baseURL }) => {
  const context = await browser.newContext({ baseURL, viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  await page.goto("#/");
  await expect(page.getByRole("button", { name: /sign in|send/i }).first()).toBeVisible();
  await expectTapTargets(page, main(page).or(page.locator("form").first()).first());
  await context.close();
});
