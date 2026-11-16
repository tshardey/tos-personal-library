import { expect, test, type Page, type Route } from "@playwright/test";
import { sgCsv } from "../src/lib/reading/fixtures";
import { newMemberOf, newUserWithHousehold, rest, signIn, type TestUser } from "./supabase";
import { insert } from "./tag-jobs";

/**
 * Plan 8 end to end: a StoryGraph upload with matched, possible, kept-for-later and skipped rows,
 * Link, a sticky Unread, the Read status filter feeding Ask, a new book linking itself from history,
 * and mass edit marking books read for one member while another member sees it. Invented titles,
 * authors and synthetic ISBNs only; the CSV is built in memory and never written to the repo.
 */

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "*",
  "access-control-allow-methods": "GET, POST, PATCH, DELETE, OPTIONS",
};

const json = (route: Route, body: unknown, status = 200) =>
  route.fulfill({ status, contentType: "application/json", headers: CORS, body: JSON.stringify(body) });

/** No Edge Function call leaves the test: Ask is answered here, every other function fails. */
async function routeFunctions(page: Page): Promise<{ askBodies: { bookIds: string[]; prompt: string }[] }> {
  const askBodies: { bookIds: string[]; prompt: string }[] = [];
  await page.route("**/functions/v1/**", async (route) => {
    const req = route.request();
    if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: CORS });
    if (new URL(req.url()).pathname.endsWith("/library-ask")) {
      askBodies.push(req.postDataJSON() as { bookIds: string[]; prompt: string });
      return json(route, { outcome: "ok", answerable: true, note: null, matches: [] });
    }
    return json(route, { error: "not in e2e" }, 503);
  });
  return { askBodies };
}

interface BookRow {
  id: string;
  title: string;
}

async function addBooks(user: TestUser, books: { title: string; authors: string[]; isbn13: string[] }[]) {
  const rows = await insert<BookRow>(
    user,
    "books",
    books.map((b) => ({ household_id: user.householdId, ...b })),
  );
  await insert(
    user,
    "copies",
    rows.map((b) => ({ book_id: b.id, origin: "manual" })),
  );
  return rows;
}

const FILE = sgCsv([
  // Matched by ISBN.
  { Title: "The Salt Road", Authors: "Petra Wynnecombe", "ISBN/UID": "9780000000002", "Read Status": "read", "Last Date Read": "2026/03/02" },
  // Matched by title and first author; the series suffix is dropped.
  { Title: "Glass Orchard (Orchard Cycle, #1)", Authors: "Callum Ashgrove", "ISBN/UID": "", "Read Status": "read", "Last Date Read": "2026/04/10" },
  // Same title, a different author: a possible match.
  { Title: "Moth Lanterns", Authors: "Tobias Quillfeather", "ISBN/UID": "", "Read Status": "read", "Last Date Read": "", "Dates Read": "2026/05/01-2026/05/09" },
  // Not on the shelf yet: kept for later.
  { Title: "The Winter Ferry", Authors: "Mira Okonkwo-Hale", "ISBN/UID": "", "Read Status": "read", "Last Date Read": "2026/06/20" },
  { Title: "Copper Lighthouse", Authors: "Ines Dravenholt", "ISBN/UID": "9780000000019", "Read Status": "did-not-finish" },
  // Skipped.
  { Title: "Ember Atlas", Authors: "Petra Wynnecombe", "ISBN/UID": "", "Read Status": "to-read" },
]);

async function uploadFile(page: Page) {
  await page.getByLabel("StoryGraph CSV file").setInputFiles({
    name: "storygraph-export.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(FILE, "utf8"),
  });
  const upload = page.getByRole("region", { name: "Upload StoryGraph export" });
  await expect(upload.getByText("5 books read or not finished. 1 to-read or currently reading will be skipped.")).toBeVisible();
  await upload.getByRole("button", { name: "Upload" }).click();
  return upload;
}

async function wallIds(page: Page): Promise<string[]> {
  return (await page.locator("a[data-book-id]").evaluateAll((els) => els.map((e) => e.getAttribute("data-book-id")!))).sort();
}

