import { expect, test, type Page } from "@playwright/test";
import { expectTapTargets } from "./a11y";
import { newUserWithHousehold, rest, signIn, type TestUser } from "./supabase";
import { finishOpenJobs, finishOpenJobsWith, insert, rpc, type JobRow } from "./tag-jobs";

/**
 * Series suggestions (Plan 10): the tagger's series fills a series the household has, a new name
 * waits under Tag suggestions → Series, Approve and Dismiss decide it, a dismissed name stays
 * dismissed, and Find series checks an unchecked book. Jobs finish over RPC as the user (the e2e
 * fake tagger, cost 0). Invented titles, author and series only.
 */

interface BookRow {
  id: string;
  title: string;
  series_name: string | null;
  series_volume: number | string | null;
}

const AUTHOR = "Ines Dravenholt";
const SERIES_PATH = "series_suggestions?select=name,status";

async function seed(
  user: TestUser,
  rows: { title: string; authors?: string[]; series_name?: string; series_volume?: number }[],
) {
  const books = await insert<BookRow>(
    user,
    "books",
    // PostgREST wants the same keys on every row of a bulk insert.
    rows.map((r) => ({ household_id: user.householdId, authors: [AUTHOR], series_name: null, series_volume: null, ...r })),
  );
  const id = (title: string) => books.find((b) => b.title === title)!.id;
  const ids = books.map((b) => b.id).join(",");
  const jobs = () => rest<JobRow[]>(user, `tag_jobs?select=id,book_id,reason,status&book_id=in.(${ids})`);
  const bookRows = () =>
    rest<BookRow[]>(user, `books?select=id,title,series_name,series_volume&id=in.(${ids})&order=title`);
  return { books, id, jobs, bookRows };
}

const volume = (v: BookRow["series_volume"]) => (v === null ? null : Number(v));

async function openMore(page: Page) {
  await page.getByRole("navigation", { name: "Main" }).getByRole("button", { name: "More" }).click();
  return page.getByRole("dialog", { name: "More" });
}

