# Plan 8 — Read Status per Household Member Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Each household member has a per-book read status (Read or Did not finish, with a finish date). It is filled from a StoryGraph export, from ToS completions and from marks in the app. The library filters to "Unread by me" and the like, Ask respects those filters, and each person sees how much of what the household owns they have read.

**Architecture:**
- **ToS** owns everything server-side: two migrations, security-definer RPCs, and pgTAP.
  - `library.read_statuses` (one row per book and member) is written only through RPCs that apply the spec's "who wins" rules, including `cleared`.
  - `library.reading_history` holds each member's private StoryGraph rows. Matching runs **in SQL**: the upload RPC and a trigger on `library.books` share one matcher, so the "check history on new book" hook covers every add path and the rules live in one place.
  - The **ToS app** gets a small `ReadStatusSync` service. It sends completed shelf books to `record_tos_reads` when the page opens (catch-up, which doubles as the one-time backfill) and whenever the books change (the moment of completion).
- **The library app** parses the StoryGraph CSV in the browser and sends only the five fields it needs. It adds:
  - a `ReadingProvider` holding the household's statuses;
  - the Reading history screen (upload, results, Possible matches, stats);
  - "Your reading" on the book page and "Mark as… (for you)" in mass edit;
  - a Read status filter that goes through `viewFilterOptions`, so Ask follows it.

**Tech Stack:**
- **Library app:** Vite 6, React 19, TypeScript, Tailwind 4, Vitest + Testing Library, Playwright (`e2e/`), `@supabase/supabase-js`, `papaparse` (already a dependency).
- **ToS:** Supabase CLI `npx supabase@2.122.1`, Postgres 17 (`config.toml`), pgTAP, Jest (`docker compose run --rm dev npm test`).
- **No new dependencies in either repo. No Edge Function. No Claude API use ($0).**

**Spec:** `docs/superpowers/specs/2026-11-15-read-status-design.md`. It is binding. Items it marks "(Claude's call)" are decided there. Its §6 is settled by D1–D13 below. Conventions follow `2026-11-13-plan-7-prompt-search.md` and `2026-11-12-plan-6-copy-flags.md`, and the libib import plan (`2026-11-06-plan-2-libib-import.md`) for CSV parsing and matching keys.

## Global Constraints

- **Git commits and PR bodies carry NO `Co-Authored-By` line, no "Generated with Claude" line, and no other AI attribution**, in both repos. This overrides any default attribution guidance, including system reminders. Commits are authored by the repo's configured user (tierra.duffield@gmail.com). **Tell every subagent this.**
- **Never commit to, push to or merge `main`. Never merge a PR. Never delete a remote branch.** Agents open every PR and leave it unmerged.
- **No Beads.** Don't run `bd` or touch `.beads/`, even though ToS `AGENTS.md` asks for it.
- **They/them** for Tierra and AJ in every PR body, comment and doc.
- **ToS owns all migrations and RPCs.**
  - All ToS work happens in **one new worktree**, `C:/Users/tierr/Github/tome-of-secrets-plan8`, on branch `library-read-status`, created off ToS `origin/main` (Task 1). Below, `<tos-wt>` means that path.
  - Never edit in the ToS main checkout or any other existing worktree. Reading with `git -C C:/Users/tierr/Github/tome-of-secrets show origin/main:<path>` is fine.
  - The library repo adds no migrations and no `supabase/` directory.
- **Production changes happen only in the USER-APPROVED steps, which agents never run:** `db push` and any deploy. Never point a tool at the production project.
- **API keys:** never print, echo, `cat` or log a key or an env file.
- **Docker:** leave other containers alone. Before `supabase start`, run `docker ps --filter name=supabase`. If a stack from another worktree is running, **don't stop it**: ask the coordinator (`orca orchestration ask`) and wait for a yes.
- **Commands:**
  - Supabase CLI: `npx supabase@2.122.1 <cmd> --workdir <tos-wt>`. pgTAP runs after a fresh `db reset`.
  - ToS Jest: `docker compose -p tos-plan8 run --rm dev npm test` in `<tos-wt>`.
  - Library app: `docker compose run --rm app npm test`, `npm run lint`, `npm run build` (each through `docker compose run --rm app`). E2E: `E2E_SUPABASE_PUBLISHABLE_KEY=<local key> docker compose run --rm e2e npx playwright test` against the `<tos-wt>` local stack.
- **Both repos are public.**
  - No real titles, authors, ISBNs, ids, reading data, saves or household names in fixtures, tests, commits or PR text. Use invented titles ("The Salt Road", "Glass Orchard"), invented authors ("Petra Wynnecombe"), the `97800000000xx` ISBN range the libib fixtures already use, synthetic uuids, and "Member A" / "Member B".
  - **Never commit or read Tierra's real StoryGraph export.** It is uploaded only by Tierra, in rollout step 3.
  - Logs carry an error name or code only, never titles, authors or dates.
- **ToS code review:** a separate subagent reviews every ToS code diff before its commit (ToS `AGENTS.md`).
- **Reuse, don't fork:**
  - library app: `readAllPages` (`library-repo.ts`), `isMissingFeature` (`covers/cover-repo.ts`), `viewFilterOptions` / `filterView` (`ask.ts`), `localDay` (`date-added.ts`), `MAX_FILE_BYTES` and the Papa setup of `libib/parse.ts`, `readCatalogCache` (`catalog-cache.ts`), the confirm-and-apply flow of `MassEditSheet`, and the page layout of `TagSuggestionsPage`;
  - ToS: `readAllPages`/`_withTimeout`/`toUnavailable`/`logCode` in `LibraryCatalogService.js`, and the `startLibrarySync` shape in `ShelfBookService.js`;
  - the SQL key functions mirror `src/lib/libib/match-keys.ts` and `isbn.ts` rule for rule (D5).
- `localStorage`: this plan adds none.

## Decisions

These settle spec §6 and the brief.

**D1. PR split and order.**

| # | Repo / branch | Contents | Users see after merge |
|---|---|---|---|
| ToS | `library-read-status` | Tasks 1–5 | After the push: ToS completions start landing in `read_statuses` (nothing shows until the library PR) |
| Library | `tshardey/read-status-design` (carries the spec and this plan) | Tasks 6–14 | Reading history, Your reading, Mark as…, the Read status filter, stats |

- **Merge order:** ToS PR → `db push` → library PR → hard-refresh. There is no function deploy: everything is SQL and static JS.
- **Rollback matrix:**
  - library PR live before the push: `ReadingProvider`'s first read gets `42P01`/`PGRST205`, so `available` is false. Every read-status control, the filter, the account-menu link and the summary line are hidden, and the rest works.
  - ToS app live before the push: `record_tos_reads` answers `PGRST202`, and `ReadStatusSync` stops quietly for that page.
  - library PR reverted: statuses keep accumulating from ToS. Nothing else is affected.

**D2. Names, tables and RLS (§6: names and indexes).**
- **`library.read_statuses`:** `book_id uuid, household_id uuid, user_id uuid, status text check (status in ('read','dnf','cleared')), finished_on date null, source text check (source in ('app','storygraph','tos')), marked_at timestamptz not null default now(), set_by uuid null references auth.users on delete set null, created_at, updated_at`.
  - Primary key `(book_id, user_id)`.
  - Foreign key `(book_id, household_id)` → `books (id, household_id)` on delete cascade.
  - Foreign key `(household_id, user_id)` → `household_members` on delete cascade, so a member who leaves takes their statuses.
  - `cleared` rows always have `finished_on` null (a check).
  - `marked_at` is when the status itself was last set: by the app, an upload, a Link or ToS. Filling a date leaves it alone. D3 compares against it.
  - Indexes: `(household_id)`, `(user_id)`, `(set_by) where set_by is not null`.
