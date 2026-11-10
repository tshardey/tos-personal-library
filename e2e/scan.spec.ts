import { expect, test, type Locator, type Page } from "@playwright/test";
import { barcodePng, rawEan13Svg } from "./barcodes";
import { cameraTracks, installFakeCamera, show, torchCalls, type CameraVariant } from "./fake-camera";
import { NOT_FOUND_ISBN, routeCatalogs, titleFor, type CatalogRoutes } from "./routes";
import { newUserWithHousehold, rest, signIn, type TestUser } from "./supabase";

// Synthetic ISBNs only (the repo is public).
const A = "9780000000002";
const B = "9780000000019";
const HOLD = "9780000000026";
const OWNED = "9780000000033";
const PREFIX_979 = "9791000000008";
const BAD_CHECKSUM = "9780000000003";
const EDITION = "Invented Box";

/** The check digit rule of normalizeIsbn13. */
function withCheckDigit(first12: string): string {
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(first12[i]) * (i % 2 === 0 ? 1 : 3);
  return `${first12}${(10 - (sum % 10)) % 10}`;
}

interface Ctx {
  page: Page;
  user: TestUser;
  catalogs: CatalogRoutes;
}

/** The fake camera, the synthetic catalogs and the signed-in session, on one page. */
async function preparePage(page: Page, user: TestUser, variant: CameraVariant = "normal"): Promise<CatalogRoutes> {
  await installFakeCamera(page, variant);
  await signIn(page, user);
  // A beforeunload prompt (unsent scans) must never hold a reload.
  page.on("dialog", (d) => void (d.type() === "beforeunload" ? d.accept() : d.dismiss()));
  return routeCatalogs(page);
}

async function setUp(page: Page, variant: CameraVariant = "normal"): Promise<Ctx> {
  const user = await newUserWithHousehold("Tester");
  const catalogs = await preparePage(page, user, variant);
  return { page, user, catalogs };
}

const rows = (page: Page): Locator => page.getByRole("list", { name: "Scanned books" }).getByRole("listitem");
const rowFor = (page: Page, isbn: string): Locator => rows(page).filter({ hasText: isbn });

async function openScanner(page: Page) {
  await page.goto("#/scan");
  await expect(page.getByRole("button", { name: "Start scanning" })).toBeVisible();
}

async function pickEdition(page: Page, trigger: RegExp, label: string) {
  await page.getByRole("button", { name: trigger }).click();
  const sheet = page.getByRole("dialog");
  await sheet.getByLabel("Filter editions").fill(label);
  await sheet.getByRole("button", { name: `Add "${label}"` }).click();
  await expect(page.getByRole("button", { name: trigger })).toHaveText(new RegExp(`: ${label}$`));
}

async function start(page: Page) {
  await page.getByRole("button", { name: "Start scanning" }).click();
  await expect(page.getByRole("button", { name: "Done" })).toBeVisible();
}

/** Shows the barcode for `ms`, then a blank frame. */
async function showBarcode(page: Page, isbn: string, ms: number) {
  await show(page, await barcodePng(isbn));
  await page.waitForTimeout(ms);
  await show(page, null);
}

async function inboxReviewCards(page: Page): Promise<Locator> {
  const section = page.getByRole("region", { name: "To review" });
  return section.getByRole("article");
}

async function done(page: Page) {
  await page.getByRole("button", { name: "Done" }).click();
  await expect(page.getByRole("heading", { name: "Photo inbox" })).toBeVisible();
}