test("series suggestions: filled, suggested, approved, dismissed, and Find series", async ({ page }) => {
  const user = await newUserWithHousehold("Member A");
  const { id, jobs, bookRows } = await seed(user, [
    { title: "Thornmere Dawn", series_name: "Thornmere Cycle", series_volume: 1 },
    { title: "Thornmere Dusk" },
    { title: "Saltglass One" },
    { title: "Saltglass Two" },
    { title: "Wrenfold Hollow" },
    { title: "Hollowmere Quiet" },
  ]);

  const series: Record<string, object> = {
    [id("Thornmere Dusk")]: { series: { name: "thornmere cycle", volume: 2, why: "w" } },
    [id("Saltglass One")]: { series: { name: "Saltglass Archive", volume: 1, why: "Named on the cover." } },
    [id("Saltglass Two")]: { series: { name: "Saltglass Archive", volume: null, why: "Same world as the first." } },
    [id("Wrenfold Hollow")]: { series: { name: "Wrenfold Tales", volume: 1, why: "Book one of the tales." } },
  };
  // Every new book queued itself. All finish before the page opens (it would run them otherwise);
  // Thornmere Dawn and Hollowmere Quiet finish with no series key, so their cards are unchecked.
  const opened = await jobs();
  expect(opened).toHaveLength(6);
  await finishOpenJobsWith(user, opened, (bookId) => series[bookId] ?? {});

  // A series the household has is applied directly, under the household's spelling.
  const dusk = (await bookRows()).find((b) => b.title === "Thornmere Dusk")!;
  expect([dusk.series_name, volume(dusk.series_volume)]).toEqual(["Thornmere Cycle", 2]);
  expect((await rest<{ name: string; status: string }[]>(user, `${SERIES_PATH}&order=name`)).map((s) => s.name)).toEqual([
    "Saltglass Archive",
    "Wrenfold Tales",
  ]);

  await signIn(page, user);
  await page.goto("#/");
  const more = await openMore(page);
  await expect(more.getByRole("link", { name: "Tag suggestions, 2 waiting", exact: true })).toBeVisible();
  await more.getByRole("link", { name: "Tag suggestions, 2 waiting", exact: true }).click();
  await expect(page).toHaveURL(/#\/tags$/);

  const region = page.getByRole("region", { name: "Series", exact: true });
  const heading = region.getByRole("heading", { name: "Series", exact: true });
  const saltglass = region.getByRole("listitem", { name: "Saltglass Archive", exact: true });
  const wrenfold = region.getByRole("listitem", { name: "Wrenfold Tales", exact: true });
  await expect(saltglass).toBeVisible();
  await expect(wrenfold).toBeVisible();
  // The server lists a suggestion's books in no fixed order, so the order is read from the page.
  const shown = await saltglass.getByRole("link").allTextContents();
  expect([...shown].sort()).toEqual(["Saltglass One", "Saltglass Two"]);
  await expect(wrenfold.getByRole("link")).toHaveText(["Wrenfold Hollow"]);

  await test.step("tap targets on the Series region", async () => {
    await expectTapTargets(page, region);
  });

  await test.step("keyboard: name, each number, Approve, Dismiss in order", async () => {
    const name = saltglass.getByLabel("Series name");
    await name.focus();
    const order = [
      saltglass.getByLabel("Series name"),
      ...shown.flatMap((title) => [
        saltglass.getByRole("link", { name: title }),
        saltglass.getByLabel(`Number for ${title}`),
      ]),
      saltglass.getByRole("button", { name: "Approve" }),
      saltglass.getByRole("button", { name: "Dismiss" }),
    ];
    for (const [i, target] of order.entries()) {
      if (i > 0) await page.keyboard.press("Tab");
      await expect(target).toBeFocused();
    }
  });

  await test.step("Approve fills both books", async () => {
    await expect(saltglass.getByLabel("Number for Saltglass One")).toHaveValue("1");
    await expect(saltglass.getByLabel("Number for Saltglass Two")).toHaveValue("");
    await saltglass.getByLabel("Number for Saltglass Two").fill("2");
    await saltglass.getByRole("button", { name: "Approve" }).click();
    await expect(region.getByRole("status")).toHaveText("Added 2 books to Saltglass Archive.");
    await expect(saltglass).toHaveCount(0);
    await expect(heading).toBeFocused();
    const rows = (await bookRows()).filter((b) => b.title.startsWith("Saltglass"));
    expect(rows.map((b) => [b.title, b.series_name, volume(b.series_volume)])).toEqual([
      ["Saltglass One", "Saltglass Archive", 1],
      ["Saltglass Two", "Saltglass Archive", 2],
    ]);
    const [s] = await rest<{ status: string }[]>(user, `${SERIES_PATH}&name=eq.Saltglass%20Archive`);
    expect(s.status).toBe("approved");
  });

  await test.step("Dismiss removes it, and it stays gone after a reload", async () => {
    await wrenfold.getByRole("button", { name: "Dismiss" }).click();
    await expect(region.getByRole("status")).toHaveText("Dismissed Wrenfold Tales.");
    await expect(wrenfold).toHaveCount(0);
    await expect(heading).toBeFocused();
    await page.reload();
    await expect(region.getByText("No series suggestions right now.")).toBeVisible();
    await expect(wrenfold).toHaveCount(0);
  });

  await test.step("a dismissed name stays dismissed after a retag", async () => {
    // Off the app, so the page doesn't start on the retag's job first.
    await page.goto("about:blank");
    await rpc(user, "request_tagging", {
      p_household: user.householdId,
      p_book_ids: [id("Wrenfold Hollow")],
      p_reason: "manual",
      p_run: null,
    });
    const manual = (await jobs()).filter((j) => j.reason === "manual" && j.status === "queued");
    expect(manual).toHaveLength(1);
    await finishOpenJobsWith(user, manual, () => series[id("Wrenfold Hollow")]);
    const pending = await rest<{ name: string }[]>(user, `${SERIES_PATH}&status=eq.pending`);
    expect(pending).toEqual([]);
    const hollow = (await bookRows()).find((b) => b.title === "Wrenfold Hollow")!;
    expect([hollow.series_name, hollow.series_volume]).toEqual([null, null]);
  });

  await test.step("Find series checks the one unchecked book", async () => {
    await page.goto("#/tags");
    await expect(region.getByText("No series suggestions right now.")).toBeVisible();
    await region.getByRole("button", { name: "Find series" }).click();
    const confirm = region.getByRole("group", { name: "Confirm series check" });
    await expect(confirm.getByText(/^Check 1 book · /)).toBeVisible();
    await confirm.getByRole("button", { name: "Confirm" }).click();
    await expect(region.getByText("Queued 1 book for a series check.")).toBeVisible();
    const queued = await rest<JobRow[]>(
      user,
      `tag_jobs?select=id,book_id,reason,status&reason=eq.series&book_id=eq.${id("Hollowmere Quiet")}`,
    );
    expect(queued).toHaveLength(1);
    const all = await jobs();
    expect(all.filter((j) => j.reason === "series")).toHaveLength(1);
  });
});

test("Add to your series: cross-author books wait, same-author books fill", async ({ page }) => {
  const user = await newUserWithHousehold("Member A");
  const SERIES = "Lantern Vale Cycle";
  const found = (volume: number) => ({ series: { name: "lantern vale cycle", volume, why: "w" }, seriesStatus: "found" });
  const first = await seed(user, [
    { title: "Lantern Dawn", authors: ["M. Holt"], series_name: SERIES, series_volume: 1 },
    { title: "Reed One", authors: ["A. Reed"] },
    { title: "Reed Two", authors: ["A. Reed"] },
    { title: "Holt Two", authors: ["M. Holt"] },
  ]);
  // Every new book queued itself. Finish them all before the page opens (it would run them otherwise).
  const opened = await first.jobs();
  expect(opened).toHaveLength(4);
  await finishOpenJobsWith(user, opened, (bookId) =>
    bookId === first.id("Reed One") || bookId === first.id("Reed Two") ? found(2) : {},
  );

  // Another author's series waits: both Reed books are still blank, and so is Holt Two.
  const waiting = (await first.bookRows()).filter((b) => b.title.startsWith("Reed"));
  expect(waiting.map((b) => [b.title, b.series_name, b.series_volume])).toEqual([
    ["Reed One", null, null],
    ["Reed Two", null, null],
  ]);

  await signIn(page, user);
  await page.goto("#/tags");
  const region = page.getByRole("region", { name: "Series", exact: true });
  const heading = region.getByRole("heading", { name: "Series", exact: true });
  const item = region.getByRole("listitem", { name: `Add to your series ${SERIES}`, exact: true });
  await expect(item).toBeVisible();
  expect([...(await item.getByRole("link").allTextContents())].sort()).toEqual(["Reed One", "Reed Two"]);
  await expect(item.getByText(`Joins your series "${SERIES}".`)).toBeVisible();
  await expect(item.getByLabel("Series name")).toHaveCount(0);

  await test.step("tap targets on the Series region", async () => {
    await expectTapTargets(page, region);
  });

  await test.step("Approve fills both books under the household's spelling", async () => {
    await item.getByLabel("Number for Reed Two").fill("");
    await item.getByRole("button", { name: "Approve" }).click();
    await expect(region.getByRole("status")).toHaveText(`Added 2 books to ${SERIES}.`);
    await expect(item).toHaveCount(0);
    await expect(heading).toBeFocused();
    const rows = (await first.bookRows()).filter((b) => b.title.startsWith("Reed"));
    expect(rows.map((b) => [b.title, b.series_name, volume(b.series_volume)])).toEqual([
      ["Reed One", SERIES, 2],
      ["Reed Two", SERIES, null],
    ]);
  });

  await test.step("Dismiss leaves a later cross-author book blank", async () => {
    // Off the app, so the page doesn't run the new book's job first. This author has no book in the series (A. Reed now has), so it still waits.
    await page.goto("about:blank");
    const second = await seed(user, [{ title: "Fenn Three", authors: ["Petra Wynnecombe"] }]);
    await finishOpenJobsWith(user, await second.jobs(), () => found(3));
    expect((await second.bookRows()).map((b) => b.series_name)).toEqual([null]);
    await page.goto("#/tags");
    await expect(item).toBeVisible();
    await expect(item.getByRole("link")).toHaveText(["Fenn Three"]);
    await item.getByRole("button", { name: "Dismiss" }).click();
    await expect(region.getByRole("status")).toHaveText(`Dismissed ${SERIES} for these books.`);
    await expect(item).toHaveCount(0);
    await expect(heading).toBeFocused();
    expect((await second.bookRows()).map((b) => b.series_name)).toEqual([null]);

    // A same-author book (M. Holt) still fills directly: the dismissal was Fenn Three's alone.
    await page.goto("about:blank");
    await rpc(user, "request_tagging", {
      p_household: user.householdId,
      p_book_ids: [first.id("Holt Two")],
      p_reason: "manual",
      p_run: null,
    });
    const holt = (await first.jobs()).filter((j) => j.reason === "manual" && j.status === "queued");
    expect(holt).toHaveLength(1);
    await finishOpenJobsWith(user, holt, () => found(2));
    const holtRow = (await first.bookRows()).find((b) => b.title === "Holt Two")!;
    expect([holtRow.series_name, volume(holtRow.series_volume)]).toEqual([SERIES, 2]);

    // Retagging the dismissed book brings nothing back.
    await rpc(user, "request_tagging", {
      p_household: user.householdId,
      p_book_ids: [second.id("Fenn Three")],
      p_reason: "manual",
      p_run: null,
    });
    const retag = (await second.jobs()).filter((j) => j.reason === "manual" && j.status === "queued");
    expect(retag).toHaveLength(1);
    await finishOpenJobsWith(user, retag, () => found(3));
    expect((await second.bookRows()).map((b) => b.series_name)).toEqual([null]);
    await page.goto("#/tags");
    await expect(region.getByText("No series suggestions right now.")).toBeVisible();
    await expect(item).toHaveCount(0);
  });

  await test.step("an unsure answer queues one series follow-up, not a Find series run", async () => {
    await page.goto("about:blank");
    const third = await seed(user, [{ title: "Mire One", authors: ["A. Reed"] }]);
    await finishOpenJobsWith(user, await third.jobs(), () => ({ series: null, seriesStatus: "unsure" }));
    const followUps = await rest<{ book_id: string; kind: string; reason: string; run_id: string | null }[]>(
      user,
      `tag_jobs?select=book_id,kind,reason,run_id&kind=eq.series&book_id=eq.${third.id("Mire One")}`,
    );
    expect(followUps).toEqual([{ book_id: third.id("Mire One"), kind: "series", reason: "unsure", run_id: null }]);
    await page.goto("#/tags");
    await expect(region.getByText("No series suggestions right now.")).toBeVisible();
    await expect(region.getByText(/^Checked \d+ of \d+/)).toHaveCount(0);
  });
});

test("without the series tables, tag suggestions work and no Series section or series count shows", async ({ page }) => {
  const user = await newUserWithHousehold("Member A");
  const { id, jobs } = await seed(user, [{ title: "Saltglass One" }, { title: "Lantern Vale Morning" }]);
  // A pending series suggestion exists, but the page is told the table is missing (PGRST205).
  const opened = await jobs();
  await finishOpenJobsWith(user, opened.filter((j) => j.book_id === id("Saltglass One")), () => ({
    series: { name: "Saltglass Archive", volume: 1, why: "Named on the cover." },
  }));
  await finishOpenJobs(user, opened.filter((j) => j.book_id !== id("Saltglass One")));
  expect(await rest<{ name: string; status: string }[]>(user, SERIES_PATH)).toEqual([{ name: "Saltglass Archive", status: "pending" }]);

  await page.route(/\/rest\/v1\/series_suggestions\?/, (route) =>
    route.fulfill({
      status: 404,
      contentType: "application/json",
      json: {
        code: "PGRST205",
        details: null,
        hint: null,
        message: "Could not find the table 'library.series_suggestions' in the schema cache",
      },
    }),
  );
  await signIn(page, user);

  await page.goto("#/");
  // Ask is still offered on the library.
  await expect(page.getByRole("button", { name: "Ask ✨" }).first()).toBeVisible();
  let more = await openMore(page);
  await expect(more.getByRole("link", { name: "Tag suggestions", exact: true })).toBeVisible();
  await page.keyboard.press("Escape");

  await page.goto("#/tags");
  await expect(page.getByRole("heading", { name: "Tag suggestions" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Retag all books (covers too)" })).toBeEnabled();
  await expect(page.getByRole("region", { name: "Suggestions" }).getByText("No suggestions right now.")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Series", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Find series" })).toHaveCount(0);

  // A tag suggestion still shows, and the count is the tag suggestions alone.
  await page.goto("about:blank");
  await rpc(user, "request_tagging", {
    p_household: user.householdId,
    p_book_ids: [id("Lantern Vale Morning")],
    p_reason: "manual",
    p_run: null,
  });
  const manual = (await jobs()).filter((j) => j.reason === "manual" && j.status === "queued");
  await finishOpenJobsWith(user, manual, () => ({
    suggestions: [{ id: "lamplit-ferries", label: "Lamplit ferries", category: "setting", why: "The river crossings." }],
  }));
  await page.goto("#/tags");
  await expect(page.getByRole("region", { name: "Suggestions" }).getByText("Lamplit ferries")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Series", exact: true })).toHaveCount(0);
  more = await openMore(page);
  await expect(more.getByRole("link", { name: "Tag suggestions, 1 waiting", exact: true })).toBeVisible();
});
