import { expect, test } from "@playwright/test";
import { newUserWithHousehold, rest, signIn, supabaseEnv, type TestUser } from "./supabase";

/**
 * Mass edit: search, select every shown book, set an edition label and Deluxe on their copies with
 * one copy of a two-copy book left unticked, confirm, and read the result back. Invented titles and
 * labels only.
 */

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

interface CopyRow {
  id: string;
  book_id: string;
  edition_note: string | null;
  deluxe: boolean;
  user_edited_fields: string[];
}

test("mass edit sets a label and Deluxe on the selected books' ticked copies", async ({ page }) => {
  const user = await newUserWithHousehold("Member A");
  const titles = ["Ember Folio One", "Ember Folio Two", "Ember Folio Three", "Glass Orchard Ledger"];
  const books = await insert<{ id: string; title: string }>(
    user,
    "books",
    titles.map((title) => ({ household_id: user.householdId, title, authors: ["Petra Wynnecombe"] })),
  );
  const id = (title: string) => books.find((b) => b.title === title)!.id;
  // A bulk insert needs the same keys on every row.
  const copy = (title: string, edition_note: string | null = null, location: string | null = null) => ({
    book_id: id(title),
    origin: "manual",
    edition_note,
    location,
  });
  await insert(user, "copies", [
    copy("Ember Folio One"),
    copy("Ember Folio Two", "Harbor Press"),
    // A two-copy book: the original and a second copy that stays unticked.
    copy("Ember Folio Three"),
    copy("Ember Folio Three", "Amber Bastion", "Attic"),
    // The existing label the typed one snaps to; this book is never selected.
    copy("Glass Orchard Ledger", "Lantern Box"),
  ]);
  await signIn(page, user);

  await page.goto("#/");
  const count = page.locator("p[aria-live='polite']");
  await expect(count).toHaveText("4 books");
  await page.getByRole("searchbox", { name: "Search books" }).fill("ember");
  await expect(count).toHaveText("3 books");

  await page.getByRole("button", { name: "Select", exact: true }).click();
  await page.getByRole("button", { name: "Select all" }).click();
  const bar = page.getByRole("region", { name: "Selection" });
  await expect(bar.getByText("3 selected")).toBeVisible();
  await bar.getByRole("button", { name: "Edit" }).click();

  const sheet = page.getByRole("dialog", { name: "Edit selected books" });
  await expect(sheet.getByRole("heading", { name: "Edit 3 books" })).toBeVisible();
  await sheet.getByRole("button", { name: "Edition label: no change" }).click();
  const picker = page.getByRole("dialog", { name: "Edition label" });
  await picker.getByLabel("Filter editions").fill(" lantern BOX");
  await picker.getByLabel("Filter editions").press("Enter");
  await expect(sheet.getByRole("button", { name: "Edition label: Lantern Box" })).toBeVisible();
  await sheet.getByLabel("Deluxe").selectOption("On");

  const three = sheet.getByRole("group", { name: "Ember Folio Three" });
  await expect(three.getByRole("checkbox")).toHaveCount(2);
  await three.getByRole("checkbox", { name: "Shared · Amber Bastion · Attic" }).uncheck();

  await sheet.getByRole("button", { name: "Save" }).click();
  await expect(sheet.getByText("This will change 3 copies. There is no undo.")).toBeVisible();
  await sheet.getByRole("button", { name: "Confirm" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Changed 3 copies." })).toHaveText("Changed 3 copies.");
  await expect(sheet).toBeHidden();
  await expect(bar).toBeHidden();

  // The list reloaded: each selected book now shows Deluxe, and the label is one of the household's.
  for (const title of titles.slice(0, 3)) {
    await expect(page.locator(`[data-book-id="${id(title)}"]`).getByText("Deluxe", { exact: true })).toBeVisible();
  }
  await page.getByRole("searchbox", { name: "Search books" }).fill("");
  await page.getByLabel("Edition", { exact: true }).selectOption("Lantern Box");
  await expect(count).toHaveText("4 books");

  const copies = await rest<CopyRow[]>(
    user,
    `copies?select=id,book_id,edition_note,deluxe,user_edited_fields&book_id=in.(${books.map((b) => b.id).join(",")})`,
  );
  const changed = copies.filter((c) => c.edition_note === "Lantern Box" && c.deluxe);
  expect(changed.map((c) => c.book_id).sort()).toEqual(
    [id("Ember Folio One"), id("Ember Folio Two"), id("Ember Folio Three")].sort(),
  );
  for (const c of changed) expect(c.user_edited_fields).toEqual(["deluxe", "editionNote"]);
  const unticked = copies.find((c) => c.edition_note === "Amber Bastion");
  expect(unticked).toMatchObject({ deluxe: false, user_edited_fields: [] });
  const other = copies.find((c) => c.book_id === id("Glass Orchard Ledger"));
  expect(other).toMatchObject({ edition_note: "Lantern Box", deluxe: false, user_edited_fields: [] });
});

interface JobRow {
  id: string;
  book_id: string;
  reason: string;
  status: string;
}

/** Calls a `library` RPC as that user (local stack). */
async function rpc<T>(user: TestUser, name: string, args: unknown): Promise<T> {
  const { url, key } = supabaseEnv();
  const res = await fetch(`${url}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: {
      apikey: key,
      Authorization: `Bearer ${user.accessToken}`,
      "Content-Type": "application/json",
      "Content-Profile": "library",
    },
    body: JSON.stringify(args),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`rpc ${name} answered ${res.status}: ${text}`);
  return JSON.parse(text) as T;
}

/** New books queue themselves; claim and refuse each open job so the book has none. */
async function closeOpenJobs(user: TestUser, jobs: JobRow[]): Promise<void> {
  for (const j of jobs) {
    const [claim] = await rpc<{ claim_token: string }[]>(user, "claim_tag_job", { p_job: j.id });
    await rpc(user, "release_tag_job", {
      p_job: j.id,
      p_claim: claim.claim_token,
      p_error: "tag_refused",
      p_retry_at: null,
      p_usage: null,
      p_cost_micro: 0,
    });
  }
}

test("Retag selected confirms first, then queues one manual job per book", async ({ page }) => {
  const user = await newUserWithHousehold("Member A");
  const books = await insert<{ id: string; title: string }>(
    user,
    "books",
    ["Lantern Almanac One", "Lantern Almanac Two"].map((title) => ({
      household_id: user.householdId,
      title,
      authors: ["Petra Wynnecombe"],
    })),
  );
  const jobsQuery = `tag_jobs?select=id,book_id,reason,status&book_id=in.(${books.map((b) => b.id).join(",")})`;
  const opened = await rest<JobRow[]>(user, jobsQuery);
  expect(opened).toHaveLength(2);
  await closeOpenJobs(user, opened);
  expect((await rest<JobRow[]>(user, jobsQuery)).every((j) => j.status === "failed")).toBe(true);

  await signIn(page, user);
  await page.goto("#/");
  await page.getByRole("button", { name: "Select", exact: true }).click();
  await page.getByRole("button", { name: "Select all" }).click();
  await page.getByRole("region", { name: "Selection" }).getByRole("button", { name: "Edit" }).click();

  const sheet = page.getByRole("dialog", { name: "Edit selected books" });
  await sheet.getByRole("button", { name: "Retag selected" }).click();
  const confirm = sheet.getByRole("group", { name: "Confirm retag" });
  await expect(confirm.getByText(/^Retag 2 books · /)).toBeVisible();
  await expect(confirm.getByText(/of this month's tagging budget left\.$/)).toBeVisible();

  // Cancel spends nothing and adds no job.
  await confirm.getByRole("button", { name: "Cancel" }).click();
  await expect(confirm).toBeHidden();
  expect(await rest<JobRow[]>(user, jobsQuery)).toHaveLength(2);

  await sheet.getByRole("button", { name: "Retag selected" }).click();
  await confirm.getByRole("button", { name: "Confirm" }).click();
  await expect(sheet.getByText("Queued 2 books for retagging.")).toBeVisible();

  const manual = (await rest<JobRow[]>(user, jobsQuery)).filter((j) => j.reason === "manual");
  expect(manual.map((j) => j.book_id).sort()).toEqual(books.map((b) => b.id).sort());
  // The page may already have started on them.
  for (const j of manual) expect(["queued", "processing"]).toContain(j.status);

  // Both books have an open job now, so pressing it again counts none and adds none.
  await sheet.getByRole("button", { name: "Retag selected" }).click();
  await confirm.getByRole("button", { name: "Confirm" }).click();
  await expect(sheet.getByText("Queued 0 books for retagging.")).toBeVisible();
  expect((await rest<JobRow[]>(user, jobsQuery)).filter((j) => j.reason === "manual")).toHaveLength(2);
});
