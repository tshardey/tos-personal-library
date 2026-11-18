import { expect, test, type Page } from "@playwright/test";
import { routeFakeCovers, seedShelf } from "./a11y";
import { installFakeCamera } from "./fake-camera";
import { routeCatalogs } from "./routes";
import { newMemberOf, newUserWithHousehold, newUserWithoutHousehold, rest, signIn, supabaseEnv, type TestUser } from "./supabase";
import { finishOpenJobsWith, type JobRow } from "./tag-jobs";

/**
 * Screenshots for a by-eye check against the mockups (Plan 9). Skipped unless E2E_SCREENSHOTS=1.
 * They land in E2E_SCREENSHOT_DIR (git-ignored under .superpowers/) and are never committed.
 *
 *   E2E_SUPABASE_PUBLISHABLE_KEY=<local key> docker compose run --rm -e E2E_SCREENSHOTS=1 \
 *     -e E2E_SCREENSHOT_DIR=.superpowers/screenshots/plan9/pr1 e2e npx playwright test e2e/visual.spec.ts
 */

const dir = process.env.E2E_SCREENSHOT_DIR ?? ".superpowers/screenshots/plan9/current";
const WIDTHS = [390, 1280];
// Optional filter: E2E_STATES=scan-camera,import-preview runs only those states (unset = all).
const ONLY = process.env.E2E_STATES?.split(",").map((n) => n.trim()).filter(Boolean);

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
  width: number;
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
  ...bookStates(),
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
      for (const [i, book] of books.slice(0, 4).entries()) {
        await patchBook(book.id, { series_name: "The Lantern Cycle", series_volume: 4 - i });
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
  {
    // Plan 10: one pending series suggestion with two books (seeded in beforeAll). The name is typed
    // in another case of a series the household has, so the item shows its "Joins your series" hint.
    name: "series-suggestions",
    async open(page) {
      await patchBook(books[33].id, { series_name: "Thornmere Cycle", series_volume: 1 });
      await page.goto("#/tags");
      // A reload, so the catalog is read again with the series in it.
      await page.reload();
      const item = page.getByRole("region", { name: "Series", exact: true }).getByRole("listitem", { name: "Saltglass Archive" });
      await item.getByLabel("Series name").fill("thornmere cycle");
      await expect(item.getByText('Joins your series "Thornmere Cycle".')).toBeVisible();
      await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
      // Clear of the desktop's sticky top bar.
      await page.getByRole("heading", { name: "Series", exact: true }).evaluate((el) => {
        el.scrollIntoView({ block: "start" });
        window.scrollBy(0, -80);
      });
    },
  },
  {
    // The camera view is up; it covers the tab bar.
    name: "scan-camera",
    async open(page) {
      await startScanner(page);
    },
    async after(page) {
      await page.getByRole("button", { name: "Done" }).click();
      await expect(page.getByRole("heading", { name: "Photo inbox" })).toBeVisible();
    },
  },
  {
    // Two typed ISBNs make two new books waiting in the inbox; the bulk-add sheet is open.
    name: "photos-confirm",
    async open(page, { width }) {
      await startScanner(page);
      // The owner is shared across widths and a typed ISBN already in the inbox isn't new, so each width gets its own pair.
      for (const isbn of width < 640 ? ["9780000000002", "9780000000019"] : ["9780000000026", "9780000000033"]) {
        await typeIsbn(page, isbn);
        await expect(page.getByRole("list", { name: "Scanned books" }).getByRole("listitem").filter({ hasText: isbn })).toBeVisible();
      }
      await page.getByRole("button", { name: "Done" }).click();
      await expect(page.getByRole("heading", { name: "Photo inbox" })).toBeVisible();
      await page.getByRole("button", { name: /^Add \d+ new books$/ }).click();
      await expect(page.getByRole("dialog")).toBeVisible();
    },
    after: closeOverlays,
  },
  {
    name: "import-preview",
    async open(page) {
      await page.goto("#/import");
      await page.getByLabel("libib CSV file").setInputFiles({
        name: "library.csv",
        mimeType: "text/csv",
        buffer: Buffer.from(libibCsv(), "utf-8"),
      });
      await expect(page.getByText(/new books?, \d+ extra cop/)).toBeVisible();
    },
  },
  {
    name: "type-isbn",
    async open(page) {
      await startScanner(page);
      await page.getByRole("button", { name: "Type ISBN" }).click();
      await expect(page.getByRole("dialog", { name: "Type ISBN" })).toBeVisible();
    },
    async after(page) {
      await closeOverlays(page);
      await page.getByRole("button", { name: "Done" }).click();
      await expect(page.getByRole("heading", { name: "Photo inbox" })).toBeVisible();
    },
  },
];

