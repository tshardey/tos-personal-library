# Plan 5: Cover finder — design

Status: designed with Tierra on 2026-11-12; builder check done and its questions answered. Awaiting Tierra's review of this document.
Replaces the Plan 5 roadmap note in `2026-11-10-barcode-scanner-and-editions-design.md` §8.

## 1. Why

Many covers in the household library are wrong or missing:

- **Wrong language.** Automatic lookups sometimes return a Spanish (or other non-English) edition's cover.
- **Publisher placeholders.** Pre-release "cover coming soon" images, or plain text on a coloured block, that were never replaced by the real cover.
- **Wrong book.** A cover from a different title.
- **Missing.** Reasonably popular titles with no cover at all. Today's automatic covers come from OpenLibrary and Google Books **by ISBN only** (`src/lib/google-books.ts`, the libib enrich step). When the ISBN in hand has no image, nothing is tried, even though other editions of the same title usually have one.

Tierra hasn't fixed any of these by hand yet. The cover wall is the main way the household browses the library, so bad covers make it worse to use.

## 2. What success looks like

- Tierra can fix a bad cover from the book's page in a few taps, with an optional note on what's wrong.
- Tierra can mark books, or filter to every book with no cover, and send them all off in one batch. They then review the results in one scrolling list and apply them with a single button.
- What they see has already been screened. Covers that aren't in English, placeholders and covers of other books are thrown out before they see them.
- New covers flow into Tome of Secrets automatically, because ToS shelf records copy `cover_url` from the library when it refreshes (Plan 4).

## 3. Goals, non-goals, anti-goals

**Goals**
- Find a clean, flat, **English retail cover** for a title.
- Run one book at a time, or as a background batch.
- Show several candidates per book next to the current cover, with the best match already picked.
- Change nothing until the person reviewing applies the result.

**Non-goals**
- **Special-edition covers.** For Broken Binding, OwlCrate, FaeCrate and other book-box editions, the standard retail cover is good enough, because flat images of deluxe covers are hard to find (Tierra). The finder never tries to find a copy's own edition cover. Copy photos stay as they are.
- Changing titles, authors, synopses or ISBNs. This is covers only.
- Hosting cover images ourselves. See §6.4.

**Anti-goals** (failure even if it technically works)
- **A cover changing without someone approving it.** Not even a "high-confidence" match is applied automatically.
- **Spend that surprises Tierra.** No batch starts without a cost estimate first, and a failure must never loop and keep billing.
- **The review becoming a chore.** If most rows need a decision, the screening isn't doing its job.
- **Throwing away a hand-set cover.** A cover someone typed in is replaced only when a person picks a new one.

## 4. Constraints

- The Claude API key and the **$10 monthly workspace cap** already used by photo intake (`library-intake` Edge Function) are shared with this feature (Tierra agreed). Cover finding has its own lower monthly limit within that cap (§5.4). The key stays server-side.
- **ToS owns all migrations.** Schema changes and Edge Functions go in a ToS PR; the UI goes in a library-app PR. Production `db push`, function deploys and secret changes are user-approved steps that agents never run.
- Both repos are public. Fixtures and PR text use synthetic titles only.
- The household is two people (Tierra and AJ), sharing one catalogue. Either one can use the finder, and the marks and results are shared.
- Phone-first layout, matching the existing app (Vite, React 19, TypeScript, Tailwind 4).

## 5. How it works (decided)

### 5.1 Starting a search

**From a book's page:** a **Find a better cover** action opens a small panel with:
- optional quick reasons: *Wrong language*, *Placeholder*, *Wrong book*, *Low quality*;
- an optional free-text note, for example "this is the Spanish edition";
- two buttons: **Find now** (this book only) and **Add to batch** (marks the book).

**From the library list:**
- **No cover** filter: every book without a stock `cover_url`. A book showing only our copy's photo counts as having no cover. *(Claude's call: the photo is a stand-in, not a retail cover.)* These books don't need marking first.
- **Marked for cover** filter: books someone marked with Add to batch.
- **Nothing found** filter: books whose last search came back with nothing good (§5.2).
- With either of the first two filters active, a footer shows the count and an estimated cost, plus a **Find covers** button that sends the whole filtered set. Books already tried with nothing found are left out of both the batch and the estimate.

