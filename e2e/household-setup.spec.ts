import { expect, test } from "@playwright/test";
import { newUserWithoutHousehold, signIn } from "./supabase";

/** An email with no household lands on household setup, which says which email that is. */
test("household setup names the signed-in email and offers a way back", async ({ page }) => {
  const user = await newUserWithoutHousehold();
  await signIn(page, user);

  await page.goto("#/");
  await expect(page.getByRole("heading", { name: "Create a household" })).toBeVisible();
  await expect(page.getByText(/You're signed in as/)).toContainText(
    `You're signed in as ${user.email}. This email isn't part of a household yet.`,
  );

  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
  // This email never opened a library, so sign-in doesn't suggest it.
  await expect(page.getByLabel("Email")).toHaveValue("");
});
