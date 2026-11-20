import { expect, test, type Locator, type Page } from "@playwright/test";
import { CONTROLS, expectTapTargets } from "./a11y";
import { newUserWithHousehold, rest, signIn } from "./supabase";
import { finishOpenJobsWith, insert, type JobRow } from "./tag-jobs";

/** Tap targets (D11) on the main content of the PR 4 screens, at phone width. */

test.use({ viewport: { width: 390, height: 844 } });

const main = (page: Page) => page.locator("main");

interface Screen {
  hash: string;
  heading: string;
  /** A control this page renders for a fresh user: waiting for it means the page has loaded. */
  ready?: (page: Page) => Locator;
}

const SCREENS: Screen[] = [
  { hash: "#/scan", heading: "Scan barcodes", ready: (p) => p.getByRole("button", { name: "Start scanning" }) },
  { hash: "#/inbox", heading: "Photo inbox", ready: (p) => p.getByRole("button", { name: "Choose photos" }) },
  { hash: "#/import", heading: "Import from libib", ready: (p) => p.getByLabel("libib CSV file") },
  { hash: "#/covers", heading: "Covers to review", ready: (p) => main(p).getByRole("link", { name: "Back to library" }) },
  { hash: "#/reading", heading: "Reading history" },
  { hash: "#/tags", heading: "Tag suggestions", ready: (p) => main(p).getByRole("button").first() },
  { hash: "#/editions", heading: "Edition labels", ready: (p) => main(p).getByRole("link", { name: "Back to library" }) },
];

// Known gap: reading history on a fresh user renders only a file chooser (no button, link, tab, select or
// checkbox) and no possible matches, so there is nothing for expectTapTargets to measure. Only these pages may have no control to measure; any other page
// that renders none fails in expectTapTargets.
const NO_CONTROLS_OK = new Set(["#/reading"]);

test("the restyled screens keep 44px tap targets", async ({ page }) => {
  const user = await newUserWithHousehold("Tester");
  await signIn(page, user);
  for (const { hash, heading, ready } of SCREENS) {
    await test.step(hash, async () => {
      await page.goto(hash);
      await expect(page.getByRole("heading", { name: heading })).toBeVisible();
      if (NO_CONTROLS_OK.has(hash)) {
        await expect(
          main(page)
            .getByRole("region", { name: "Upload StoryGraph export" })
            .or(main(page).getByText("Reading history isn't available yet."))
            .or(main(page).locator(CONTROLS).first()),
        ).toBeVisible();
        if ((await main(page).locator(CONTROLS).count()) === 0) {
          console.log(`tap targets: ${hash} NOT measured (no controls)`);
          return;
        }
      } else {
        await expect(ready!(page)).toBeVisible();
      }
      await expectTapTargets(page, main(page));
      console.log(`tap targets: ${hash} measured`);
    });
  }
});

test("the Tag suggestions page keeps 44px tap targets with a series suggestion waiting", async ({ page }) => {
  const user = await newUserWithHousehold("Tester");
  const books = await insert<{ id: string }>(
    user,
    "books",
    ["Saltglass One", "Saltglass Two"].map((title) => ({ household_id: user.householdId, title, authors: ["Ines Dravenholt"] })),
  );
  const jobs = await rest<JobRow[]>(user, `tag_jobs?select=id,book_id,reason,status&book_id=in.(${books.map((b) => b.id).join(",")})`);
  await finishOpenJobsWith(user, jobs, (bookId) => ({
    series: { name: "Saltglass Archive", volume: bookId === books[0].id ? 1 : null, why: "Named on the cover." },
  }));
  await signIn(page, user);
  await page.goto("#/tags");
  await expect(
    page.getByRole("region", { name: "Series", exact: true }).getByRole("listitem", { name: "Saltglass Archive" }),
  ).toBeVisible();
  await expectTapTargets(page, main(page));
});

test("the Tag suggestions page keeps 44px tap targets with an existing-series suggestion waiting", async ({ page }) => {
  const user = await newUserWithHousehold("Tester");
  const books = await insert<{ id: string; title: string }>(user, "books", [
    { household_id: user.householdId, title: "Lantern Dawn", authors: ["M. Holt"], series_name: "Lantern Vale Cycle", series_volume: 1 },
    { household_id: user.householdId, title: "Reed One", authors: ["A. Reed"], series_name: null, series_volume: null },
  ]);
  const reed = books.find((b) => b.title === "Reed One")!;
  const jobs = await rest<JobRow[]>(user, `tag_jobs?select=id,book_id,reason,status&book_id=in.(${books.map((b) => b.id).join(",")})`);
  await finishOpenJobsWith(user, jobs, (bookId) =>
    bookId === reed.id ? { series: { name: "Lantern Vale Cycle", volume: 2, why: "w" }, seriesStatus: "found" } : {},
  );
  await signIn(page, user);
  await page.goto("#/tags");
  await expect(
    page.getByRole("region", { name: "Series", exact: true }).getByRole("listitem", { name: "Add to your series Lantern Vale Cycle" }),
  ).toBeVisible();
  await expectTapTargets(page, main(page));
});

test("the sign-in page keeps 44px tap targets", async ({ browser, baseURL }) => {
  const context = await browser.newContext({ baseURL, viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  await page.goto("#/");
  await expect(page.getByRole("button", { name: /sign in|send/i }).first()).toBeVisible();
  await expectTapTargets(page, main(page).or(page.locator("form").first()).first());
  await context.close();
});
