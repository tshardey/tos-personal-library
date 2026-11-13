import { deflateSync } from "node:zlib";
import { expect, test, type Page } from "@playwright/test";
import { newUserWithHousehold, signIn, supabaseEnv, type TestUser } from "./supabase";

/**
 * Spec §5.7: going back from a book page restores the list's place, filters and search, and covers
 * loading in after the return don't push the list away. Invented titles only; the cover host is a
 * reserved, non-resolvable domain that page.route answers.
 */

const BOOKS = 150;
const DELUXE_EVERY = 5; // 30 of 150
const COVER_DELAY_MS = 1500;
const COVER_HOST = /^https:\/\/covers\.invalid\//;

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type: string, data: Buffer): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, crc]);
}
/** A small solid-colour RGB PNG, generated here (no image files in the public repo). */
function solidPng(width: number, height: number): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // RGB
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(width * 3, 0x8a)]);
  const raw = Buffer.concat(Array.from({ length: height }, () => row));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

async function insert<T>(user: TestUser, table: string, rows: unknown[]): Promise<T[]> {
  const { url, key } = supabaseEnv();
  const res = await fetch(`${url}/rest/v1/${table}`, {
    method: "POST",
    headers: {
      apikey: key,
      Authorization: `Bearer ${user.accessToken}`,
      "Content-Type": "application/json",
      "Content-Profile": "library",
      Prefer: "return=representation",
    },
    body: JSON.stringify(rows),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`POST ${table} answered ${res.status}: ${text}`);
  return JSON.parse(text) as T[];
}

async function seedFolios(user: TestUser): Promise<void> {
  const books = await insert<{ id: string; title: string }>(
    user,
    "books",
    Array.from({ length: BOOKS }, (_, i) => ({
      household_id: user.householdId,
      title: `Folio ${i + 1}`,
      authors: [],
      cover_url: `https://covers.invalid/folio-${i + 1}.png`,
    })),
  );
  await insert(
    user,
    "copies",
    books.map((b) => ({
      book_id: b.id,
      origin: "manual",
      deluxe: Number(b.title.slice("Folio ".length)) % DELUXE_EVERY === 0,
    })),
  );
}

/** Answers every cover after a delay and reports how many are still in flight. */
async function routeSlowCovers(page: Page): Promise<() => number> {
  const png = solidPng(20, 30);
  let pending = 0;
  await page.route(COVER_HOST, async (route) => {
    pending++;
    try {
      await new Promise((r) => setTimeout(r, COVER_DELAY_MS));
      await route.fulfill({ status: 200, contentType: "image/png", body: png });
    } finally {
      pending--;
    }
  });
  return () => pending;
}

test("going back from a book keeps the search, the chips and the place in the list", async ({ page }) => {
  const user = await newUserWithHousehold("Member A");
  await seedFolios(user);
  const pending = await routeSlowCovers(page);
  await signIn(page, user);

  await page.goto("#/");
  const search = page.getByLabel("Search books");
  await expect(search).toBeVisible();
  await search.fill("Folio");
  await page.getByRole("button", { name: "Deluxe" }).click();
  const count = page.locator("p[aria-live='polite']");
  await expect(count).toHaveText("30 books");

  const cards = page.locator("[data-book-id]");
  await expect(cards).toHaveCount(30);
  const target = cards.nth(24);
  const bookId = await target.getAttribute("data-book-id");
  await target.scrollIntoViewIfNeeded();
  // Let the covers around it finish, so the recorded place is the settled one.
  await page.waitForTimeout(200);
  await expect.poll(pending, { timeout: 15_000 }).toBe(0);
  const before = (await target.boundingBox())!.y;
  expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(1000);

  const title = (await target.locator("p").first().textContent())!;
  await target.click();
  await expect(page.getByRole("heading", { name: title, exact: true })).toBeVisible();

  await page.goBack();
  await expect(page.getByLabel("Search books")).toHaveValue("Folio");
  await expect(page.getByRole("button", { name: "Deluxe" })).toHaveAttribute("aria-pressed", "true");
  await expect(count).toHaveText("30 books");

  // The delayed covers load in after the return; wait for them all to settle.
  await page.waitForTimeout(300);
  await expect.poll(pending, { timeout: 15_000 }).toBe(0);
  await page.waitForTimeout(300);
  const after = (await page.locator(`[data-book-id="${bookId}"]`).boundingBox())!.y;
  expect(Math.abs(after - before)).toBeLessThanOrEqual(8);
});
