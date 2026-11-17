import { expect, test, type Page } from "@playwright/test";
import { expectTapTargets, routeFakeCovers } from "./a11y";
import { newUserWithHousehold, signIn } from "./supabase";
import { insert } from "./tag-jobs";

/** Plan 9 PR 3 (D9): the book page's two columns, tabs, Mark read shortcut and More actions menu. Invented data only. */

async function seedBook(): Promise<{ user: Awaited<ReturnType<typeof newUserWithHousehold>>; ids: string[] }> {
  const user = await newUserWithHousehold("Member A");
  const rows = await insert<{ id: string; title: string }>(user, "books", [
    {
      household_id: user.householdId,
      title: "The Salt Road",
      authors: ["Petra Wynnecombe"],
      synopsis: "A courier crosses the salt flats with a sealed letter.",
      cover_url: "https://covers.invalid/3.svg",
    },
    {
      household_id: user.householdId,
      title: "Glass Orchard",
      authors: ["Petra Wynnecombe"],
      synopsis: null,
      cover_url: "https://covers.invalid/4.svg",
    },
  ]);
  const byTitle = new Map(rows.map((r) => [r.title, r.id]));
  const salt = byTitle.get("The Salt Road")!;
  const glass = byTitle.get("Glass Orchard")!;
  await insert(user, "copies", [
    { book_id: salt, origin: "manual", deluxe: false },
    { book_id: salt, origin: "manual", deluxe: true },
    { book_id: glass, origin: "manual", deluxe: false },
  ]);
  return { user, ids: [salt, glass] };
}

async function open(page: Page, user: Awaited<ReturnType<typeof newUserWithHousehold>>, id: string) {
  await routeFakeCovers(page);
  await signIn(page, user);
  await page.goto(`#/book/${id}`);
  await expect(page.getByRole("heading", { level: 2 })).toBeVisible();
}

const tab = (page: Page, name: string | RegExp) => page.getByRole("tab", { name });
const localDay = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

test("tabs by keyboard, and the chosen tab is remembered on another book", async ({ page }) => {
  const { user, ids } = await seedBook();
  await open(page, user, ids[0]);
  await expect(page.getByRole("heading", { level: 2, name: "The Salt Road" })).toBeVisible();
  await expect(tab(page, "Overview")).toHaveAttribute("aria-selected", "true");
  await expect(tab(page, "Copies (2)")).toBeVisible();

  await tab(page, "Overview").focus();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await expect(tab(page, "Tags")).toHaveAttribute("aria-selected", "true");
  await expect(tab(page, "Tags")).toBeFocused();
  await page.keyboard.press("End");
  await expect(tab(page, "Tome of Secrets")).toHaveAttribute("aria-selected", "true");

  await page.goto(`#/book/${ids[1]}`);
  await page.reload();
  await expect(page.getByRole("heading", { level: 2, name: "Glass Orchard" })).toBeVisible();
  await expect(tab(page, "Tome of Secrets")).toHaveAttribute("aria-selected", "true");
});

test("Mark read: the label changes, Overview shows Read pressed, and it survives a reload with today's date", async ({ page }) => {
  const { user, ids } = await seedBook();
  await open(page, user, ids[0]);
  await page.getByRole("button", { name: "Mark read", exact: true }).click();
  await expect(page.getByRole("button", { name: "Your reading: Read" })).toBeVisible();
  const group = page.getByRole("group", { name: "Your reading" });
  await expect(group.getByRole("button", { name: "Read", exact: true })).toHaveAttribute("aria-pressed", "true");

  await page.reload();
  await expect(page.getByRole("button", { name: "Your reading: Read" })).toBeVisible();
  const finished = page.getByLabel("Finished");
  await expect(finished).toHaveValue(/^\d{4}-\d{2}-\d{2}$/);
  const value = await finished.inputValue();
  const utc = new Date().toISOString().slice(0, 10);
  expect([localDay(), utc]).toContain(value);
});

test("More actions: Enter opens, Escape closes with focus back, Add copy opens the form on Copies (2)", async ({ page }) => {
  const { user, ids } = await seedBook();
  await open(page, user, ids[0]);
  const more = page.getByRole("button", { name: "More actions" });
  await more.focus();
  await page.keyboard.press("Enter");
  await expect(more).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByRole("button", { name: "Delete book" })).toBeVisible();
  // Move focus into the menu first, so Escape has to send it back to the button.
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "Add copy" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(more).toHaveAttribute("aria-expanded", "false");
  await expect(page.getByRole("button", { name: "Delete book" })).toHaveCount(0);
  await expect(more).toBeFocused();

  await more.click();
  await page.getByRole("button", { name: "Add copy" }).click();
  await expect(tab(page, "Copies (2)")).toHaveAttribute("aria-selected", "true");
  const panel = page.getByRole("tabpanel");
  await expect(panel.getByRole("button", { name: "Add copy" })).toBeVisible();
  await expect(panel.getByRole("button", { name: "Cancel" })).toBeVisible();
});

test("layout: two columns at 1280px, the cover above the tablist at 390px", async ({ page }) => {
  const { user, ids } = await seedBook();
  await page.setViewportSize({ width: 1280, height: 800 });
  await open(page, user, ids[0]);
  const cover = page.getByRole("img", { name: "The Salt Road cover" });
  const tablist = page.getByRole("tablist", { name: "Book sections" });
  await expect(cover).toBeVisible();
  const c1 = (await cover.boundingBox())!;
  const t1 = (await tablist.boundingBox())!;
  expect(c1.x + c1.width).toBeLessThanOrEqual(t1.x);

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(cover).toBeVisible();
  const c2 = (await cover.boundingBox())!;
  const t2 = (await tablist.boundingBox())!;
  expect(c2.y + c2.height).toBeLessThanOrEqual(t2.y);
});

test("tap targets at 390px: the left-column actions, the tablist and Your reading are 44px or more", async ({ page }) => {
  const { user, ids } = await seedBook();
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page, user, ids[0]);
  await expectTapTargets(page, page.getByRole("tablist", { name: "Book sections" }));
  const reading = page.getByRole("group", { name: "Your reading" });
  await expectTapTargets(page, reading);
  // Read shows the finished date and its Clear date button.
  await reading.getByRole("button", { name: "Read", exact: true }).click();
  const clear = page.getByRole("button", { name: "Clear date" });
  await expect(clear).toBeVisible();
  await expectTapTargets(page, reading);
  const box = (await clear.boundingBox())!;
  expect(Math.min(box.width, box.height)).toBeGreaterThanOrEqual(43.5);
  const actions = page.getByRole("group", { name: "Book actions" });
  await expectTapTargets(page, actions);
  await page.getByRole("button", { name: "More actions" }).click();
  await expectTapTargets(page, actions);
});