- **`library.reading_history`:** `id uuid pk, household_id, user_id, sg_key text, title text (1–500), authors text[], isbn13 text null, sg_status text check in ('read','dnf'), last_read date null, title_key text, base_title_key text, author_keys text[], book_id uuid null, match_state text check in ('matched','possible','dismissed','unmatched'), created_at, updated_at`.
  - Unique `(household_id, user_id, sg_key)`.
  - `book_id` references `library.books (id)` `on delete set null`. A `before update` trigger turns `matched` with a null `book_id` back into `unmatched`, so a deleted book frees its rows.
  - Foreign key `(household_id, user_id)` → `household_members` on delete cascade.
  - Indexes: `(household_id, isbn13) where isbn13 is not null`, `(household_id, base_title_key)`, `(book_id) where book_id is not null`, `(user_id)`.
  - **Nothing else from the export is stored** (spec §5.1).
- **`library.reading_history_candidates`:** `history_id uuid references reading_history on delete cascade, book_id uuid references books on delete cascade, household_id, reason text check in ('isbn_title_differs','several_books','title_author_differs','title_prefix'), state text check in ('pending','dismissed') default 'pending', created_at`. Primary key `(history_id, book_id)`. At most 3 candidates per history row.
- **RLS and grants:**
  - `read_statuses`: `select` for household members (`library.is_member(household_id)`).
  - `reading_history`: `select` only where `user_id = auth.uid() and library.is_member(household_id)`.
  - `reading_history_candidates`: `select` only through an `exists` on the caller's own history row.
  - **No client `insert`/`update`/`delete` on any of the three.** Nothing for `anon`.
  - Functions follow the library conventions: security definer, `set search_path = ''`, `revoke execute ... from public, anon`, `grant ... to authenticated`, `42501` for a non-member, `22023` for bad input. Migrations are idempotent like earlier library migrations.

**D3. Write rules: who wins (§5.1, §5.3).** One internal function owns each source's rule. Every rule below is a pgTAP assertion.
- **App** (`set_read_status`): always applies, for `auth.uid()` only. Read sets the date per D9. DNF keeps the row's existing date in keep mode, otherwise the given date (the book page gives none). **Unread stores `cleared`** with no date. Each write sets `source = 'app'`, `marked_at = now()` and `set_by = auth.uid()`.
- **StoryGraph** (`library._apply_history(household, user, book, sg_status, last_read)`, used by upload, auto-link and Link):
  - no row: insert `sg_status` with `finished_on = last_read`, `source = 'storygraph'`;
  - a `storygraph` row: upgrade only (`dnf` → `read`, never back), and set `finished_on` to `last_read` when `last_read` isn't null;
  - an `app` or `tos` row, **including every `cleared` row** (only the app writes `cleared`): never touched.
  - Returns whether it wrote, which feeds the "newly marked" count.