const LIBIB_HEADER = [
  "id", "item_type", "title", "creators", "first_name", "last_name", "collection",
  "ean_isbn13", "upc_isbn10", "description", "publisher", "publish_date", "group",
  "tags", "notes", "price", "length", "number_of_discs", "number_of_players",
  "age_group", "ensemble", "aspect_ratio", "esrb", "rating", "review", "review_date",
  "status", "began", "completed", "added", "copies",
];

/** A small synthetic libib export: invented titles, synthetic ISBNs, the first member's collection. */
function libibCsv(): string {
  const rows = [
    ["AAAAAAAA01", "The Fallow Lantern", "Wren Halloway", "Member A's Books", "9780000000057"],
    ["AAAAAAAA02", "The Ivory Orchard", "Corin Vale", "Member A's Books", "9780000000064"],
    ["AAAAAAAA03", "The Juniper Ledger", "Ada Pemberly", "Member B's Books", "9780000000071"],
  ];
  const lines = [LIBIB_HEADER.join(",")];
  for (const [id, title, creators, collection, isbn] of rows) {
    const values: Record<string, string> = { id, item_type: "book", title, creators, collection, ean_isbn13: isbn, copies: "1" };
    lines.push(LIBIB_HEADER.map((c) => values[c] ?? "").join(","));
  }
  return lines.join("\n") + "\n";
}

async function startScanner(page: Page) {
  await page.goto("#/scan");
  await page.getByRole("button", { name: "Start scanning" }).click();
  await expect(page.getByRole("button", { name: "Done" })).toBeVisible();
}

async function typeIsbn(page: Page, isbn: string) {
  await page.getByRole("button", { name: "Type ISBN" }).click();
  const sheet = page.getByRole("dialog", { name: "Type ISBN" });
  await sheet.getByLabel("ISBN").fill(isbn);
  await sheet.getByRole("button", { name: "Add" }).click();
}

/** Plan 9 PR 3: the book page's four tabs, the edit form, the open More actions menu and the Find cover sheet. */
function bookStates(): (typeof STATES)[number][] {
  const bookPage = async (page: Page, bookId: string, tab: string) => {
    await page.goto(`#/book/${bookId}`);
    await expect(page.getByRole("link", { name: "Back to library" })).toBeVisible();
    await page.getByRole("tab", { name: tab }).click();
  };
  const tabState = (name: string, tab: string) => ({
    name,
    async open(page: Page, { bookId }: Ctx) {
      await bookPage(page, bookId, tab);
    },
  });
  return [
    tabState("book-overview", "Overview"),
    tabState("book-copies", "Copies (1)"),
    tabState("book-tags", "Tags"),
    tabState("book-tos", "Tome of Secrets"),
    {
      name: "book-editing",
      async open(page, { bookId }) {
        await bookPage(page, bookId, "Overview");
        await page.getByRole("button", { name: "Edit book" }).click();
        await expect(page.getByRole("button", { name: "Save book" })).toBeVisible();
      },
      async after(page) {
        await page.getByRole("button", { name: "Cancel" }).click();
      },
    },
    {
      name: "book-read",
      async open(page, { bookId }) {
        await bookPage(page, bookId, "Overview");
        await page.getByRole("button", { name: "Mark read", exact: true }).click();
        await expect(page.getByRole("button", { name: "Your reading: Read" })).toBeVisible();
      },
      // Back to unread, so the next width and the later states start from the same book.
      async after(page) {
        await page.getByRole("group", { name: "Your reading" }).getByRole("button", { name: "Unread" }).click();
        await expect(page.getByRole("button", { name: "Mark read", exact: true })).toBeVisible();
      },
    },
    {
      name: "book-menu",
      async open(page, { bookId }) {
        await bookPage(page, bookId, "Overview");
        await page.getByRole("button", { name: "More actions" }).click();
        await expect(page.getByRole("button", { name: "Delete book" })).toBeVisible();
      },
      after: closeOverlays,
    },
    {
      name: "book-find-cover",
      async open(page, { bookId }) {
        await bookPage(page, bookId, "Overview");
        await page.getByRole("button", { name: "Find cover" }).click();
        await expect(page.getByRole("dialog", { name: "Find cover" })).toBeVisible();
      },
      after: closeOverlays,
    },
    {
      // A finished search, answered by a synthetic cover_searches row: no real search and no API spend.
      name: "book-find-cover-results",
      async open(page, { bookId }) {
        await page.route(COVER_SEARCHES, (route) => {
          const first = (new URL(route.request().url()).searchParams.get("offset") ?? "0") === "0";
          return route.fulfill({ status: 200, contentType: "application/json", json: first ? [readySearch(bookId)] : [] });
        });
        await bookPage(page, bookId, "Overview");
        await page.reload();
        await expect(page.getByText("New covers are ready.")).toBeVisible();
      },
      async after(page) {
        await page.unroute(COVER_SEARCHES);
        await page.reload();
        await expect(page.getByRole("button", { name: "Find cover" })).toBeVisible();
      },
    },
  ];
}