test.describe("barcode scanner walkthrough", () => {
  test("1. shelf session: three books, a bad checksum, reload, inbox bulk add, library", async ({ page }) => {
    const { user } = await setUp(page);
    await openScanner(page);
    await pickEdition(page, /^Edition for this session/, EDITION);
    await start(page);

    for (const isbn of [A, B, PREFIX_979]) {
      await showBarcode(page, isbn, 2000);
      await page.waitForTimeout(500);
    }
    await expect(rows(page)).toHaveCount(3);
    for (const isbn of [A, B, PREFIX_979]) {
      await expect(rowFor(page, isbn)).toContainText(titleFor(isbn));
    }

    // zxing's writer refuses a wrong check digit, so these bars are drawn by hand.
    await show(page, rawEan13Svg(BAD_CHECKSUM));
    await page.waitForTimeout(2000);
    await show(page, null);
    await page.waitForTimeout(500);
    await expect(rows(page)).toHaveCount(3);

    // Every scan is saved (no "Saving…" row) before the reload.
    await expect(rows(page).filter({ hasText: "Saving…" })).toHaveCount(0);
    await page.reload();
    await expect(page.getByRole("button", { name: "Start scanning" })).toBeVisible();
    await expect(rows(page)).toHaveCount(3);
    for (const isbn of [A, B, PREFIX_979]) {
      await expect(rowFor(page, isbn)).toContainText(titleFor(isbn));
    }
    await expect(page.getByRole("button", { name: /^Edition for this session/ })).toHaveText(
      `Edition for this session: ${EDITION}`,
    );

    await start(page);
    await expect(page.getByRole("button", { name: /^Edition:/ })).toHaveText(`Edition: ${EDITION}`);
    await done(page);
    await expect(await inboxReviewCards(page)).toHaveCount(3);
    await page.getByRole("button", { name: "Add 3 new books" }).click();
    const sheet = page.getByRole("dialog", { name: "Add 3 new books" });
    await expect(sheet.getByText(`Edition: ${EDITION}`)).toHaveCount(3);
    await sheet.getByRole("button", { name: "Add 3 books" }).click();
    await expect(page.getByText("Added 3 new books.")).toBeVisible();

    await page.goto("#/");
    for (const isbn of [A, B, PREFIX_979]) await expect(page.getByRole("link", { name: titleFor(isbn) })).toBeVisible();
    const books = await rest<{ title: string; isbn13: string[]; copies: { origin: string; edition_note: string | null }[] }[]>(
      user,
      `books?select=title,isbn13,copies(origin,edition_note)&household_id=eq.${user.householdId}`,
    );
    expect(books).toHaveLength(3);
    for (const b of books) {
      expect(b.copies).toEqual([{ origin: "scan", edition_note: EDITION }]);
    }
    expect(books.map((b) => b.isbn13[0]).sort()).toEqual([A, B, PREFIX_979].sort());
  });

  test("2. hold and repeat: one row for a held barcode, a deliberate second copy", async ({ page }) => {
    await setUp(page);
    await openScanner(page);
    await start(page);

    await show(page, await barcodePng(HOLD));
    await page.waitForTimeout(10_000);
    await expect(rows(page)).toHaveCount(1);
    await show(page, null);
    await page.waitForTimeout(4000);
    await expect(rows(page)).toHaveCount(1);

    await show(page, await barcodePng(HOLD));
    const prompt = page.getByRole("alertdialog", { name: "Another copy?" });
    await expect(prompt).toContainText("You already scanned this book in this session. Add another copy?");
    await show(page, null);
    await prompt.getByRole("button", { name: "Add another copy" }).click();
    await expect(rows(page)).toHaveCount(2);
    await expect(rows(page).filter({ hasText: titleFor(HOLD) })).toHaveCount(2);

    await done(page);
    const cards = await inboxReviewCards(page);
    await expect(cards).toHaveCount(2);
    for (const card of await cards.all()) {
      await expect(card).toContainText("You scanned this book more than once in this session.");
    }
    await expect(page.getByRole("button", { name: /^Add \d+ new books$/ })).toHaveCount(0);

    await cards.first().getByRole("button", { name: "Confirm" }).click();
    await expect(cards).toHaveCount(1);
    await expect(cards.first().getByRole("radio", { name: `Add a copy to ${titleFor(HOLD)}` })).toBeChecked();
    await expect(cards.first().getByRole("radio", { name: "Already recorded" })).not.toBeChecked();
  });

  test("3. already owned: a scan of a book in the library names its owner", async ({ page }) => {
    await setUp(page);
    await openScanner(page);
    await start(page);
    await showBarcode(page, OWNED, 1500);
    await expect(rowFor(page, OWNED)).toContainText(titleFor(OWNED));
    await done(page);
    const cards = await inboxReviewCards(page);
    await expect(cards).toHaveCount(1);
    await cards.first().getByRole("button", { name: "Confirm" }).click();
    await expect(cards).toHaveCount(0);

    await page.goto("#/scan");
    await start(page);
    await showBarcode(page, OWNED, 1500);
    await expect(rowFor(page, OWNED)).toContainText("Already in library — Tester's copy");
  });

  test("4. not found, then a photo: the photo row replaces it and confirms with the ISBN", async ({ page }) => {
    const { user } = await setUp(page);
    await openScanner(page);
    await start(page);
    await showBarcode(page, NOT_FOUND_ISBN, 1500);
    const row = rowFor(page, NOT_FOUND_ISBN);
    await expect(row).toContainText("Not found online.");

    // A synthetic cover, drawn now; never a file in the repo.
    const jpeg = Buffer.from(
      await page.evaluate(() => {
        const c = document.createElement("canvas");
        c.width = 600;
        c.height = 900;
        const g = c.getContext("2d")!;
        g.fillStyle = "#335";
        g.fillRect(0, 0, 600, 900);
        g.fillStyle = "#fc6";
        g.font = "48px sans-serif";
        g.fillText("Invented Cover", 120, 450);
        return c.toDataURL("image/jpeg", 0.9).split(",")[1];
      }),
      "base64",
    );
    const chooser = page.waitForEvent("filechooser");
    await row.getByRole("button", { name: "Take a photo" }).click();
    await (await chooser).setFiles({ name: "cover.jpg", mimeType: "image/jpeg", buffer: jpeg });

    await expect(rows(page)).toHaveCount(1);
    await expect(rows(page).first()).toContainText(/^Photo · /);
    await expect(rows(page).filter({ hasText: "Not found online." })).toHaveCount(0);
    await expect(rows(page).first()).toContainText("Photo · No title read", { timeout: 60_000 });

    await done(page);
    const cards = await inboxReviewCards(page);
    await expect(cards).toHaveCount(1);
    const card = cards.first();
    await expect(card).toContainText("No title found. Type it to continue.");
    await card.getByLabel("Title").fill("Invented Photographed Book");
    await card.getByRole("button", { name: "Confirm" }).click();
    await expect(cards).toHaveCount(0);

    const books = await rest<{ title: string; isbn13: string[]; copies: { origin: string }[] }[]>(
      user,
      `books?select=title,isbn13,copies(origin)&household_id=eq.${user.householdId}`,
    );
    expect(books).toHaveLength(1);
    expect(books[0].title).toBe("Invented Photographed Book");
    expect(books[0].isbn13).toEqual([NOT_FOUND_ISBN]);
    expect(books[0].copies).toEqual([{ origin: "photo" }]);
  });

  test("5. offline mid-shelf: saved on the phone, kept when the tab dies, uploaded once", async ({ page, context }) => {
    const { user } = await setUp(page);
    await openScanner(page);
    await start(page);
    // Let the session's first reads settle before the network drops.
    await page.waitForTimeout(500);
    await context.setOffline(true);
    await showBarcode(page, A, 1500);
    await page.waitForTimeout(300);
    await showBarcode(page, B, 1500);
    await expect(rows(page)).toHaveCount(2);
    for (const isbn of [A, B]) {
      await expect(rowFor(page, isbn)).toContainText("Saved on this phone. It will upload when you're back online.");
    }
    const outbox = () =>
      page.evaluate(
        (hh) => (JSON.parse(localStorage.getItem(`tpl_scan_outbox_${hh}`) ?? "[]") as { isbn: string }[]).map((e) => e.isbn),
        user.householdId,
      );
    expect((await outbox()).sort()).toEqual([A, B]);

    // NOT VERIFIED here: a reload while still offline. Chromium's offline mode also cuts off the dev
    // server, and the app has no service worker, so an offline reload cannot load the app at all
    // (the same is true on a phone). What a reload must not lose is the outbox, so the tab is
    // killed while offline instead, and reopened once the network is back.
    await page.close();
    await context.setOffline(false);
    const reopened = await context.newPage();
    await preparePage(reopened, user);
    await openScanner(reopened);
    await expect(rows(reopened)).toHaveCount(2);
    await expect(rowFor(reopened, A)).toContainText(titleFor(A), { timeout: 45_000 });
    await expect(rowFor(reopened, B)).toContainText(titleFor(B), { timeout: 45_000 });
    const items = await rest<{ scanned_isbn: string }[]>(
      user,
      `intake_items?select=scanned_isbn&household_id=eq.${user.householdId}`,
    );
    expect(items.map((i) => i.scanned_isbn).sort()).toEqual([A, B]);

    await start(reopened);
    await done(reopened);
    await expect(await inboxReviewCards(reopened)).toHaveCount(2);
  });

  test("6. lookup rate-limited: rows still added, lookups pause, then finish", async ({ page }) => {
    const { catalogs } = await setUp(page);
    await page.clock.install();
    await openScanner(page);
    await start(page);
    catalogs.rateLimitNext(3);
    await showBarcode(page, A, 1500);
    await page.waitForTimeout(300);
    await showBarcode(page, B, 1500);
    await expect(rows(page)).toHaveCount(2);
    await expect(page.getByText("Online lookup paused. It will retry.")).toBeVisible();
    await expect(rowFor(page, A)).toContainText("Looking up…");

    // Each resume tries one lookup; the 2nd and 3rd 429s pause again, so the clock moves on 3 times.
    for (let n = 2; n <= 4; n++) {
      await page.clock.fastForward(61_000);
      await expect.poll(() => catalogs.searches().length).toBeGreaterThanOrEqual(n);
    }
    expect(catalogs.searches().slice(0, 3)).toEqual([A, A, A]);
    await expect(rowFor(page, A)).toContainText(titleFor(A));
    await expect(rowFor(page, B)).toContainText(titleFor(B));
    await expect(page.getByText("Online lookup paused. It will retry.")).toHaveCount(0);
  });

  test("7. permission denied: the denied sentence, and Type ISBN still works", async ({ page }) => {
    await setUp(page, "deny");
    await openScanner(page);
    await page.getByRole("button", { name: "Start scanning" }).click();
    await expect(page.getByText("Camera access is off. You can type an ISBN or take photos instead.")).toBeVisible();
    await page.getByRole("button", { name: "Type ISBN" }).click();
    const sheet = page.getByRole("dialog", { name: "Type ISBN" });
    await sheet.getByLabel("ISBN").fill("0-00-000000-0");
    await sheet.getByRole("button", { name: "Add" }).click();
    await expect(rows(page)).toHaveCount(1);
    await expect(rowFor(page, A)).toContainText(titleFor(A));
  });

  test("8. torch: shown when supported, and pressing it asks for the torch", async ({ page }) => {
    await setUp(page, "torch");
    await openScanner(page);
    await start(page);
    const torch = page.getByRole("button", { name: "Torch" });
    await expect(torch).toBeVisible();
    await torch.click();
    await expect(torch).toHaveAttribute("aria-pressed", "true");
    expect(await torchCalls(page)).toEqual([{ advanced: [{ torch: true }] }]);
  });

  test("9. tab hidden: every track ends; visible again: a new live stream", async ({ page }) => {
    await setUp(page);
    await openScanner(page);
    await start(page);
    await expect.poll(async () => (await cameraTracks(page)).map((t) => t.readyState)).toEqual(["live"]);

    const setVisibility = (state: "hidden" | "visible") =>
      page.evaluate((s) => {
        Object.defineProperty(document, "visibilityState", { configurable: true, get: () => s });
        Object.defineProperty(document, "hidden", { configurable: true, get: () => s === "hidden" });
        document.dispatchEvent(new Event("visibilitychange"));
      }, state);

    await setVisibility("hidden");
    await expect.poll(async () => (await cameraTracks(page)).every((t) => t.readyState === "ended")).toBe(true);

    await setVisibility("visible");
    await expect.poll(async () => (await cameraTracks(page)).map((t) => t.readyState)).toEqual(["ended", "live"]);
    // The new stream reads.
    await showBarcode(page, A, 1500);
    await expect(rowFor(page, A)).toBeVisible();
  });

  test("10. long session: 100 books, bounded memory, at most 21 rows in the DOM", async ({ page }) => {
    test.setTimeout(600_000);
    await setUp(page);
    await openScanner(page);
    await start(page);

    const isbns = Array.from({ length: 100 }, (_, n) => withCheckDigit(`9780000001${String(n).padStart(2, "0")}`));
    expect(new Set(isbns).size).toBe(100);
    const heap = () =>
      page.evaluate(() => {
        (globalThis as unknown as { gc?: () => void }).gc?.();
        return (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize ?? null;
      });

    let afterTen: number | null = null;
    for (const [n, isbn] of isbns.entries()) {
      await show(page, await barcodePng(isbn));
      await expect(rowFor(page, isbn)).toBeVisible();
      expect(await rows(page).count()).toBeLessThanOrEqual(21);
      if (n === 9) afterTen = await heap();
    }
    await show(page, null);
    // Every lookup lands before the last measurement.
    await expect(rows(page).filter({ hasText: "Looking up…" })).toHaveCount(0, { timeout: 120_000 });
    await expect(rows(page).filter({ hasText: "Saving…" })).toHaveCount(0);
    const afterHundred = await heap();
    expect(await rows(page).count()).toBeLessThanOrEqual(21);

    expect(afterTen, "performance.memory is available in Chromium").not.toBeNull();
    const growthMb = (afterHundred! - afterTen!) / (1024 * 1024);
    console.info(`heap after 10 scans ${(afterTen! / 1048576).toFixed(1)} MB, after 100 ${(afterHundred! / 1048576).toFixed(1)} MB`);
    expect(growthMb).toBeLessThan(50);

    await page.getByRole("button", { name: "Show all 100" }).click();
    await expect(rows(page)).toHaveCount(100);
    for (const isbn of isbns) await expect(rowFor(page, isbn)).toHaveCount(1);
  });
});
