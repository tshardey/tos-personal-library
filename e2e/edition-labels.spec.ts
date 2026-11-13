import { expect, test } from "@playwright/test";
import { newUserWithHousehold, rest, signIn, supabaseEnv, type TestUser } from "./supabase";

/** Renaming one edition label into another merges them, and the library's Edition filter follows. Invented labels only. */

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

const NOTES = ["Lantern Box Edition", "Lantern Box Edition ", "Lantern Box", "Lantern Box", "Harbor Press"];

test("renaming a label into another merges them and the Edition filter follows", async ({ page }) => {
  const user = await newUserWithHousehold("Member A");
  const books = await insert<{ id: string }>(
    user,
    "books",
    NOTES.map((_, i) => ({ household_id: user.householdId, title: `Tide Atlas ${i + 1}`, authors: [] })),
  );
  await insert(
    user,
    "copies",
    books.map((b, i) => ({ book_id: b.id, origin: "manual", edition_note: NOTES[i] })),
  );
  await signIn(page, user);

  await page.goto("#/");
  const count = page.locator("p[aria-live='polite']");
  await expect(count).toHaveText("5 books");
  const edition = page.getByLabel("Edition", { exact: true });
  await edition.selectOption("Lantern Box Edition");
  await expect(count).toHaveText("2 books");

  await page.getByRole("button", { name: "Account" }).click();
  await page.getByRole("link", { name: "Edition labels" }).click();
  await expect(page.getByRole("heading", { name: "Edition labels" })).toBeVisible();
  const list = page.getByRole("list", { name: "Edition labels" });
  await expect(list.getByRole("listitem", { name: "Lantern Box Edition" })).toContainText("2 copies");
  await expect(list.getByRole("listitem", { name: "Lantern Box", exact: true })).toContainText("2 copies");

  await page.getByRole("button", { name: "Rename Lantern Box Edition" }).click();
  await page.getByLabel(/New name/).fill("lantern box");
  await expect(page.getByText(`Merges into "Lantern Box". 2 copies will change; "Lantern Box" will have 4 copies.`)).toBeVisible();
  await page.getByRole("button", { name: "Merge" }).click();
  await page.getByRole("button", { name: "Change 2 copies" }).click();
  await expect(page.getByRole("status")).toHaveText("Changed 2 copies.");
  await expect(list.getByRole("listitem")).toHaveCount(2);
  await expect(list.getByRole("listitem", { name: "Lantern Box", exact: true })).toContainText("4 copies");

  const copies = await rest<{ edition_note: string; user_edited_fields: string[] }[]>(
    user,
    `copies?select=edition_note,user_edited_fields&book_id=in.(${books.map((b) => b.id).join(",")})&edition_note=eq.Lantern%20Box`,
  );
  expect(copies).toHaveLength(4);
  expect(copies.filter((c) => c.user_edited_fields.includes("editionNote"))).toHaveLength(2);

  await page.getByRole("link", { name: "Back to library" }).click();
  await expect(edition).toHaveValue("Lantern Box");
  await expect(edition.locator("option")).toHaveText(["All editions", "Harbor Press", "Lantern Box"]);
  await expect(count).toHaveText("4 books");
});