test("StoryGraph upload, Link, sticky Unread, filter and Ask, auto-link and mass edit across members", async ({
  page,
  browser,
  baseURL,
}) => {
  const a = await newUserWithHousehold("Member A");
  const b = await newMemberOf(a, "Member B");
  expect(b.householdId).toBe(a.householdId);

  const books = await addBooks(a, [
    { title: "The Salt Road", authors: ["Petra Wynnecombe"], isbn13: ["9780000000002"] },
    { title: "Glass Orchard", authors: ["Callum Ashgrove"], isbn13: [] },
    { title: "Moth Lanterns", authors: ["Ines Dravenholt"], isbn13: [] },
    { title: "Hollow Garden", authors: ["Juniper Abernathy"], isbn13: [] },
    { title: "Hollow Atlas", authors: ["Brindle Fenwick"], isbn13: [] },
    { title: "Hollow Delta", authors: ["Cinder Galloway"], isbn13: [] },
    { title: "Amber Journal", authors: ["Dusk Hartigan"], isbn13: [] },
    { title: "Ivory Bastion", authors: ["Fallow Jarrow"], isbn13: [] },
  ]);
  const id = (title: string) => books.find((x) => x.title === title)!.id;

  const { askBodies } = await routeFunctions(page);
  await signIn(page, a);

  // The account menu links to Reading history.
  await page.goto("#/");
  await expect(page.locator("p[aria-live='polite']")).toHaveText("8 books");
  await page.getByRole("button", { name: "Account" }).click();
  await page.getByRole("link", { name: "Reading history" }).click();
  await expect(page.getByRole("heading", { name: "Reading history" })).toBeVisible();

  // Upload: 2 matched, 1 possible, 2 kept for later, 1 skipped.
  const upload = await uploadFile(page);
  await expect(upload.getByText("2 matched books you own (2 newly marked)")).toBeVisible();
  await expect(upload.getByText("1 possible matches to review")).toBeVisible();
  await expect(upload.getByText("2 kept for later, for books not on the shelf yet")).toBeVisible();
  await expect(upload.getByText("1 skipped (to-read or currently reading)")).toBeVisible();
  await expect(page.getByText("2 books from your history aren't on the shelf yet. They link by themselves when added.")).toBeVisible();

  // Link the possible match.
  const possible = page.getByRole("region", { name: "Possible matches" });
  await expect(possible.getByText("From StoryGraph: Moth Lanterns by Tobias Quillfeather")).toBeVisible();
  await possible.getByRole("button", { name: "Link" }).click();
  await expect(possible.getByText("No possible matches to review.")).toBeVisible();

  const mine = await rest<{ book_id: string; status: string; finished_on: string | null; source: string }[]>(
    a,
    `read_statuses?select=book_id,status,finished_on,source&user_id=eq.${a.userId}&order=book_id`,
  );
  expect(new Map(mine.map((r) => [r.book_id, [r.status, r.finished_on, r.source]]))).toEqual(
    new Map([
      [id("The Salt Road"), ["read", "2026-03-02", "storygraph"]],
      [id("Glass Orchard"), ["read", "2026-04-10", "storygraph"]],
      [id("Moth Lanterns"), ["read", "2026-05-09", "storygraph"]],
    ]),
  );

  // Mark The Salt Road Unread on its page; a re-upload of the same file leaves it Unread.
  await page.goto(`#/book/${id("The Salt Road")}`);
  const yours = page.getByRole("group", { name: "Your reading" });
  await expect(yours.getByRole("button", { name: "Read", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByText("Member B: not read")).toBeVisible();
  await yours.getByRole("button", { name: "Unread" }).click();
  await expect(yours.getByRole("button", { name: "Unread" })).toHaveAttribute("aria-pressed", "true");
  await expect(yours.getByRole("button", { name: "Unread" })).toBeEnabled();

  await page.goto("#/reading");
  const again = await uploadFile(page);
  await expect(again.getByText(/^3 matched books you own \(0 newly marked\)$/)).toBeVisible();
  await page.goto(`#/book/${id("The Salt Road")}`);
  await expect(yours.getByRole("button", { name: "Unread" })).toHaveAttribute("aria-pressed", "true");
  const [salt] = await rest<{ status: string; source: string }[]>(
    a,
    `read_statuses?select=status,source&user_id=eq.${a.userId}&book_id=eq.${id("The Salt Road")}`,
  );
  expect(salt).toEqual({ status: "cleared", source: "app" });

  // Unread by me: everything but the two read books, and Ask is sent exactly those ids.
  const unreadTitles = ["The Salt Road", "Hollow Garden", "Hollow Atlas", "Hollow Delta", "Amber Journal", "Ivory Bastion"];
  await page.goto("#/");
  const count = page.locator("p[aria-live='polite']");
  await expect(count).toHaveText("8 books");
  await page.getByLabel("Read status").selectOption({ label: "Unread by me" });
  await expect(count).toHaveText("6 books");
  expect(await wallIds(page)).toEqual(unreadTitles.map(id).sort());
  await page.getByRole("searchbox", { name: "Search books" }).fill("something cosy");
  await page.getByRole("button", { name: "Ask ✨" }).click();
  await expect.poll(() => askBodies.length).toBe(1);
  expect([...askBodies[0].bookIds].sort()).toEqual(unreadTitles.map(id).sort());
  expect(askBodies[0].prompt).toBe("something cosy");
  await page.getByRole("searchbox", { name: "Search books" }).fill("");

  // A new book matching a kept-for-later row is marked read by itself (REST insert, then a reload).
  const [ferry] = await addBooks(a, [{ title: "The Winter Ferry", authors: ["Mira Okonkwo-Hale"], isbn13: [] }]);
  await page.goto(`#/book/${ferry.id}`);
  await page.reload();
  await expect(yours.getByRole("button", { name: "Read", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByLabel("Finished")).toHaveValue("2026-06-20");

  // Mass edit marks the three Hollow books read for A.
  await page.goto("#/");
  await page.getByLabel("Read status").selectOption({ label: "Any read status" });
  await expect(count).toHaveText("9 books");
  await page.getByRole("searchbox", { name: "Search books" }).fill("hollow");
  await expect(count).toHaveText("3 books");
  await page.getByRole("button", { name: "Select", exact: true }).click();
  await page.getByRole("button", { name: "Select all" }).click();
  const bar = page.getByRole("region", { name: "Selection" });
  await expect(bar.getByText("3 selected")).toBeVisible();
  await bar.getByRole("button", { name: "Edit" }).click();
  const sheet = page.getByRole("dialog", { name: "Edit selected books" });
  await sheet.getByLabel("Mark as… (for you)").selectOption("Read");
  await expect(sheet.getByLabel("Finish date")).toHaveValue("");
  await sheet.getByRole("button", { name: "Save" }).click();
  await expect(sheet.getByText(/^This will change .*3 books.*\. There is no undo\.$/)).toBeVisible();
  await sheet.getByRole("button", { name: "Confirm" }).click();
  await expect(page.getByRole("status").filter({ hasText: /^Changed / })).toBeVisible();
  await expect(sheet).toBeHidden();

  await page.getByRole("searchbox", { name: "Search books" }).fill("");
  await page.getByLabel("Read status").selectOption({ label: "Unread by me" });
  await expect(count).toHaveText("3 books");
  expect(await wallIds(page)).toEqual(["The Salt Road", "Amber Journal", "Ivory Bastion"].map(id).sort());

  // B, in their own browser profile, sees A's read on the book page and can filter by A.
  const contextB = await browser.newContext({ baseURL, viewport: { width: 390, height: 844 } });
  const pageB = await contextB.newPage();
  await routeFunctions(pageB);
  await signIn(pageB, b);
  await pageB.goto(`#/book/${id("Hollow Garden")}`);
  await expect(pageB.getByText(/^Member A: read \(\d{1,2} [A-Z][a-z]{2} \d{4}\)$/)).toBeVisible();
  await expect(pageB.getByRole("group", { name: "Your reading" }).getByRole("button", { name: "Unread" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await pageB.goto("#/");
  await pageB.getByLabel("Read status").selectOption({ label: "Read by Member A" });
  await expect(pageB.locator("p[aria-live='polite']")).toHaveText("6 books");
  await contextB.close();
});

test("before the read-status migration, no reading UI shows and the library still works", async ({ page }) => {
  const a = await newUserWithHousehold("Member A");
  await addBooks(a, [
    { title: "The Salt Road", authors: ["Petra Wynnecombe"], isbn13: [] },
    { title: "Glass Orchard", authors: ["Callum Ashgrove"], isbn13: [] },
  ]);
  await routeFunctions(page);
  // What the API answers while `library.read_statuses` doesn't exist yet.
  let missing = 0;
  await page.route(/\/rest\/v1\/read_statuses(\?|$)/, (route) => {
    if (route.request().method() === "OPTIONS") return route.fulfill({ status: 204, headers: CORS });
    missing++;
    return json(
      route,
      { code: "PGRST205", details: null, hint: null, message: "Could not find the table 'library.read_statuses' in the schema cache" },
      404,
    );
  });
  await signIn(page, a);

  await page.goto("#/");
  await expect(page.locator("p[aria-live='polite']")).toHaveText("2 books");
  // The provider asked and got "missing" before anything below is checked.
  await expect.poll(() => missing).toBeGreaterThan(0);
  // Tagging still loads (its Ask button shows), so only reading is hidden.
  await expect(page.getByRole("button", { name: "Ask ✨" })).toBeVisible();
  await expect(page.getByLabel("Read status")).toHaveCount(0);
  await page.getByRole("button", { name: "Account" }).click();
  await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Reading history" })).toHaveCount(0);
  await expect(page.getByText(/^You've read /)).toHaveCount(0);
  await page.keyboard.press("Escape");

  await page.getByRole("link", { name: /The Salt Road/ }).first().click();
  await expect(page.getByRole("heading", { name: "The Salt Road" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Your reading" })).toHaveCount(0);

  await page.goto("#/");
  await page.getByRole("button", { name: "Select", exact: true }).click();
  await page.getByRole("button", { name: "Select all" }).click();
  await page.getByRole("region", { name: "Selection" }).getByRole("button", { name: "Edit" }).click();
  const sheet = page.getByRole("dialog", { name: "Edit selected books" });
  await expect(sheet.getByRole("heading", { name: "Edit 2 books" })).toBeVisible();
  await expect(sheet.getByLabel("Mark as… (for you)")).toHaveCount(0);
});
