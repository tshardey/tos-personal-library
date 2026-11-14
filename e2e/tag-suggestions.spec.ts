import { expect, test } from "@playwright/test";
import { newUserWithHousehold, rest, signIn } from "./supabase";
import { closeOpenJobs, finishOpenJobs, insert, type JobRow } from "./tag-jobs";

/**
 * Retag all books on the Tag suggestions screen: the button spends nothing, Confirm queues one
 * `manual` job per eligible book (tagged books included, a book whose newest job failed left out),
 * and Cancel adds none. Invented titles only.
 */
test("Retag all books confirms first, then queues one manual job per eligible book", async ({ page }) => {
  const user = await newUserWithHousehold("Member A");
  const books = await insert<{ id: string; title: string }>(
    user,
    "books",
    ["Juniper Inlet Codex", "Juniper Inlet Journal", "Juniper Inlet Delta"].map((title) => ({
      household_id: user.householdId,
      title,
      authors: ["Ines Dravenholt"],
    })),
  );
  const id = (title: string) => books.find((b) => b.title === title)!.id;
  const jobsQuery = `tag_jobs?select=id,book_id,reason,status&book_id=in.(${books.map((b) => b.id).join(",")})`;
  const opened = await rest<JobRow[]>(user, jobsQuery);
  expect(opened).toHaveLength(3);
  // Two books are tagged already (a full retag still takes them); the third's job failed.
  const failedId = id("Juniper Inlet Delta");
  await finishOpenJobs(user, opened.filter((j) => j.book_id !== failedId));
  await closeOpenJobs(user, opened.filter((j) => j.book_id === failedId));
  const before = await rest<JobRow[]>(user, jobsQuery);
  expect(before.map((j) => j.status).sort()).toEqual(["done", "done", "failed"]);

  await signIn(page, user);
  await page.goto("#/tags");
  const section = page.getByRole("region", { name: "Retag all books", exact: true });
  const button = section.getByRole("button", { name: "Retag all books (covers too)" });
  await expect(
    page.getByText(
      "Check for new tags is cheap but only rereads each book's summary, so it can't add cover tags. To pick up new cover tags, use Retag all books.",
    ),
  ).toBeVisible();

  await button.click();
  const confirm = section.getByRole("group", { name: "Confirm retag" });
  await expect(confirm.getByText(/^Retag 2 books · /)).toBeVisible();
  await expect(confirm.getByText(/of this month's tagging budget left\.$/)).toBeVisible();

  // Cancel spends nothing and adds no job.
  await confirm.getByRole("button", { name: "Cancel" }).click();
  await expect(confirm).toBeHidden();
  expect(await rest<JobRow[]>(user, jobsQuery)).toHaveLength(3);

  await button.click();
  await confirm.getByRole("button", { name: "Confirm" }).click();
  await expect(section.getByText("Queued 2 books for retagging.")).toBeVisible();

  const manual = (await rest<JobRow[]>(user, jobsQuery)).filter((j) => j.reason === "manual");
  expect(manual.map((j) => j.book_id).sort()).toEqual([id("Juniper Inlet Codex"), id("Juniper Inlet Journal")].sort());
  // The page may already have started on them.
  for (const j of manual) expect(["queued", "processing"]).toContain(j.status);

  // Both have an open job now and the third's newest job failed, so nothing is left to retag.
  await expect(button).toBeDisabled();
});
