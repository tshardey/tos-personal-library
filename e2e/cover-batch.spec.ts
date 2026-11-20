import { expect, test, type Page } from "@playwright/test";
import { expectTapTargets } from "./a11y";
import { newUserWithHousehold, rest, signIn, type TestUser } from "./supabase";
import { insert } from "./tag-jobs";

/**
 * Bulk cover marking and the Covers tab's batch lines: select books, Add to batch from Edit selected,
 * then Find covers on the Marked line. OpenLibrary and Google answer empty from page routes, so the
 * search ends as nothing found without leaving the machine, and the screener is never reached.
 * Invented titles only.
 */

interface SearchRow {
  book_id: string;
  reasons: string[];
  note: string | null;
  status: string;
}

const TITLES = ["Quillmere Atlas", "Quillmere Ledger", "Quillmere Psalter"];

async function routeEmptySources(page: Page): Promise<void> {
  await page.route(/^https:\/\/openlibrary\.org\//, (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ numFound: 0, docs: [] }) }),
  );
  await page.route(/^https:\/\/www\.googleapis\.com\//, (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ totalItems: 0 }) }),
  );
}

async function seed(user: TestUser) {
  const books = await insert<{ id: string; title: string }>(
    user,
    "books",
    [...TITLES, "Saltmarsh Gazetteer"].map((title) => ({ household_id: user.householdId, title, authors: ["Orla Penhallow"] })),
  );
  return books;
}

/** Search "quillmere", Select all, then open Edit selected. Starts from another page, so select mode starts fresh. */
async function openSheet(page: Page) {
  await page.goto("#/covers");
  await page.goto("#/");
  const count = page.locator("p[aria-live='polite']");
  await page.getByRole("searchbox", { name: "Search books" }).fill("quillmere");
  await expect(count).toHaveText("3 books");
  await page.getByRole("button", { name: "Select", exact: true }).click();
  await page.getByRole("button", { name: "Select all" }).click();
  const bar = page.getByRole("region", { name: "Selection" });
  await expect(bar.getByText("3 selected")).toBeVisible();
  await bar.getByRole("button", { name: "Edit" }).click();
  return page.getByRole("dialog", { name: "Edit selected books" });
}

async function skipWithoutFinder(page: Page) {
  // The Covers tab says so when the cover-finder migration isn't on this stack.
  // "Not available" also shows while the finder loads, so wait for its lines first.
  await page.goto("#/covers");
  await page
    .getByRole("group", { name: "Books without a cover" })
    .waitFor({ timeout: 15_000 })
    .catch(() => undefined);
  test.skip(
    (await page.getByText("The cover finder isn't available yet.").count()) > 0,
    "the cover finder isn't available on this stack",
  );
}