const COVER_SEARCHES = /\/rest\/v1\/cover_searches\?/;

/** An invented ready search with one candidate cover; ids are synthetic. */
function readySearch(bookId: string) {
  return {
    id: "00000000-0000-4000-8000-0000000000c1",
    household_id: "00000000-0000-4000-8000-0000000000a1",
    book_id: bookId,
    requested_by: null,
    batch_id: "00000000-0000-4000-8000-0000000000b1",
    reasons: ["placeholder"],
    note: null,
    cover_at_request: null,
    status: "ready",
    attempts: 1,
    claimed_at: null,
    retry_at: null,
    candidates: [],
    results: [],
    error_code: null,
    seen_at: null,
    created_at: "2026-11-15T09:00:00Z",
    book: { title: "The Salt Road", authors: ["Petra Wynnecombe"], isbn13: [], isbn10: [], cover_url: null },
  };
}

let owner: TestUser;
let books: { id: string; title: string }[];

test.beforeAll(async () => {
  owner = await newUserWithHousehold("Member A");
  await newMemberOf(owner, "Member B");
  books = await seedShelf(owner, 36);
  // The series-suggestions state: the shelf's last two books suggest one new series, one volume left blank.
  const pair = [books[34].id, books[35].id];
  const jobs = await rest<JobRow[]>(owner, `tag_jobs?select=id,book_id,reason,status&book_id=in.(${pair.join(",")})`);
  await finishOpenJobsWith(owner, jobs, (bookId) => ({
    series: {
      name: "Saltglass Archive",
      volume: bookId === pair[0] ? 1 : null,
      why: bookId === pair[0] ? "The cover names the Saltglass Archive." : "Same archive, same keeper.",
    },
  }));
});

/** Sets columns on one of the owner's books (local stack, RLS applies). */
async function patchBook(id: string, body: Record<string, unknown>) {
  const { url, key } = supabaseEnv();
  const res = await fetch(`${url}/rest/v1/books?id=eq.${id}`, {
    method: "PATCH",
    headers: {
      apikey: key,
      Authorization: `Bearer ${owner.accessToken}`,
      "Content-Type": "application/json",
      "Content-Profile": "library",
    },
    body: JSON.stringify(body),
  });
  expect(res.ok, `book PATCH answered ${res.status}`).toBe(true);
}

for (const width of WIDTHS) {
  test(`screenshots at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: width < 640 ? 844 : 800 });
    await routeFakeCovers(page);
    await installFakeCamera(page);
    await signIn(page, owner);
    await routeCatalogs(page);
    for (const state of STATES) {
      if (ONLY && !ONLY.includes(state.name)) continue;
      await state.open(page, { bookId: books[0].id, width });
      await settle(page);
      await page.screenshot({ path: `${dir}/${state.name}-${width}.png`, fullPage: false });
      await state.after?.(page);
      // Escape returns focus to the opener; drop it so its ring doesn't show in the next state.
      await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    }
  });

  test(`household-setup screenshot at ${width}px`, async ({ browser, baseURL }) => {
    test.skip(ONLY !== undefined && !ONLY.includes("household-setup"));
    const user = await newUserWithoutHousehold();
    const context = await browser.newContext({ baseURL, viewport: { width, height: width < 640 ? 844 : 800 } });
    const page = await context.newPage();
    await signIn(page, user);
    await page.goto("#/");
    await expect(page.getByRole("heading", { name: "Create a household" })).toBeVisible();
    await settle(page);
    await page.screenshot({ path: `${dir}/household-setup-${width}.png`, fullPage: false });
    await context.close();
  });

  test(`sign-in screenshot at ${width}px`, async ({ browser, baseURL }) => {
    test.skip(ONLY !== undefined && !ONLY.includes("sign-in"));
    const context = await browser.newContext({ baseURL, viewport: { width, height: width < 640 ? 844 : 800 } });
    const page = await context.newPage();
    await page.goto("#/");
    await expect(page.getByRole("button", { name: /sign in|send/i }).first()).toBeVisible();
    await settle(page);
    await page.screenshot({ path: `${dir}/sign-in-${width}.png`, fullPage: false });
    await context.close();
  });
}