**A batch is saved on the server and resumes whenever either household member has the app open** (Tierra's choice). Nothing runs while nobody has the app open, so no server credential beyond the signed-in user's own is needed, as with photo intake. Closing the app mid-batch loses nothing. When results are ready, a **Covers to review (n)** badge appears.

### 5.2 Finding and screening candidates

For each book:

1. **Gather candidates** from free cover sources, searching **by title and author across all editions**, not only the ISBN in hand. OpenLibrary and Google Books are the starting set.
2. **Pre-filter** on the sources' own metadata where it exists: language, matching title and author, and an image big enough to be a real cover.
3. **Claude screens** the remaining images. It sees each candidate image, the book's title and author, and the reasons and note given. It throws out anything not in English, any placeholder or "coming soon" image, any cover of a different book, and anything unusable (tiny, a photo of a physical copy, a 3D mock-up). It ranks what passes, best first.
4. **Store the results.** Up to about 4 candidates per book are kept until someone reviews them.

**Translated works.** Tierra owns many English translations of books first published in another language. The right cover is the **English translation's** cover, and the original-language edition's cover is the classic wrong match for these books. Screening must reject it even when the title and author match. Every book in the library is treated as an English edition; there is no per-book language setting.

If nothing passes, the book's result is **Nothing good found**. It moves to the Nothing found filter and stays out of later No cover and Marked batches, so it is never paid for twice without someone asking. It becomes eligible again when someone retries it by hand (from its row in the Nothing found filter, or from its page) or gives it a new note. *(Claude's call.)*

### 5.3 Reviewing results (layout B, chosen by Tierra)

- One scrolling list with a row per book: its title, the reason or note, the current cover (or "none"), then the candidates that passed.
- The best match is already picked on each row. Tap a different candidate to change the choice, or tap the current cover to keep it.
- A footer shows how many rows have a pick and an **Apply n** button that saves them all at once. Rows set to keep the current cover, and "Nothing good found" rows, change nothing.
- After Apply, each applied book's mark is cleared and its result is removed. Unreviewed results stay until someone reviews them.

Mockup: `.superpowers/brainstorm/` in this repo (git-ignored), `cover-review.html`.

### 5.4 Cost

- Before a batch starts, the footer shows a rough cost for the number of books selected.
- Per-book work is bounded: a fixed maximum number of candidate images per book, and one screening call per book.
- **Cover finding has its own monthly limit of about $5** (Tierra's choice), so it can never use up the $10 workspace cap that photo and scan intake depend on. Spend is tracked per household per calendar month, in the same spirit as intake's daily counter (`intake_usage`). Track it as estimated cost or as a call count derived from the measured per-book cost; the builder chooses.
- Near the limit, the Find covers footer says how many books the remaining budget covers. At the limit, the batch stops cleanly and says so ("This month's cover-finding budget is used up"). Unfinished books stay queued for next month or for a manual retry.
- If the API itself rejects calls because the workspace cap is reached, the batch stops the same way and nothing retries in a loop.

## 6. Left to the builder

These don't change what Tierra sees; the builder settles them and records each decision in the plan.

1. **Where it runs.** An Edge Function holding the Claude key, acting only as the signed-in caller (like `library-intake`, D4), with a queue table like `intake_items` (claim, backoff, attempt limit) that the open app drains. No scheduler and no elevated server credential (§5.1). Reusing patterns from `library-intake` and `useIntake.ts` is encouraged.
2. **The model and the screening prompt.** `library-intake` uses `claude-haiku-5-5`. Measure cost and accuracy on a synthetic set before choosing, and set the cost estimate from what you measure. Text in images is content, never instructions.
3. **Exact candidate sources and limits.** Whether to add a web-search fallback for books where the free sources give nothing usable. If added, it must keep within the cost bound in §5.4 and respect site terms. *(Claude's call: start without it, and measure how many of the real no-cover books the free sources fix.)*
4. **Hotlink or copy.** Keep hotlinking `cover_url` as today. *(Claude's call: consistent with existing covers and ToS's copy of the URL; storing images is a non-goal.)* If a source's URLs turn out to be unstable, record it as a follow-up.
5. **Schema.** Mark state per book (reasons, note, who marked it, when), plus a results store per book with ranked candidate URLs, all household-scoped under RLS with pgTAP tests. Applying a cover is an ordinary `cover_url` update.
6. **Concurrency.** Two people reviewing the same results, or a result arriving for a book whose cover someone changed in the meantime. A changed cover should never be overwritten silently.

## 7. Rollout (user-approved steps)

1. Merge the ToS PR (migration and function).
2. `db push` and the function deploy, each with Tierra's go-ahead.
3. Merge the library-app PR.
4. Tierra's first real run: the **No cover** filter, a small batch first, then the rest. Check that the cost shown roughly matches the spend.