test("Edit selected marks books for covers, and the Covers tab's Marked line searches them", async ({ page }) => {
  const user = await newUserWithHousehold("Member A");
  const books = await seed(user);
  const ids = books.filter((b) => TITLES.includes(b.title)).map((b) => b.id).sort();
  await signIn(page, user);
  await routeEmptySources(page);
  await skipWithoutFinder(page);

  const sheet = await openSheet(page);
  const covers = sheet.getByRole("region", { name: "Covers" });
  await expect(covers.getByRole("button", { name: "Placeholder" })).toHaveAttribute("aria-pressed", "false");
  await covers.getByRole("button", { name: "Placeholder" }).click();
  await covers.getByLabel("What's wrong? (optional)").fill("an invented note");
  await covers.getByRole("button", { name: "Add to batch" }).click();
  await expect(covers.getByRole("status")).toHaveText("Marked 3 books. Find covers from the Covers tab.");
  await expect(covers.getByRole("link", { name: "Covers tab" })).toHaveAttribute("href", "#/covers");

  const marks = await rest<{ book_id: string; reasons: string[]; note: string | null }[]>(
    user,
    "cover_marks?select=book_id,reasons,note&order=book_id",
  );
  expect(marks.map((m) => m.book_id)).toEqual(ids);
  for (const m of marks) {
    expect(m.reasons).toEqual(["placeholder"]);
    expect(m.note).toBe("an invented note");
  }

  await covers.getByRole("link", { name: "Covers tab" }).click();
  await expect(page).toHaveURL(/#\/covers$/);
  const marked = page.getByRole("group", { name: "Marked for a new cover" });
  await expect(marked.getByRole("heading", { name: "Marked for a new cover: 3" })).toBeVisible();
  await expect(marked.getByText("3 books · under $0.01")).toBeVisible();
  const noCover = page.getByRole("group", { name: "Books without a cover" });
  await expect(noCover.getByRole("heading", { name: "Books without a cover: 4" })).toBeVisible();

  await marked.getByRole("button", { name: "Find covers" }).click();
  await expect(marked.getByText("Searching 3 books. It carries on whenever either of you has the app open.")).toBeVisible();

  // Each search carries the mark's reasons and note; with empty sources it ends as nothing found.
  await expect
    .poll(async () => (await rest<SearchRow[]>(user, "cover_searches?select=status")).map((s) => s.status).sort(), {
      timeout: 30_000,
    })
    .toEqual(["nothing_found", "nothing_found", "nothing_found"]);
  const searches = await rest<SearchRow[]>(user, "cover_searches?select=book_id,reasons,note,status&order=book_id");
  expect(searches.map((s) => s.book_id)).toEqual(ids);
  for (const s of searches) {
    expect(s.reasons).toEqual(["placeholder"]);
    expect(s.note).toBe("an invented note");
  }
});

test("Find covers now confirms first, and can retry nothing-found books", async ({ page }) => {
  const user = await newUserWithHousehold("Member A");
  await seed(user);
  await signIn(page, user);
  await routeEmptySources(page);
  await skipWithoutFinder(page);

  // A first search: the three end as nothing found.
  let sheet = await openSheet(page);
  let covers = sheet.getByRole("region", { name: "Covers" });
  await covers.getByRole("button", { name: "Find covers now" }).click();
  let confirm = covers.getByRole("group", { name: "Confirm find covers" });
  await expect(confirm.getByText("Find covers for 3 books · under $0.01")).toBeVisible();
  await confirm.getByRole("button", { name: "Confirm" }).click();
  await expect(covers.getByRole("status")).toHaveText(
    "Searching 3 books. It carries on whenever either of you has the app open. You can close this. Covers show up in the Covers tab when they're ready.",
  );
  await expect(covers.getByRole("link", { name: "Covers tab" })).toHaveAttribute("href", "#/covers");
  await expect
    .poll(async () => (await rest<SearchRow[]>(user, "cover_searches?select=status")).map((s) => s.status), { timeout: 30_000 })
    .toEqual(["nothing_found", "nothing_found", "nothing_found"]);

  // Again: they're left out, unless the retry box is ticked.
  await sheet.getByRole("button", { name: "Cancel" }).click();
  sheet = await openSheet(page);
  covers = sheet.getByRole("region", { name: "Covers" });
  await expect(covers.getByText("3 tried before with nothing found are left out of Add to batch.")).toBeVisible();
  await expect(covers.getByRole("button", { name: "Add to batch" })).toBeDisabled();
  await covers.getByRole("button", { name: "Find covers now" }).click();
  confirm = covers.getByRole("group", { name: "Confirm find covers" });
  await expect(confirm.getByRole("button", { name: "Confirm" })).toBeDisabled();
  await confirm.getByRole("checkbox", { name: "Also try again for 3 tried before with nothing found" }).check();
  await expect(confirm.getByText("Find covers for 3 books · under $0.01")).toBeVisible();
  await confirm.getByRole("button", { name: "Confirm" }).click();
  await expect(covers.getByText(/^Searching 3 books\./)).toBeVisible();
  // The retries retired the ended searches and started new ones: three dismissed, three new that end as nothing found.
  await expect
    .poll(async () => (await rest<SearchRow[]>(user, "cover_searches?select=status")).map((s) => s.status).sort(), {
      timeout: 30_000,
    })
    .toEqual(["dismissed", "dismissed", "dismissed", "nothing_found", "nothing_found", "nothing_found"]);
});

test("tap targets: the Covers tab's lines and the sheet's Covers section are 44px or more", async ({ page }) => {
  const user = await newUserWithHousehold("Member A");
  await seed(user);
  await signIn(page, user);
  await routeEmptySources(page);
  await skipWithoutFinder(page);
  await expectTapTargets(page, page.getByRole("region", { name: "Find covers" }));
  const sheet = await openSheet(page);
  const covers = sheet.getByRole("region", { name: "Covers" });
  await expectTapTargets(page, covers);
  await covers.getByRole("button", { name: "Add to batch" }).click();
  await expect(covers.getByRole("link", { name: "Covers tab" })).toBeVisible();
  await expectTapTargets(page, covers);
  await covers.getByRole("button", { name: "Find covers now" }).click();
  await expectTapTargets(page, covers);
});

test.describe("screenshots", () => {
  test.skip(process.env.E2E_SCREENSHOTS !== "1", "screenshots only on request (E2E_SCREENSHOTS=1)");
  const dir = process.env.E2E_SCREENSHOT_DIR ?? ".superpowers/screenshots/cover-batch";

  for (const width of [390, 1280]) {
    test(`the Covers tab and the sheet's Covers section at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
      const user = await newUserWithHousehold("Member A");
      await seed(user);
      await signIn(page, user);
      await routeEmptySources(page);
      await skipWithoutFinder(page);
      await page.screenshot({ path: `${dir}/covers-tab-${width}.png`, fullPage: true });

      const sheet = await openSheet(page);
      const covers = sheet.getByRole("region", { name: "Covers" });
      await covers.scrollIntoViewIfNeeded();
      await page.screenshot({ path: `${dir}/sheet-covers-${width}.png` });
      await covers.getByRole("button", { name: "Placeholder" }).click();
      await covers.getByRole("button", { name: "Add to batch" }).click();
      await expect(covers.getByRole("link", { name: "Covers tab" })).toBeVisible();
      await covers.getByRole("button", { name: "Find covers now" }).click();
      await covers.getByRole("group", { name: "Confirm find covers" }).scrollIntoViewIfNeeded();
      await page.screenshot({ path: `${dir}/sheet-covers-confirm-${width}.png` });

      await page.goto("#/covers");
      await expect(page.getByRole("heading", { name: "Marked for a new cover: 3" })).toBeVisible();
      await page.screenshot({ path: `${dir}/covers-tab-marked-${width}.png`, fullPage: true });
    });
  }
});