- **ToS** (`record_tos_reads`), per item `{ bookId, completedAt timestamptz|null, finishedOn date|null }`. `completedAt` is clamped to `now()`.
  - no row: insert `read`, `finished_on = finishedOn`, `source = 'tos'`, `marked_at = coalesce(completedAt, now())`;
  - a `read` row of any source: fill `finished_on` only when it is null;
  - a `dnf` or `cleared` row: replace it with `read`/`tos` **only when `completedAt` is not null and `completedAt > marked_at`**. That is spec §5.1 for `cleared`, and newest-wins for DNF (spec §5.3's builder note).
  - Un-completing in ToS sends nothing, so nothing is removed.
- **Per-member only:** no RPC takes a user id. Writes are for `auth.uid()`, and only the definer trigger writes for other members (and only from their own history).

**D4. The "check history on new book" hook is a trigger (§6).**
- `after insert or update of title, authors, isbn13, isbn10 on library.books`, for each row, `when` (on update) any of those four is distinct. It runs `library.match_history_for_book()` (security definer).
- Every add path (manual, scan, photo intake, libib import and re-import) inserts or updates `library.books`, so all are covered with no change to the intake code. A book that gains an ISBN is the update case.
- **Scope:** history rows of **every member** in the book's household whose `match_state` isn't `matched`, prefiltered by `isbn13` in the book's canonical ISBNs or an equal `base_title_key` (or a token prefix, D5). Each prefiltered row goes through the same matcher as the upload (`library._match_history_row(id)`).
  - A clear match sets `book_id` and `matched`, then calls `_apply_history`, which writes nothing over an existing app/tos/cleared row (spec §5.4).
  - An uncertain match adds candidates.
- **A matching failure never blocks a book write:** the body is wrapped in `exception when others then raise warning 'read_history_match_failed %', sqlstate`. *Why:* intake matters more than a missed auto-link, and the next upload re-runs matching.

**D5. Normalisation and the clear/possible line (§6). Bias towards possible.**
- **SQL key functions** (immutable, `search_path = ''`), mirroring `match-keys.ts` and `isbn.ts`:
  - `library.match_norm(text)`: NFD (`normalize(s, NFD)`), strip U+0300–U+036F, lowercase, drop `'’‘`, `&` → ` and `, runs of non-letter/digit → one space, trim.
  - `library.match_title_key(text)`: drop a trailing parenthetical containing `edition` (the libib `EDITION_RE`) **or `#`** (StoryGraph's `(Series, #2)`); then `match_norm`; drop a leading `the`/`a`/`an` when more tokens follow.
  - `library.match_base_title_key(text)`: `match_title_key` of the text before the first `:` or ` - `.
  - `library.match_author_key(text)`: `match_norm`, with runs of single-letter tokens joined (`J. R. Smith` → `jr smith`).
  - `library.match_isbn13(text)`: strip spaces and hyphens; a valid ISBN-13 (978/979, checksum) as is; a valid ISBN-10 converted to 978…; anything else null.
  - `library.book_isbn13s(library.books)`: `isbn13` ∪ converted `isbn10`.
  - An empty key never matches anything.
- **`library._match_history_row(p_id)`**, in order. Pairs this row has dismissed are excluded throughout:
  1. **ISBN:** books whose ISBNs contain the row's `isbn13`. Exactly one, and its `title_key` or `base_title_key` equals the row's or the authors overlap → **clear**. Otherwise each such book is a candidate `isbn_title_differs`.
  2. **Title + first author:** books whose `title_key` or `base_title_key` equals the row's `base_title_key` or `title_key`, and whose author keys include the row's **first** author key. Exactly one → **clear**. Two or more → candidates `several_books`.
  3. **Close:** an equal `base_title_key` with no author overlap → `title_author_differs`. Or one `base_title_key` is a whole-token prefix of the other, the shorter has at least 2 tokens, and the authors overlap → `title_prefix`.
  4. Otherwise **unmatched**.
  - Candidates are capped at 3 per row (ISBN first, then title order).
  - State afterwards: `matched` (`book_id` set), else `possible` when any candidate is pending, else `dismissed` when the row has dismissed candidates and nothing new, else `unmatched`.
  - A `matched` row is never re-matched, except to re-apply its status on re-upload.

**D6. StoryGraph CSV columns (§6).** Built from StoryGraph's commonly documented export headers. **The builder verifies against the synthetic sample only.**
- The synthetic header row (`src/lib/reading/fixtures.ts`): `Title,Authors,Contributors,ISBN/UID,Format,Read Status,Date Added,Last Date Read,Dates Read,Read Count,Moods,Pace,Character- or Plot-Driven?,Strong Character Development?,Loveable Characters?,Diverse Characters?,Flawed Characters?,Star Rating,Review,Content Warnings,Content Warning Description,Tags,Owned?`.
- **Required:** `Title`, `Read Status`. **Used if present:** `Authors`, `ISBN/UID`, `Last Date Read`, `Dates Read`. Headers are matched trimmed and case-insensitively, and a UTF-8 BOM is stripped. Every other column is ignored and never leaves the browser.
- **Mapping:**
  - `Read Status`: `read` → `read`; `did-not-finish` → `dnf`. `to-read`, `currently-reading` and any other value (e.g. `paused`) are **skipped** and counted.
  - `Authors`: split on `,` with `joinNameSuffixes`.
  - `ISBN/UID`: sent raw, trimmed. The server derives `isbn13`.
  - Finish date: `Last Date Read` if it parses (`YYYY/MM/DD` or `YYYY-MM-DD`, a real calendar date). Otherwise the last date-shaped token in `Dates Read`. Otherwise null.
- **Limits:** `MAX_FILE_BYTES` (10 MB) and 20,000 rows. Duplicate rows (the same key, D7) merge in the browser: `read` beats `dnf`, and the later date wins.
- **To verify at rollout (Tierra, no agent):** the real export's header row has the five used columns. If a name differs, the screen says which column is missing, and the fix is a one-line alias in `parseStoryGraph`.

**D7. Re-upload identity and batches.**
- `sg_key`, computed server-side:
  - `isbn:<isbn13>` when `ISBN/UID` normalises to an ISBN;
  - else `uid:<trimmed lowercased ISBN/UID>` when it is present;
  - else `t:<title_key>|<author keys joined by ;>`.
- `upload_reading_history` upserts on `(household_id, user_id, sg_key)`. It updates title, authors, keys, `sg_status` and `last_read`, then runs `_match_history_row` for non-matched rows and `_apply_history` for matched rows (so a newer export upgrades).
- **Rows missing from a newer file are kept,** and no status is ever removed.
- The app sends batches of **500 rows**, one at a time, and sums the counts. A failed batch stops the upload with what finished counted. Re-uploading is safe because the upsert is idempotent.

**D8. ToS completion, catch-up and the backfill (§5.6, §6).**
- **The catch-up is the backfill. No server-side pass over `tos_saves`.**
  - *Why:* the save is reachable (`tos_saves.data -> 'characterState' -> 'books'`), but a SQL pass would be a second reader of the save format with UTC dates. It would add coverage only for players who never open ToS again, and their saves are stale anyway.
  - The first open after rollout sends every completed shelf book with the player's local dates, through the same rule.
  - Rollout step 5 asks Tierra and AJ to open ToS once.
- **`ReadStatusSync`** (new `assets/js/services/ReadStatusSync.js`), started beside `startLibrarySync` in `character-sheet.js`:
  - `completedShelfReads(books)`: ToS books with `status === 'completed'` and a string `libraryBookId`. Each becomes `{ bookId: libraryBookId, completedAt: dateCompleted | null, finishedOn: local YYYY-MM-DD of dateCompleted | null }`, one per `libraryBookId` (latest `completedAt` wins).
  - **On open:** when `getCatalog()` is `ready` with a `householdId`, send all of them, in batches of 500.
  - **On `BOOKS_CHANGED`:** send only items whose signature `bookId|completedAt` isn't in the in-memory `sent` set. That covers `handleMarkComplete` and any other path to `completed`.
  - **On `visibilitychange` to visible:** resend whatever hasn't been sent yet.
  - One call at a time.
  - **Stops for the page** on `42501`, `PGRST202`/`42883` (before the push), `no-household` or `signed-out`. Other errors leave items unsent for the next trigger.
  - Never throws. Logs `[ReadStatus] sync failed: <code>` only.
- **`LibraryCatalogService.recordReads(householdId, items)`** calls `library.rpc('record_tos_reads', …)` under `LIBRARY_WRITE_TIMEOUT_MS`. It does **not** go through `_write`, because it doesn't change the catalogue and mustn't make it stale. Returns `{ outcomes }`; throws a `LibraryUnavailableError` as other calls do.

**D9. Mass-edit date (§6): one optional field.**
- "Mark as… (for you)": `No change` / `Read` / `Did not finish` / `Unread`.
- For Read, an optional `Finish date`:
  - **blank** = keep existing dates, and books without one get today (`p_keep_dates = true`, `p_finished_on = today`);
  - **a date** = that date for every selected book (`p_keep_dates = false`).
- *Why:* the blank default is the spec's call. The explicit date covers "I read this whole series in March" with no extra control.
- Did not finish keeps existing dates. Unread clears.

**D10. Copy, layout and placement (§6).**
- **Account menu:** a `Reading history` link under `Tag suggestions` (shown when `available`). Above the links, a one-line summary `You've read {read} of {owned} ({pct}%)`, computed from `readCatalogCache` and the provider's statuses. It is omitted when there is no cached catalogue or `owned` is 0.
- **Route:** `#/reading` (`{ name: "reading" }`, tab `library`). The page is `ReadingHistoryPage`. Top to bottom:
  1. **Reading:** one block per member, me first, `{displayName}` then:
     - `Read of owned: {read} of {owned}, {pct}%`
     - `Read this year: {n}`
     - `Read since {date}: {n}`, with one shared date input labelled `Since`, blank by default; the line shows only once a date is chosen
     - `Did not finish: {n}`
     - Percentages are rounded to whole numbers; `owned` 0 shows `No books yet`.
  2. **Upload StoryGraph export:**
     - The note `Export your library from StoryGraph, then choose the CSV file here. Only each book's title, authors, ISBN, read status and last date read are sent. Reviews, ratings and everything else stay on this device.`
     - A file input (`accept=".csv,text/csv"`). After parsing: `{n} books read or not finished. {skipped} to-read or currently reading will be skipped.` and `Upload`.
     - While uploading: `Uploading {done} of {total}…`.
     - Result: `{matched} matched books you own ({applied} newly marked)`, `{possible} possible matches to review`, `{unmatched} kept for later, for books not on the shelf yet`, `{skipped} skipped (to-read or currently reading)`.
     - A failed batch: `Upload stopped after {done} of {total}. Try again; nothing is duplicated.`
     - Parse errors: `not_text` `That file isn't a CSV.`; `not_storygraph` `This doesn't look like a StoryGraph export. Missing column: {names}.`; `empty` `That export has no books in it.`; `too_large` `That file is over 10 MB.`; `too_many_rows` `That export has more than 20,000 rows.`; `malformed` `That file couldn't be read as a CSV.`
  3. **Possible matches:** one row per pending candidate. It shows `From StoryGraph: {title} by {authors}` beside the library book's cover, title and authors (linked to `#/book/<id>`), with `Link` and `Not this book`. Empty: `No possible matches to review.`
  4. A footnote: `{n} books from your history aren't on the shelf yet. They link by themselves when added.`
- **Book page** (`YourReadingSection`, under the copies and above `Tome of Secrets`):
  - heading `Your reading`;
  - a three-button group `Unread` / `Read` / `Did not finish` (`aria-pressed`);
  - when Read: `Finished` date input (switching to Read with no date fills today) and `Clear date`;
  - below: one line per other member, `{name}: read ({d MMM yyyy})`, `{name}: read`, `{name}: did not finish` or `{name}: not read`;
  - save error: `Couldn't save your reading.` (`role="alert"`; the control reverts).
- **Filters:** a `Read status` select in `LibraryFilters`: `Any read status` (default), `Unread by me`, `Read by me`, `Did not finish (me)`, then per other member `Unread by {name}`, `Read by {name}`, `Did not finish ({name})`.

**D11. Stats (§5.8): computed in the browser.**
- `readingStats(books, byBook, userId, { today, since })` works from the catalogue the app already holds, so no stats RPC is needed.
- **Owned:** a book with at least one copy where `unhauledAt === null` and (`ownerUserId === userId` or `ownerUserId === null`).
- **Read:** owned and the member's effective status is `read`. `cleared` and `dnf` aren't read.
- **This year:** read with `finished_on` from `${today.year}-01-01` to `today` (local day).
- **Since:** `finished_on >= since`.
- **DNF:** owned with effective `dnf`.

**D12. Filter and Ask (§5.7).**
- `effectiveStatus(row | undefined): "read" | "dnf" | "unread"` is **the one place `cleared` becomes unread** (`src/lib/reading/status.ts`).
- `ReadStatusMap = Map<bookId, Map<userId, "read" | "dnf">>` is built by `toStatusMap(rows)` and never holds `cleared`.
- `LibraryView.readStatus: { userId: string; state: "unread" | "read" | "dnf" } | null`, default null.
- `FilterOptions` gains `readStatus` and `readStatusByBook`.
- `ViewLookups` gains `readStatusByBook`, so `viewFilterOptions` passes it on and **Ask follows the filter with no Ask change**.
- `askBookIds` is refactored to `askBookIds(books, view, lookups: ViewLookups)` so a new lookup can't be forgotten again. Call sites and tests are updated.
- Changing the filter clears Ask results (the existing `update` rule).

**D13. Availability and refresh in the library app.**
- `ReadingProvider` (inside `TaggingProvider` in `App.tsx`) loads `read_statuses` for the household with `readAllPages`.
  - `available` is false on `isMissingFeature` or any first-load error.
  - It reloads on `visibilitychange` to visible, after its own writes, and after an upload, Link or dismiss. No polling: ToS writes show on the next return to the tab.

## Review Focus

Each has a test in the named task.

1. **A book marked Unread in the app (`cleared`)** stays unread through:
   - a re-upload whose row says `read`;
   - the book being re-added or gaining an ISBN;
   - a ToS catch-up for a completion dated **before** the clear.
   A ToS completion dated **after** the clear does mark it read. Filters and stats count it as unread throughout. *(Task 1, Task 2, Task 3 pgTAP; Task 4 Jest; Task 8 Vitest.)*
2. **Two library books with the same title and author** (a paperback and a hardcover entered as separate books, or a reissue), plus a StoryGraph row that matches both: two `several_books` candidates, no status written, and linking one clears the other. *(Task 2, Task 3.)*
3. **A libib import of 300 books into a household with 2,000 history rows:** every insert succeeds. A forced matcher error (a test-only failing key function) still lets the book insert, with a warning. Matching for the batch finishes in seconds. *(Task 3 pgTAP; Task 14 Step 3 timing.)*
4. **A real-world-shaped StoryGraph CSV:** a BOM, CRLF line ends, quoted titles with commas and `"` inside, blank and non-ISBN `ISBN/UID`, `YYYY/MM/DD` dates, a blank `Last Date Read` with `Dates Read` filled, an unknown status, and extra or reordered columns. All parse as D6 says, and no ignored column appears in the payload. *(Task 7.)*
5. **A ToS player who isn't in any household,** or who is signed out, opens the character sheet: no RPC is sent, nothing is logged, and play is unaffected. A member whose library book was deleted gets `not_found` for that item, and the rest land. *(Task 4 Jest; Task 1 pgTAP.)*

---

## ToS PR

### Task 1: ToS — worktree, `read_statuses`, app and ToS write RPCs

**Setup:**
```
git -C C:/Users/tierr/Github/tome-of-secrets fetch origin
git -C C:/Users/tierr/Github/tome-of-secrets worktree add C:/Users/tierr/Github/tome-of-secrets-plan8 -b library-read-status origin/main
```
Load the `supabase:supabase-postgres-best-practices` skill before writing SQL.

**Files:**
- Create: `<tos-wt>/supabase/migrations/<ts>_library-read-status.sql` (`migration new library-read-status`)
- Create: `<tos-wt>/supabase/tests/database/library_read_status.test.sql`

**Interfaces — Produces (SQL):**
```sql
library.read_statuses (...)                                  -- D2
library.set_read_status(p_household uuid, p_book_ids uuid[], p_status text, p_finished_on date, p_keep_dates boolean)
  returns table (book_id uuid, outcome text)   -- p_status 'read'|'dnf'|'unread'; outcome 'changed'|'unchanged'|'not_found'; <= 1000 ids else 22023
library.record_tos_reads(p_household uuid, p_items jsonb)
  returns table (book_id uuid, outcome text)   -- items [{bookId, completedAt, finishedOn}]; 'added'|'dated'|'replaced'|'unchanged'|'not_found'; <= 500 else 22023
library._apply_history(p_household uuid, p_user uuid, p_book uuid, p_sg_status text, p_last_read date) returns boolean
  -- internal (no client execute); Task 2 calls it
```
- `set_read_status` `unchanged` means status, date and source would all stay the same. An id outside the household is `not_found`. Duplicate ids are answered once.
- `record_tos_reads` treats a malformed item (a `bookId` that isn't a uuid, an unparsable date) as `not_found` and still writes the others.

- [ ] **Step 1: Write the failing pgTAP test.** Setup as `library_tagging.test.sql`: A and B in H, C alone in H2, books 1–6 in H, 41 in H2. One assertion each:
  - **App:**
    - A marks 1 read on `2026-03-02`: row `read`/`app`/`set_by` A;
    - again with the same values: `unchanged`;
    - Unread: `cleared` with a null date;
    - DNF on 2 with no date: `dnf`, date null;
    - keep mode on [1 read dated, 3 none] with `today`: 1 keeps its date and 3 gets today;
    - book 41: `not_found`;
    - 1,001 ids: `22023`;
    - C on H: `42501`;
    - `p_status 'cleared'`: `22023`.
  - **No marking for another member:** A's call never writes a row for B. As A, a direct `insert`/`update`/`delete` on `read_statuses` fails.
  - **ToS:**
    - no row: `added` with `source tos` and `marked_at` = `completedAt`;
    - a `read` row with no date: `dated`; with a date: `unchanged`;
    - **`cleared` at T, completion at T−1 day: `unchanged`; at T+1 hour: `replaced` (Review Focus 1);**
    - `dnf` newer than the completion: `unchanged`; older: `replaced`;
    - a future `completedAt` is clamped (replaces nothing marked now);
    - a null `completedAt` never replaces `cleared`;
    - book 41 and a non-uuid id: `not_found` while the other items land (Review Focus 5);
    - 501 items: `22023`.
  - **`_apply_history`:**
    - no row → inserts `storygraph`;
    - a `storygraph` `dnf` + `read` → upgrades;
    - a `storygraph` `read` + `dnf` → unchanged;
    - **an `app` `cleared` row + `read` → unchanged;**
    - a `tos` row → unchanged;
    - `authenticated` can't execute it.
  - **Visibility:** B sees A's rows and C sees none. `anon` selects nothing.
  - **Cascades:** deleting book 2 removes its statuses. Removing B from `household_members` removes B's rows.
- [ ] **Step 2: Run to verify failure.** `docker ps --filter name=supabase` check, `start`, `db reset`, `test db`. Expected: FAIL (relation missing).
- [ ] **Step 3: Write the migration** per D2, D3 and the Interfaces.
- [ ] **Step 4: Verify.**
  - `db reset`, `test db`: all library tests pass.
  - Re-apply the file with `psql -v ON_ERROR_STOP=1 -f`: no error.
  - `db advisors --local`: no new `library` findings.
- [ ] **Step 5: Review and commit.** Subagent review: any path that writes for a user other than the caller, any rule that lets an upload touch `app`/`tos`/`cleared`, and grants. Commit `feat(library): read status per member, app and ToS write rules`.

### Task 2: ToS — reading history, match keys, matcher and upload

**Files:**
- Create: `<tos-wt>/supabase/migrations/<ts>_library-reading-history.sql`, `<tos-wt>/supabase/tests/database/library_reading_history.test.sql`

**Interfaces — Produces (SQL):**
```sql
library.reading_history (...), library.reading_history_candidates (...)        -- D2
library.match_norm(text), match_title_key(text), match_base_title_key(text), match_author_key(text) returns text   -- D5, immutable
library.match_isbn13(text) returns text
library.book_isbn13s(library.books) returns text[]
library._match_history_row(p_id uuid) returns text        -- the new match_state; internal
library.upload_reading_history(p_household uuid, p_rows jsonb)
  returns table (rows int, matched int, applied int, possible int, unmatched int)
  -- p_rows [{title, authors: text[], isbnUid: text|null, status: 'read'|'dnf', lastRead: 'YYYY-MM-DD'|null}], 1..500 else 22023;
  -- for auth.uid() only; counts are the batch's rows by state after the call; applied = _apply_history wrote
```

- [ ] **Step 1: Write the failing pgTAP test.** Same setup. Invented books, e.g. `The Salt Road` (Petra Wynnecombe, isbn13 `9780000000002`), `Glass Orchard: A Novel`, two separate books both titled `Ember Folio` by the same author. One assertion each:
  - **Keys:**
    - `match_title_key('The Salt Road (Edition Deluxe)')` = `salt road`;
    - `match_title_key('Glass Orchard (Lantern Cycle, #2)')` = `glass orchard`;
    - `match_base_title_key('Glass Orchard: A Novel')` = `glass orchard`;
    - `match_author_key('P. J. Wynnecombe')` = `pj wynnecombe`;
    - `match_norm('Café & Crème')` = `cafe and creme`;
    - `match_isbn13('0-00-000000-0')` is the 978 form when the checksum holds, and null for a bad checksum, `B0ABCDEFGH` or blank.
    - **Parity:** every input/output pair in `src/lib/libib/match-keys.test.ts` that has no `#`, copied as a table, gives the same key.
  - **Matching (D5):**
    - an ISBN row → `matched`, and A's `read` is applied with its date;
    - an ISBN row whose title and authors differ from the book → `possible` `isbn_title_differs`, no status;
    - title + first author → `matched`;
    - **the `Ember Folio` row → two `several_books` candidates and no status (Review Focus 2);**
    - the same title by a differently spelled author → `title_author_differs`;
    - `Glass Orchard` vs `Glass Orchard Ledger` with the same author → `title_prefix`;
    - a one-token prefix → nothing;
    - no match → `unmatched`, and C can't see it;
    - a row with an empty title key matches nothing.
  - **Upload rules:**
    - re-uploading the same 3 rows creates no new rows (`sg_key`);
    - a newer `dnf` → `read` upgrade applies, and `read` → `dnf` doesn't;
    - a newer `lastRead` updates the date;
    - **a `cleared` row for A on a matched book stays `cleared` after an upload saying `read` (Review Focus 1);**
    - an `app` `dnf` stays;
    - rows absent from a later upload remain;
    - `to-read` in `status` → `22023`;
    - 501 rows → `22023`;
    - C uploading into H → `42501`.
  - **Privacy:** B can't select A's history or candidates, and B's upload never touches A's statuses. A select of `reading_history` returns only the D2 columns; no review or rating column exists.
  - **Deleted book:** deleting a matched book sets that row to `unmatched` (the `before update` trigger) and removes its candidates.
- [ ] **Step 2: Run to verify failure.** `db reset`, `test db`. Expected: FAIL.
- [ ] **Step 3: Write the migration.** `_match_history_row` follows D5 exactly, skipping dismissed pairs. `upload_reading_history` computes `sg_key` per D7, upserts, then matches or applies.
- [ ] **Step 4: Verify** as Task 1 Step 4.
- [ ] **Step 5: Review and commit.** Subagent review: a clear match the rules call possible, any stored column beyond D2, and RLS on history. Commit `feat(library): private reading history with deterministic matching`.

### Task 3: ToS — the new-book hook, Link and Not this book

**Files:**
- Modify: `<tos-wt>/supabase/migrations/<ts>_library-reading-history.sql` (same unpushed migration)
- Test: `<tos-wt>/supabase/tests/database/library_reading_history.test.sql` (extend)

**Interfaces — Produces (SQL):**
```sql
library.match_history_for_book() returns trigger     -- D4; trigger books_match_reading_history on library.books
library.link_reading_history(p_history uuid, p_book uuid) returns text      -- 'linked'|'not_found'; own row, book in household;
  -- sets book_id + matched, deletes the row's other pending candidates, calls _apply_history
library.dismiss_reading_match(p_history uuid, p_book uuid) returns text     -- 'dismissed'|'not_found'; recomputes match_state
```

- [ ] **Step 1: Write the failing pgTAP tests:**
  - **Hook:**
    - A's unmatched ISBN row, then B inserts a book with that ISBN: the row becomes `matched` and A has `read`/`storygraph` (B's add marks A, from A's own history);
    - adding an ISBN to an existing book by `update` does the same;
    - an uncertain new book adds a candidate;
    - a title-only edit re-runs, and a `synopsis`-only edit doesn't fire;
    - **A has `cleared` on the book: the row links and the status stays `cleared` (Review Focus 1);**
    - B's history and A's are both checked on one insert.
  - **Never blocks a write (Review Focus 3):** inside the test transaction, replace `library.match_title_key` with a function that raises. The book insert still succeeds, and `match_history_for_book` raised a warning, not an error. Restore the function.
  - **Bulk (Review Focus 3):** 2,000 synthetic history rows for A (`generate_series`, invented keys), then a 300-row `insert … select` of books, 30 of them matching. All 300 are inserted and exactly the 30 rows are matched.
  - **Link / Not this book:**
    - Link on one `Ember Folio` candidate → `linked`, the status is applied, and the other candidate is gone;
    - Link on B's row as A → `not_found`;
    - Not this book → `dismissed`, and the row's state is `dismissed` when nothing else is pending;
    - **a dismissed pair is never proposed or clear-matched again,** even after the book gains the row's ISBN;
    - dismissing one of two candidates leaves the row `possible`.
- [ ] **Step 2–4:** run (FAIL), implement, run `db reset` + `test db` + re-apply + advisors (PASS).
- [ ] **Step 5: Review and commit.** Subagent review: add paths the trigger misses (check every `insert into library.books` and `update ... isbn` in ToS `origin/main` migrations and the library app's `library-repo.ts`, `photo/confirm.ts`, `scan/`, `libib/apply.ts`), and trigger cost on bulk import. Commit `feat(library): link reading history when a book is added; possible matches`.

### Task 4: ToS app — completion hook and catch-up

**Files:**
- Create: `<tos-wt>/assets/js/services/ReadStatusSync.js`, `<tos-wt>/tests/readStatusSync.test.js`
- Modify: `<tos-wt>/assets/js/services/LibraryCatalogService.js` (`recordReads`), `<tos-wt>/tests/libraryCatalogService.test.js`
- Modify: `<tos-wt>/assets/js/character-sheet.js` (start the sync beside `startLibrarySync`)

**Interfaces — Produces (JS):**
```js
// LibraryCatalogService
async recordReads(householdId, items)   // -> { outcomes: [{ book_id, outcome }] }; LIBRARY_WRITE_TIMEOUT_MS; not via _write
// ReadStatusSync.js
export const READ_SYNC_BATCH = 500;
export function localDayOf(iso)          // 'YYYY-MM-DD' in the browser's zone, or null for a non-date
export function completedShelfReads(books)   // D8
export function startReadStatusSync(stateAdapter, { service = libraryCatalog, doc } = {})   // -> stop()
```

- [ ] **Step 1: Write the failing Jest tests** (fake service and stateAdapter, as `shelfBookService.test.js`):
  - **`completedShelfReads`:**
    - takes only `completed` books with a `libraryBookId`;
    - a completed book without `dateCompleted` gives `completedAt: null, finishedOn: null`;
    - two records of one library book keep the later completion;
    - `localDayOf('2026-03-02T23:30:00Z')` follows the test's fixed `TZ`.
  - **On open:**
    - one `recordReads` with every item, after `getCatalog` is `ready`;
    - 1,200 items go in 3 calls, one at a time.
  - **On completion:** marking a book complete (emit `BOOKS_CHANGED` after `markBookComplete`) sends only that item. A second `BOOKS_CHANGED` with no new completion sends nothing.
  - **Retry:** a failed call is retried on the next `BOOKS_CHANGED` or on `visibilitychange` to visible.
  - **Stops (Review Focus 5):** `signed-out` and `no-household` catalogues send nothing. `PGRST202` and `42501` stop the sync for the page (later events send nothing). Nothing throws, and `console.warn` gets a code only.
  - **The cleared rule from the client:** the sync always sends `completedAt` unchanged, so the server can apply the rule (asserted on the payload).
  - **`recordReads`:** calls `rpc('record_tos_reads', { p_household, p_items })` on the `library` schema; maps a timeout to `LibraryUnavailableError('timeout')`; doesn't make the catalogue stale.
- [ ] **Step 2: Run** `docker compose -p tos-plan8 run --rm dev npm test -- readStatusSync libraryCatalogService`. Expected: FAIL.
- [ ] **Step 3: Implement** per D8. In `character-sheet.js`, call `startReadStatusSync(stateAdapter)` next to `startLibrarySync(...)`, behind the same configured-library check.
- [ ] **Step 4: Run the full Jest suite.** Expected: PASS, with no change in any existing test.
- [ ] **Step 5: Review and commit.** Subagent review per ToS `AGENTS.md` (patterns, ADR-003, test gaps, logging). Commit `feat(library): ToS completions mark the library book read, with catch-up on open`.

### Task 5: ToS — gates and PR

- [ ] **Step 1:** `db reset`, `test db` (every test), re-apply both migrations, `db advisors --local`, the full Jest suite, and `npm run validate-data` if `AGENTS.md` lists it for this change. All green.
- [ ] **Step 2:** `git diff --name-only origin/main...HEAD` lists only the two migrations, two pgTAP files, `ReadStatusSync.js`, `LibraryCatalogService.js`, `character-sheet.js` and their tests. No `.env`, no CSV, no save file.
- [ ] **Step 3:** Push `library-read-status` and open a PR to ToS `main`, left unmerged. **The body:**
  - D1's table and rollback matrix;
  - that the push needs Tierra's go-ahead and that there is no function deploy;
  - D8's backfill decision;
  - the pgTAP and Jest counts;
  - no AI attribution.

## Library PR

### Task 6: Library — types, status rules and the reading repo

**Files:**
- Create: `src/lib/reading/types.ts`, `src/lib/reading/status.ts`, `src/lib/reading/reading-repo.ts`, tests `status.test.ts`, `reading-repo.test.ts`

**Interfaces — Produces:**
```ts
// types.ts
export type StoredStatus = "read" | "dnf" | "cleared";
export type ReadState = "read" | "dnf" | "unread";
export interface ReadStatusRow { bookId: string; userId: string; status: StoredStatus; finishedOn: string | null;
  source: "app" | "storygraph" | "tos"; markedAt: string }
export type ReadStatusMap = Map<string, Map<string, { state: "read" | "dnf"; finishedOn: string | null }>>;
export interface HistoryUploadRow { title: string; authors: string[]; isbnUid: string | null; status: "read" | "dnf"; lastRead: string | null }
export interface UploadCounts { rows: number; matched: number; applied: number; possible: number; unmatched: number }
export interface PossibleMatch { historyId: string; bookId: string; reason: string; sgTitle: string; sgAuthors: string[] }
// status.ts
export function effectiveStatus(row: ReadStatusRow | undefined): ReadState   // cleared -> unread (D12)
export function toStatusMap(rows: ReadStatusRow[]): ReadStatusMap            // drops cleared
export function stateFor(map: ReadStatusMap, bookId: string, userId: string): ReadState
// reading-repo.ts
export async function listReadStatuses(householdId: string): Promise<ReadStatusRow[]>   // readAllPages, order book_id, user_id
export async function setReadStatus(householdId: string, bookIds: string[], status: ReadState,
  finishedOn: string | null, keepDates: boolean): Promise<{ bookId: string; outcome: string }[]>   // chunks of 1000
export async function uploadHistoryBatch(householdId: string, rows: HistoryUploadRow[]): Promise<UploadCounts>   // one RPC, <= 500
export async function listPossibleMatches(): Promise<PossibleMatch[]>      // pending candidates joined to own history (RLS)
export async function countUnmatchedHistory(householdId: string): Promise<number>
export async function linkHistory(historyId: string, bookId: string): Promise<"linked" | "not_found">
export async function dismissMatch(historyId: string, bookId: string): Promise<"dismissed" | "not_found">
```
- [ ] **Step 1: Failing tests:**
  - `effectiveStatus` of `cleared` is `unread`, of undefined is `unread`;
  - `toStatusMap` drops a `cleared` row;
  - `stateFor` for a missing member is `unread`;
  - repo tests mock `supabase` as `library-repo.test.ts` does: `setReadStatus` with 1,500 ids makes 2 RPC calls with `p_status`/`p_finished_on`/`p_keep_dates`; `"unread"` is sent as `unread`; `uploadHistoryBatch` sends exactly the five fields per row (no other key) and maps the counts; an RPC error rejects; `listReadStatuses` pages.
- [ ] **Step 2–4:** run `npm test -- src/lib/reading` (FAIL), implement, run (PASS).
- [ ] **Step 5: Commit** `feat: read status types, the cleared rule and the reading repo`.

### Task 7: Library — StoryGraph CSV parser and synthetic fixtures

**Files:**
- Create: `src/lib/reading/storygraph.ts`, `src/lib/reading/storygraph.test.ts`, `src/lib/reading/fixtures.ts`

**Interfaces — Produces:**
```ts
export const MAX_HISTORY_ROWS = 20_000;
export type StoryGraphErrorCode = "not_text" | "not_storygraph" | "empty" | "malformed" | "too_large" | "too_many_rows";
export class StoryGraphFileError extends Error { code: StoryGraphErrorCode; missing: string[] }
export interface ParsedHistory { rows: HistoryUploadRow[]; skipped: number }
export function parseStoryGraph(text: string): ParsedHistory        // D6; throws StoryGraphFileError
export async function readStoryGraphFile(file: File): Promise<ParsedHistory>   // size check, then text, then parse
export function parseSgDate(s: string): string | null              // 'YYYY/MM/DD' | 'YYYY-MM-DD' -> 'YYYY-MM-DD'; invalid -> null
// fixtures.ts
export const SG_HEADER: string;          // D6's header row
export function sgCsv(rows: Partial<Record<string, string>>[], opts?: { bom?: boolean; crlf?: boolean; header?: string }): string
```
- [ ] **Step 1: Failing tests** (all invented rows via `sgCsv`):
  - **Mapping:** `read` and `did-not-finish` map; `to-read`, `currently-reading` and `paused` are counted in `skipped`. Authors `Petra Wynnecombe, Oren Vale Jr.` → 2 names with the suffix kept. A blank `ISBN/UID` → null.
  - **Review Focus 4:**
    - a BOM plus CRLF parses;
    - the title `Salt, Smoke "and" Glass` round-trips;
    - a header with columns reordered and two extras parses;
    - `Last Date Read` `2026/02/30` → null;
    - a blank `Last Date Read` with `Dates Read` `2025/01/03-2025/01/20, 2026/03/01-2026/03/09` → `2026-03-09`;
    - **the returned rows have exactly the five keys** (no `Review`, `Star Rating`, `Tags`, … even when filled).
  - **Merging:** two rows with the same ISBN, `dnf` then `read`, merge to one `read` with the later date.
  - **Errors:**
    - a libib CSV gives `not_storygraph` with `missing` `["Read Status"]`;
    - a header-only file gives `empty`;
    - an 11 MB file gives `too_large` before it is read;
    - 20,001 rows give `too_many_rows`;
    - a binary blob gives `not_text`.
- [ ] **Step 2–4:** run `npm test -- src/lib/reading/storygraph`, implement (Papa as in `libib/parse.ts`, `header: true`, `skipEmptyLines: "greedy"`, a `transformHeader` trim), run.
- [ ] **Step 5: Commit** `feat: parse StoryGraph exports in the browser, keeping only five fields`.

### Task 8: Library — stats, the Read status filter, the view and Ask

**Files:**
- Create: `src/lib/reading/stats.ts`, `stats.test.ts`
- Modify: `src/lib/filter-books.ts`, `src/lib/library-view.ts`, `src/lib/ask.ts` and their tests; `src/components/library/LibraryPage.tsx` (the `askBookIds` call site only)

**Interfaces — Produces:**
```ts
// stats.ts
export interface ReadingStats { owned: number; read: number; pct: number; readThisYear: number; readSince: number | null; dnf: number }
export function ownsBook(book: BookWithCopies, userId: string): boolean        // D11
export function readingStats(books: BookWithCopies[], map: ReadStatusMap, userId: string,
  opts: { today: string; since: string | null }): ReadingStats                   // today/since 'YYYY-MM-DD'
// filter-books.ts — FilterOptions gains
readStatus?: { userId: string; state: ReadState } | null;
readStatusByBook?: ReadStatusMap;
// library-view.ts — LibraryView gains readStatus: { userId: string; state: ReadState } | null (DEFAULT null)
// ask.ts — ViewLookups gains readStatusByBook: ReadStatusMap; askBookIds(books, view, lookups: ViewLookups): string[]
```
- [ ] **Step 1: Failing tests:**
  - **Stats:**
    - owned counts a member's and Shared copies, not another member's only, and not a book whose only copies are unhauled;
    - `142 of 205` gives `pct` 69;
    - DNF isn't read;
    - **a `cleared` row isn't read (built through `toStatusMap`, Review Focus 1);**
    - this year counts `${year}-01-01` through today only;
    - `since` null gives `readSince` null;
    - a read book with no date counts in `read` only;
    - an unowned read book counts nowhere.
  - **Filter:**
    - `Unread by me` keeps books with no status and **books with a `cleared` row**, and drops my `read` and my `dnf`;
    - `Read by me` and `Did not finish (me)` keep only those;
    - `Unread by B` uses B's map;
    - with no `readStatusByBook` and a filter set, every book counts as unread;
    - unhauled books stay hidden as before.
  - **View and Ask:**
    - `update({ readStatus })` clears `ask`;
    - **`askBookIds` with `readStatus` `Unread by me` and text in the box returns only my unread on-shelf books** (the Plan 7 Review Focus 1 test extended);
    - every existing `ask.test.ts` and `filter-books.test.ts` case passes with the new signature.
- [ ] **Step 2–4:** run `npm test -- src/lib`, implement, run.
- [ ] **Step 5: Commit** `feat: reading stats and a read status filter that Ask follows`.

### Task 9: Library — `ReadingProvider`, route and account menu

**Files:**
- Create: `src/contexts/ReadingContext.tsx`, `ReadingContext.test.tsx`; `src/components/reading/ReadingHistoryPage.tsx` (stub until Task 13)
- Modify: `src/lib/router.ts` (+ test), `src/App.tsx` (+ `App.test.tsx`), `src/components/nav/AccountMenu.tsx`

**Interfaces — Produces:**
```ts
export interface ReadingState {
  available: boolean; loading: boolean;
  rows: ReadStatusRow[]; byBook: ReadStatusMap; userId: string | null;
  setStatus(bookIds: string[], state: ReadState, finishedOn: string | null, keepDates: boolean): Promise<void>;  // reloads after
  reload(): Promise<void>;
}
export function ReadingProvider(props: { children: ReactNode; deps?: Partial<ReadingDeps> }): JSX.Element
export function useReading(): ReadingState     // outside a provider: UNAVAILABLE_READING, never throws
```
- [ ] **Step 1: Failing tests:**
  - **Provider:**
    - `PGRST205` on first load gives `available` false and nothing else breaks;
    - it reloads on `visibilitychange` to visible;
    - `setStatus` calls the repo once and reloads;
    - a double call while one is running is ignored.
  - **App:** signed out, the provider isn't mounted.
  - **Router:** `#/reading` round-trips with tab `library`.
  - **Account menu:**
    - with `available` it shows `Reading history` and `You've read 2 of 3 (67%)` (from a seeded catalogue cache);
    - no cache: no summary line;
    - unavailable: neither shows.
- [ ] **Step 2–4:** run `npm test -- src/contexts src/lib/router src/App src/components/nav`, implement, run.
- [ ] **Step 5: Commit** `feat: reading provider, the Reading history route and the account menu summary`.

### Task 10: Library — "Your reading" on the book page

**Files:**
- Create: `src/components/reading/YourReadingSection.tsx`, test
- Modify: `src/components/book/BookDetail.tsx` (render when `available`)

**Interfaces:** `YourReadingSection({ bookId }: { bookId: string })`, using `useReading()` and `useHousehold().members`.
- Writes: Unread → `setStatus([id], "unread", null, false)`; Read → `("read", date, false)`; DNF → `("dnf", null, false)`; a date change → `("read", newDate, false)`; Clear date → `("read", null, false)`.
- [ ] **Step 1: Failing tests:**
  - the button matching the current state is pressed, and `cleared` shows Unread pressed;
  - Read from unread sends today's local day;
  - changing the date sends that date;
  - Clear date sends null;
  - Unread sends `unread`;
  - other members' lines read `Member B: read (2 Mar 2026)`, `Member B: not read` (for `cleared` too) and `Member B: did not finish`;
  - there is no control for another member;
  - a failed save shows `Couldn't save your reading.` and reverts;
  - with `available` false nothing renders, and the existing `BookDetail` tests stay green.
- [ ] **Step 2–4:** run `npm test -- src/components/reading src/components/book`, implement, run.
- [ ] **Step 5: Commit** `feat: mark your own reading on the book page`.

### Task 11: Library — the Read status filter on the library page

**Files:**
- Modify: `src/components/library/LibraryFilters.tsx` (prop `readStatusFilter?: { options: { value: string; label: string }[]; value: string; onChange(v: string): void }`), `src/components/library/LibraryPage.tsx`; tests `LibraryPage.test.tsx`, `LibraryPage.ask.test.tsx`
- Create: `src/lib/reading/filter-options.ts` (`readStatusOptions(members, me): { value, label, readStatus }[]`, D10 labels and order), test

- [ ] **Step 1: Failing tests:**
  - options are D10's, in order, "me" first, with one block per other member;
  - choosing `Unread by me` narrows the wall and the count;
  - **pressing Ask with that filter sends only those ids;**
  - choosing it clears shown Ask results;
  - with reading unavailable no select renders and `readStatus` stays null;
  - every existing `LibraryPage` test stays green.
- [ ] **Step 2–4:** run `npm test -- src/components/library src/lib/reading`, implement (`LibraryPage` passes `readStatusByBook: useReading().byBook` into its `ViewLookups`), run.
- [ ] **Step 5: Commit** `feat: read status filter on the library page`.

### Task 12: Library — "Mark as… (for you)" in mass edit

**Files:**
- Modify: `src/lib/mass-edit.ts`, `src/components/library/MassEditSheet.tsx`
- Create: `src/components/library/MassEditSheet.reading.test.tsx`; extend `mass-edit.test.ts`

**Interfaces — Produces:**
```ts
// MassEdit gains: markAs?: { state: ReadState; finishedOn: string | null }   // D9; finishedOn only for read
export interface ReadChange { book: Book; from: ReadState; to: ReadState }
// ChangeSet gains reads: ReadChange[]; keepDates: boolean; readDate: string | null
// buildChangeSet(books, targets, edit, labels, now, libraryTagsByBook = new Map(), readMap: ReadStatusMap = new Map(), me: string | null = null, today = "")
//   includes a target book when its state would change, or (explicit date) its date would change; blank-date Read skips books already read
// MassEditWriters gains setReadStatus?(bookIds: string[], state: ReadState, finishedOn: string | null, keepDates: boolean): Promise<void>
// MassEditResult gains changedReadBooks: number; failedReads: ReadChange[]   // a failed chunk fails all its books
// describeCounts(copies, books, tagBooks = 0, readBooks = 0): "... and 3 books marked"
```
- [ ] **Step 1: Failing tests:**
  - **Change set:**
    - Read with a blank date over [unread, read-dated, dnf] includes 2 books with `keepDates` true and `readDate` today;
    - an explicit date includes the read-dated book whose date differs;
    - Unread over [read, cleared] includes only the read one (**cleared is already unread**);
    - books outside `targets.bookIds` are ignored.
  - **Apply:** one `setReadStatus` call per 1,000 books; a rejected call puts those books in `failedReads`; `retryTargets` includes them; the summary reads `1 copy and 2 books marked`.
  - **Sheet:**
    - the field reads `Mark as… (for you)` with D9's options;
    - the date input appears only for Read, with the D9 hint `Blank keeps existing dates; books without one get today.`;
    - confirm lists the read changes;
    - only the read field set means no copy writes;
    - with reading unavailable the field doesn't render;
    - the existing `MassEditSheet` tests stay green.
- [ ] **Step 2–4:** run `npm test -- src/lib/mass-edit src/components/library`, implement, run.
- [ ] **Step 5: Commit** `feat: mark selected books read, not finished or unread for yourself`.

### Task 13: Library — the Reading history screen

**Files:**
- Create: `src/components/reading/ReadingHistoryPage.tsx` (replacing the stub), `ReadingStatsPanel.tsx`, `HistoryUpload.tsx`, `PossibleMatches.tsx`, tests (`ReadingHistoryPage.test.tsx`)

**Interfaces:**
- `HistoryUpload({ householdId, onDone(counts) })`: `readStoryGraphFile` then batches of 500 through `uploadHistoryBatch`, one at a time, summing the counts. Then `reload()` and a refresh of the Possible matches.
- `PossibleMatches({ books })`: `listPossibleMatches`, rows per D10, with Link/Not this book.
- `ReadingStatsPanel({ books, byBook, members, me })`: `readingStats` per member, me first.

- [ ] **Step 1: Failing tests** (the repo mocked, synthetic CSVs from `sgCsv`):
  - **Stats:**
    - the panel shows `Read of owned: 2 of 3, 67%` and `Read this year`;
    - choosing `Since` shows that line;
    - `cleared` rows don't count;
    - `owned` 0 shows `No books yet`.
  - **Upload:**
    - choosing a 1,200-row file shows `1200 books read or not finished. 3 to-read or currently reading will be skipped.`;
    - `Upload` makes 3 calls in order with `Uploading … of 1200…`, then the four result lines with summed counts;
    - **the payload rows carry only the five fields;**
    - a failure on batch 2 shows `Upload stopped after 500 of 1200…`;
    - each parse error shows its D10 copy;
    - a double tap uploads once.
  - **Possible matches:**
    - rows show the StoryGraph title and author beside the book;
    - Link calls `linkHistory` and the row leaves;
    - Not this book calls `dismissMatch`;
    - a candidate whose book isn't in the catalogue is skipped;
    - empty shows `No possible matches to review.`;
    - the footnote shows the unmatched count.
  - **Unavailable:** the page shows `Reading history isn't available yet.`
- [ ] **Step 2–4:** run `npm test -- src/components/reading`, implement, run.
- [ ] **Step 5: Commit** `feat: Reading history screen with StoryGraph upload, possible matches and stats`.

### Task 14: Library — e2e, local walkthrough, docs and the library PR

**Setup (local only):** the `<tos-wt>` stack after `db reset` (its migrations include Tasks 1–3), and the app on `.env.local` for that stack. Members A and B in one household, each in their own browser profile, about 15 invented books. Synthetic CSVs are written to the scratchpad from `sgCsv` and deleted afterwards.

- [ ] **Step 1: E2E** `e2e/reading-history.spec.ts`, using `newUserWithHousehold` and `insert`:
  - A uploads a synthetic CSV: 2 matched, 1 possible, 2 kept for later, 1 skipped;
  - A links the possible match;
  - A marks one book Unread on its page, re-uploads the same file, and the book stays Unread;
  - `Unread by me` shows exactly the expected titles, and Ask's request body (intercepted with `page.route`) holds exactly those ids;
  - inserting a book that matches a kept-for-later row (REST insert) marks it read after a reload;
  - mass edit marks 3 books read for A, and B's page shows `Member A: read`.
  - Run with the E2E command in Global Constraints. Expected: PASS, with the existing specs green.
- [ ] **Step 2: ToS on the same stack.** Serve `<tos-wt>` locally (its documented dev command) against the local stack. As A, link a ToS book to a library book and mark it complete: the library book page shows Read with that day after returning to the tab. Clear it in the library, reopen ToS: it stays Unread. Mark a second book complete while the library RPC is blocked (DevTools offline), then come back online and return to the tab: it lands.
- [ ] **Step 3: Bulk timing (Review Focus 3).** In Studio SQL as A, insert 2,000 synthetic history rows, then run a 300-book libib import of a synthetic file through the app. It finishes and the time is within a few seconds of the same import on a stack without history. Record both times.
- [ ] **Step 4: Phone width** at 390 px: the Reading history screen, the book page control, the filter select and the mass-edit row are usable, and footers don't cover content.
- [ ] **Step 5: Not set up.** Point the app at a stack reset to ToS `origin/main`: no reading UI, and everything else works.
- [ ] **Step 6: Gates and privacy.** `npm test`, `npm run lint`, `npm run build`, e2e. `git diff --name-only origin/main...HEAD` lists no `.env` and no `.csv`.
- [ ] **Step 7: README, commit, PR.**
  - The README gains a `Reading status` section: what each source does, that Unread sticks, that StoryGraph rows for books you don't own stay private and hidden, how to upload, and Possible matches. Commit `docs: reading status usage`.
  - Push `HEAD:tshardey/read-status-design` and open a PR to `main`, left unmerged.
  - **The body says** the ToS PR and its push must land first (until then the new UI stays hidden, D1), and lists the walkthrough results and timings. No AI attribution.

### Task 15: Whole-scope review (most capable model)

- [ ] **Step 1:** Dispatch one fresh reviewer on the most capable model available (`model: "fable"` on the Agent tool, i.e. `claude-fable-5-1`). Give it the spec, this plan, the ToS PR diff and the library PR diff. It checks:
  - every spec requirement against D1–D13, and Review Focus 1–5;
  - the anti-goals: an unowned book leaking into the library, search or counts; an upload overriding an app mark; a wrong automatic match; marking for someone else;
  - the `cleared` rule at every layer: upload, auto-link, ToS catch-up, filters, stats;
  - every book add path hitting the trigger;
  - RLS, grants and definer functions;
  - that no StoryGraph column beyond the five leaves the browser;
  - public-repo hygiene, and no AI attribution in any commit or PR text.
- [ ] **Step 2:** Fix confirmed findings in the owning repo, each as its own commit (ToS fixes reviewed by a subagent per ToS `AGENTS.md`). Rerun that repo's gates and push. Record findings and outcomes in each PR body.

---

## USER-APPROVED STEP: production rollout (spec §7)

**Agents don't run any of this without Tierra's explicit go-ahead at that moment.** Approval of this plan isn't approval of these steps.

1. **Tierra merges the ToS PR** (`library-read-status`).
2. **`db push`, with Tierra's go-ahead,** from a fresh push worktree at the merged `main`, using the recipe in earlier plans:
   - `worktree add --detach`, `link --project-ref`, `db push --dry-run`;
   - confirm the only pending migrations are `..._library-read-status` and `..._library-reading-history`;
   - push, then remove the push worktree.
   - No function deploy is needed. ToS's Pages build ships `ReadStatusSync.js` on merge.
3. **Tierra merges the library PR,** then hard-refreshes (GitHub Pages caches JS for about 10 minutes).
4. **Tierra exports from StoryGraph and uploads the file** on Reading history, then reviews Possible matches. If the screen reports a missing column, report the header names (not the data) for a one-line alias fix.
5. **Tierra and AJ each open ToS once**, so the catch-up records past completions (D8).
6. **AJ marks his books from memory** with mass edit.

## User checks after rollout

1. `Unread by me` plus Ask gives only owned books you haven't read or abandoned.
2. A book you set to Unread stays Unread after you upload a newer StoryGraph export.
3. Adding a book you'd read in StoryGraph marks it read without any linking.
4. Finishing a shelf book in ToS shows it read in the library, with ToS's date.
5. The Reading numbers look right for both of you, and books you don't own appear nowhere.

## Follow-ups (not built)

1. A "kept for later" list (your unmatched history) with a manual link, if Possible matches proves too strict.
2. A read badge on wall cards.
3. Re-read counts and dates from `Dates Read` (spec non-goal for now).

## Open questions for the coordinator

1. **The StoryGraph header row.** The plan builds from the commonly documented columns and needs only five of them (D6). Could Tierra paste just their export's **header line** (no data rows) so the builder can confirm the names before Task 7? **Default if unanswered:** build from D6. A mismatch then shows at rollout step 4 as a named missing column and gets a one-line fix.
