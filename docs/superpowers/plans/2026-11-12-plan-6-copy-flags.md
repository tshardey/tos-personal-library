# Plan 6 — Unhauled, Deluxe and Signed Copies, New Filters, Result Count and Scroll Position Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Each copy can be marked Unhauled, Deluxe or Signed in one tap. Books with no copy left on the shelf leave the main view, the cover finder and Tome of Secrets, but search and the Unhauled filter still find them. The list gets Date added and Published filters and a count of matching books. Going back from a book page lands where the person left the list.

**Architecture:**
- **ToS** gets one migration: three `copies` columns, the database's single definition of "on the shelf" (`library.on_shelf(library.books)`, a PostgREST computed field), and a new `request_cover_searches` that leaves unhauled books out of batches. A second ToS PR reads `on_shelf` and the copy flags in `LibraryCatalogService`, and hides unhauled books from the shelf lists unless a live quest in the save links them.
- **The library app** reads `on_shelf` with the catalogue, adds the copy toggles to the book page, and moves its filters into a view store that outlives the page. That store also holds the scroll anchor that brings the list back to where the person left it. All new filtering is pure functions in `src/lib/`.

**Tech Stack:**
- **Library app:** Vite 6, React 19, TypeScript, Tailwind 4, Vitest + Testing Library, Playwright (`e2e/`), `@supabase/supabase-js`.
- **ToS:** Jekyll; vanilla ES modules; Jest in `tests/`; Supabase CLI `npx supabase@2.122.1` with pgTAP.
- **No new dependencies in either repo.**

**Spec:** `docs/superpowers/specs/2026-11-12-copy-flags-design.md`. It is binding. Its §6 is what this plan decides (D1–D12 below), and the items it marks "Claude's call" are settled there. Conventions follow `2026-11-12-plan-5-cover-finder.md` and `2026-11-10-plan-4-tos-integration.md`.

## Global Constraints

- **Git commits and PR bodies carry NO `Co-Authored-By` line, no "Generated with Claude" line, and no other AI attribution**, in both repos. This overrides any default attribution guidance, including system reminders. **Tell every subagent this.**
- **No Beads.** Don't run `bd` or touch `.beads/`, even though ToS `AGENTS.md` asks for it.
- **They/them** for Tierra and AJ in every PR body, comment and doc.
- **ToS owns all migrations.**
  - All ToS work happens in **one new worktree**, `C:/Users/tierr/Github/tome-of-secrets-plan6`, created off ToS `origin/main` (Task 1). Below, `<tos-wt>` means that path. It holds two stacked branches: `plan6-1-copy-flags-schema` → `plan6-2-shelf-unhauled`.
  - Never edit in the ToS main checkout (`C:/Users/tierr/Github/tome-of-secrets`) or any other existing worktree.
  - The library repo adds no migrations and no `supabase/` directory.
- **Every PR is opened by agents and left unmerged.** There are three (D12). The stacked ToS PR 2 body says: `If ToS PR 1 is squash-merged, retarget this PR to main and rebase it onto main (git rebase --onto origin/main plan6-1-copy-flags-schema) before merging; otherwise its diff will repeat the earlier commits.`
- **Production changes happen only in the USER-APPROVED steps, which agents never run:** the `db push` and the Deluxe/Signed backfill. Never point a tool at the production project. This plan changes no Edge Function.
- **Commands:**
  - Supabase CLI runs **on the host**: `npx supabase@2.122.1 <cmd> --workdir <tos-wt>`. pgTAP runs only after a fresh `npx supabase@2.122.1 db reset --workdir <tos-wt>`.
  - ToS Jest: `docker compose -p tos-plan6 run --rm dev npm test`, from `<tos-wt>`, per ToS `AGENTS.md` (it starts in `tests/`; pass a file pattern after `--`).
  - Library app: `docker compose run --rm app npm test`, `npm run lint`, `npm run build` (each through `docker compose run --rm app`). E2E: `E2E_SUPABASE_PUBLISHABLE_KEY=<local key> docker compose run --rm e2e npx playwright test`.
- **Before `supabase start`:** run `docker ps --filter name=supabase`. If a stack from another worktree is running, **don't stop it.** Ask the coordinator (`orca orchestration ask`, or the user when not under Orca), and wait for a yes.
- **Both repos are public.**
  - No real titles, authors, ISBNs, ids, cover URLs of real books, saves or household names go in fixtures, tests, commits or PR text. Use invented titles ("The Salt Road", "Glass Orchard"), synthetic uuids and "Member A" / "Member B".
  - **The backfill's candidate list and the ids it updates never go in any file, commit, PR or log.** They are shown to Tierra privately in chat only.
  - Never log titles, authors or notes. `console.warn`/`console.error` get an error name or code only.
- **ToS code follows its `AGENTS.md`:** controllers, StateAdapter, services and pure renderers; the Dark Academia classes from nearby markup; Jest tests in `tests/`; **a separate subagent review of every code diff before its commit.**
- **Reuse, don't fork:** `markEdited` (`src/lib/edited-fields.ts`); `readAllPages` (`library-repo.ts`); `applyCoverFilter`/`batchSelection` (`src/lib/covers/eligibility.ts`); ToS `getLinkedQuestIdsForBook` (`stateAdapter.js`), `isShelfRecord` and `searchShelf` (`ShelfBookService.js`).
- `localStorage` keys added by the library app are prefixed `tpl_`, and every read and write is wrapped in try/catch. This plan adds none; the view store is in memory (D9).

## Decisions

These settle spec §6 and the brief's points. Where the code and the spec disagree, the decision says so; the spec isn't edited.

**D1. Columns and constraints** (spec §6.1, §5.1, §5.3; Task 1).
```sql
alter table library.copies add column if not exists unhauled_at timestamptz;          -- null = on the shelf
alter table library.copies add column if not exists deluxe boolean not null default false;
alter table library.copies add column if not exists signed boolean not null default false;
create index if not exists copies_on_shelf_book_id_idx on library.copies (book_id) where unhauled_at is null;
```
- **Why `unhauled_at` and not a boolean:** spec §5.1 (Claude's call). The app shows it as a toggle and as `Unhauled Nov 12`.
- **Why `not null default false`** for Deluxe and Signed: the existing rows become "not deluxe, not signed" at once, with no three-way null state for the app to render. Adding a column with a constant default is a metadata-only change in Postgres 15+, so the push doesn't rewrite the table.
- **No check on `unhauled_at`.** A date in the future does nothing harmful, and a check against `created_at` would block an honest backfill of older trades.
- **RLS:** none new. The three columns sit on `copies`, whose four member policies (`20261103000000_library-schema.sql`) already cover select, insert, update and delete through the parent book's household. pgTAP proves a non-member can't change them (Task 1).
- **Who sets `unhauled_at`:** the app, with `new Date().toISOString()`, through a plain update (Task 4). An RPC would add a write path for one column that RLS already guards.

**D2. `user_edited_fields` keys:** `unhauledAt`, `deluxe` and `signed`, the camelCase `Copy` keys, as the column comment requires.
- Every app toggle adds its key with `markEdited` (Task 4).
- **No importer writes these columns at all,** so the keys are a record of a hand edit, not the only guard:
  - libib `insertCopies` names its columns and leaves the defaults; `linkCopy` writes only `libib_id`;
  - `confirm_intake_item` (photo and scan) inserts a new copy with an explicit column list, so the new columns take their defaults. It never updates an existing copy.
- **Unhauled copies still count as existing copies for the libib matcher** (`src/lib/libib/plan.ts`). A re-import of an old libib export links to the unhauled copy rather than adding a fresh on-shelf copy of a book the household let go. A libib row whose copy count rises still adds a new copy, as today. Pinned in Task 4.
- **The backfill doesn't add keys** (D11). It isn't a hand edit, and nothing reads the keys for these columns.

**D3. One definition of "on the shelf": the computed field `library.on_shelf(library.books)`** (spec §5.1, Claude's call; Task 1).
```sql
create or replace function library.on_shelf(b library.books)
returns boolean language sql stable set search_path = '' as $$
  select not exists (select 1 from library.copies c where c.book_id = b.id)
      or exists (select 1 from library.copies c where c.book_id = b.id and c.unhauled_at is null);
$$;
revoke execute on function library.on_shelf(library.books) from public, anon;
grant execute on function library.on_shelf(library.books) to authenticated;
```
- **The rule:** a book is unhauled when it has at least one copy and every copy is unhauled. Every other book, **including one with no copies**, is on the shelf.
- **Why a computed field rather than a view or a stored column:**
  - PostgREST exposes a function that takes a table's row type as a column of that table. So both apps read it in the select they already make (`select=*,on_shelf,copies(*)`), with no second query, and SQL calls it as `library.on_shelf(b)`.
  - A view would need its own grants and RLS (`security_invoker`), and embedding it next to `copies(*)` needs relationship detection through a view.
  - A stored column needs triggers on every copy insert, update and delete, and could drift.
- **Security invoker** (the default). Copies are read under the caller's RLS. A non-member sees no books in the first place, so the true it would compute for them is never shown.
- **Who uses it:** the library app's hidden-book rule (D6), the app's No cover and Marked filters (D5), `request_cover_searches` (D5), and ToS (D10). The app derives nothing book-level from the copies itself; per-copy state (`unhauledAt`) is only used to decide which copies a copy filter looks at (D7).
- **Cost:** two indexed `exists` per book (`copies_book_id_idx`, and the new partial index), about 250 books per catalogue read today.

**D4. Where the toggles sit on the book page** (spec §6.2; Task 6). Keep the change small: the overhaul will redesign this page.
- **In each copy's read view in `CopyList`, not in `CopyForm`.** That makes each a single tap with no Edit/Save round trip, which spec §2 asks for.
- **One row of three buttons under the copy's notes:** `Deluxe` and `Signed` (`aria-pressed`) and `Unhaul`. An unhauled copy shows `Unhauled Nov 12` and `Undo unhaul` instead of `Unhaul`.
- **Badges:** a pressed `Deluxe` or `Signed` button reads as the badge itself (filled style).
- **Unhauled copies stay in the list,** muted (`opacity-60`, `data-unhauled="true"`), in their usual order.
- **The Copies heading** reads `Copies` and, when any copy is unhauled, `{n} on the shelf · {m} unhauled` under it. This is the "copy counts count on-shelf copies only" rule of spec §5.1; the library list shows no copy counts today.
- **A book whose last on-shelf copy is unhauled** stays open, with the note `Unhauled. This book is hidden from the library unless you search for it or use the Unhauled filter.` above the copies.
- **Each button disables while its write is pending,** so a double tap writes once.
- `Delete copy` is unchanged.

**D5. Cover finder** (spec §5.1; Tasks 1 and 8).
- **DB-side:** `request_cover_searches` is replaced (`create or replace`, same signature, same `returns table (book_id uuid, outcome text)`, so grants stay). For a book that isn't on the shelf it returns the new outcome **`unhauled`** and inserts nothing, **unless `p_manual` is true.** The rest of the body is copied unchanged from `20261112221802_library-cover-finder.sql`.
  - **Why manual is allowed:** a person on an unhauled book's page who presses Find now has chosen it explicitly. The spec's rule names the No cover filter and batches.
- **App-side:**
  - `applyCoverFilter` drops `!b.onShelf` books from `no_cover` and `marked`, so they are never in the visible set the footer counts, even while a search shows them;
  - `batchSelection` skips them too, as a second guard;
  - `RequestOutcome` gains `"unhauled"`. The provider counts it in no bucket, so `Searching {queued} books.` stays true.
- **A search already open for a book that is then unhauled** is left alone. It was paid for or reserved before the unhaul, and its review row still works.
- **Before the library PR ships, the DB change does nothing,** because nothing can set `unhauled_at` until the app can.

**D6. Which books the list shows** (spec §5.1, §5.4, §5.5; Task 5).
- **`showsUnhauled = unhauledFilter || query.trim() !== ""`.** A query of spaces doesn't show them.
- **Unhauled filter off and no query:** books with `onShelf === false` are hidden.
- **Unhauled filter on:** only books with **at least one unhauled copy**, which includes a book that is still on the shelf through another copy (spec §5.1).
- **A search:** every book can match, on-shelf or not. A not-on-shelf result carries the `Unhauled` badge (Task 7).
- **The result count** is `visible.length` after every filter, so it follows the same rule: hidden unhauled books aren't counted, and search or the Unhauled filter counts them (spec §5.5).

**D7. How the copy filters combine** (spec §6.3; Task 5).
- **Counted copies:** `showsUnhauled ? b.copies : copies with unhauledAt === null`.
- **Each copy filter needs some counted copy to match it, independently of the others.** This is how the owner and edition filters work today. The copy filters are owner, edition, Deluxe, Signed and Date added.
  - So "Member B + Deluxe" shows a book where Member B owns one on-shelf copy and another on-shelf copy is deluxe. *Why:* requiring one copy to match every filter at once is a different, rarer question, and it would change the existing owner/edition behaviour.
- **Book filters** (series, ToS tags, Published, Covers) apply to the book, as today.
- **All filters AND together,** and with the search.

**D8. Date added and Published filters** (spec §5.4, §5.6, §6.3; Tasks 5 and 7).
- **Date added:**
  - **Day:** `localDay(iso)` gives the copy's `created_at` as `YYYY-MM-DD` in the viewer's time zone, from `Date`'s local getters.
  - **Options:** the days that have counted copies, most recent first, each with its count of **copies** added that day (`Nov 12 · 23`; another year adds it: `Nov 12, 2025 · 4`).
  - **Which books the options come from:** the books the unhauled rule (D6) lets through, **before** the other filters. So the menu doesn't reshuffle as other filters change, and the counts mean "copies the household added that day".
  - **A selected day that disappears from the options** (its copies were unhauled) stays selected and listed, with `· 0`. It's never silently reset.
  - A book matches when any counted copy was added on that day.
- **Published:**
  - `publishYear(text)` reads the first run of exactly four digits that isn't part of a longer run of digits, if it lies in 1000–2100. Otherwise it gives null.
    - So `"2019"`, `"2019-03-05"`, `"March 5, 2019"` and `"05/03/2019"` all give 2019.
    - `""`, null, `"n.d."`, `"12345"` and `"0999"` give null.
  - **The range:** `From` and `To` are two number inputs, both inclusive, and either may be empty. From > To is swapped for matching (the inputs show what was typed).
  - While either end is set, books without a year are left out (spec §5.6).
- **Where they sit** in `LibraryFilters`, below the existing selects:
  1. a `Date added` select (`Any day`, then the options);
  2. a `Published` row: `From` and `To`, `inputMode="numeric"`, `aria-label` `Published from` / `Published to`;
  3. a chip row `Deluxe`, `Signed`, `Unhauled` (`aria-pressed`) under the owner chips.

  No new disclosure or drawer: the overhaul plan redesigns filters.

**D9. Scroll restoration: an in-memory view store, an anchor, and a cached catalogue** (spec §5.7, §6.5; Task 9). Today `LibraryPage` keeps its filters in `useState`, and `useCatalog` refetches on every mount with a `Loading…` screen. So going back loses the filters, the search and the position.
- **View store, not router state:** `src/lib/library-view.ts` holds `LibraryView` (search, filters, cover filter) in a module-level store with a `useSyncExternalStore` hook. It outlives `LibraryPage` unmounting.
  - It is in memory only. A reload or a new tab starts fresh, which is what a person expects of a reload.
  - It resets when the household id changes or the user signs out.
  - The series stays in the route (`#/series/...`), as today.
  - *Rejected:* `history.state`. The hash router owns `window.location.hash` and a link click doesn't carry state. Encoding every filter in the hash would rewrite `parseHash` for no user gain.
- **Cached catalogue:** `useCatalog` keeps the last `{ householdId, books, tags }` in a module cache.
  - A mount with a cache for the same household starts with `loading` false and the cached books, then refreshes in the background without showing `Loading…`.
  - `reload()` from an edit updates the cache. `clearCatalogCache()` runs on sign-out (`AuthContext`) and after each test (`src/test/setup.ts`).
  - So the returning list renders at full height on its first frame.
- **The anchor:** clicking a book in the wall saves `{ bookId, top, scrollY, viewKey }`.
  - `top` is the card's `getBoundingClientRect().top`. `viewKey` is `JSON.stringify` of the view plus the route series.
  - Cards carry `data-book-id`.
- **The restore:** `useRestoreScroll(ready, viewKey)` sets `history.scrollRestoration = "manual"` and takes the anchor once.
  - When the view key matches and the card is on screen, it scrolls so the card's top is back at `top`. Otherwise it falls back to `scrollY`.
  - It **re-applies on every `ResizeObserver` callback on the wall for 2 s.** So covers, the invite code or the background refresh changing heights can't push the list away (spec §5.7).
  - It **stops at once on the first `wheel`, `touchstart`, `pointerdown` or `keydown`.** The person's own scrolling always wins.
  - The cover cards are fixed-ratio boxes (`aspect-[2/3]`), so image loads don't change heights. The re-apply is for the parts that can.
- **What counts as "back":** any return to the library route in the same session, including the Library tab. Keeping the place there is harmless and simpler than telling Back from a tab tap.

**D10. Tome of Secrets** (spec §5.2, §6.4; Tasks 2 and 3).
- **Read:** `BOOKS_SELECT` becomes `'id, title, authors, cover_url, page_count, series_name, series_volume, on_shelf, copies(edition_note, deluxe, unhauled_at)'`. `toLibraryBook` adds `unhauled: row.on_shelf === false`.
- **Unhauled books stay in `catalog.books`.** Removing them would make `isLibraryMissing` say `No longer in the household library` on linked shelf records, and stop their tag sync and metadata refresh.
- **"Linked to an existing quest":** a library book is quest-linked when some shelf record in the save has its `libraryBookId` and `stateAdapter.getLinkedQuestIdsForBook(record.id)` is non-empty. That helper counts live quests only (active or completed), and merges the links of same-book entries, so a discarded quest no longer counts.
- **One filter, used by every list:** `listedCatalog(catalog, stateAdapter)` returns the catalogue without the unhauled books that aren't quest-linked. It is passed to:
  - `searchShelf` from the picker's `On our shelf` group, the Library tab's Add form, and the tidy review's search;
  - `planTidy`'s matching, through the tidy controller's ready catalogue;
  - `findShelfOffers` (`Found on our shelf — link it?`).

  The full catalogue still goes to `refreshShelfRecords`, `isLibraryMissing` and `pickShelfBook`'s lookup.
- **The "Unhauled" mark,** for a quest-linked unhauled book:
  - the `On our shelf` option's note;
  - the `Your books` option's note, next to `MISSING_NOTE`;
  - the selected-book line;
  - the Library tab card, as `<div class="library-card-unhauled">Unhauled</div>`, styled like `library-card-missing`.

  `isLibraryUnhauled(book, catalog)` answers for a shelf record.
- **Deluxe as an edition label: yes.** `editionLabels(copies)` adds `Deluxe` when a counted copy has `deluxe` and no label already contains "deluxe" (case-insensitive).
  - *Why:* the existing Special / Illuminated Edition suggestion fires on any edition label. A deluxe copy with an empty note is exactly the case that suggestion is for, and the edition-note labels already show this way.
  - Counted copies are the on-shelf copies, or all copies for an unhauled book.
  - Signed isn't shown in ToS. Nothing there uses it.
- **Signed out or no household:** zero library requests, as today.

**D11. The Deluxe/Signed backfill is not in any migration or repo** (spec §5.3, §7 step 3).
- After the `db push`, the coordinator runs a **read-only** candidate query on production. It lists copies whose `edition_note` or `copy_note` contains `deluxe` or `special edition` (Deluxe), or `signed` (Signed), case-insensitive.
- It shows Tierra the list **privately in chat**. Tierra rules each copy in or out.
- Then, **with Tierra's go-ahead,** it runs one update setting the flags on exactly the approved copy ids. Note text is never changed.
- Nothing about it goes in a file, commit or PR (Global Constraints).

**D12. PR split, merge order, and what users see between merges** (spec §7).

| # | Repo / branch | Contents | Users see after merge |
|---|---|---|---|
| ToS 1 | `plan6-1-copy-flags-schema` | Task 1: migration + pgTAP only | Nothing. After the `db push`: still nothing |
| ToS 2 | `plan6-2-shelf-unhauled` (stacked on ToS 1) | Tasks 2–3 | A Deluxe copy triggers the Special Edition suggestion; nothing is hidden yet, because nothing is unhauled |
| Library | `tshardey/plan-6-copy-flags` (off library `main`) | Tasks 4–9, 10's docs | Toggles, badges, the new filters, the count, scroll position kept |

- **Merge order:** ToS 1 → `db push` (USER-APPROVED) → backfill (USER-APPROVED, D11) → ToS 2 and Library, in either order.
- **Neither ToS 2 nor the library PR may merge before the push.** Both read `on_shelf` by name. A missing column makes PostgREST reject the whole select, so ToS would show `On our shelf unavailable` and the library app `Couldn't load your books.` This is why the schema is its own PR.
- **Between the push and the later merges:**
  - the live apps ignore the new columns;
  - `request_cover_searches` behaves exactly as before, because nothing is unhauled yet;
  - the backfilled flags are invisible until the library PR.
- **Rollback:**
  - **Library PR reverted:** unhauled copies show as ordinary copies in the old app, Deluxe/Signed disappear from view, and nothing is lost. ToS (with ToS 2) still hides the unhauled books.
  - **ToS 2 reverted:** ToS lists unhauled books again, with no mark. The columns stay.
  - **Migration:** never reverted. The columns and the function are unused by old code.

## Review Focus

Each has a test in the named task.

1. **The last on-shelf copy is unhauled while its page is open, then the person goes back.** The page stays with the note. Back, the book is gone from the main view, the count drops by one, and the scroll falls back to the saved `scrollY` because the anchor card is missing. *(Task 6; Task 9.)*
2. **A double tap on `Unhaul`, `Deluxe` or `Signed`.** One write; the button is disabled while it is pending. *(Task 6.)*
3. **A copy toggle on a stale page** (the other member edited the copy's note meanwhile). The update sends only the toggled column and `user_edited_fields`, never the note, so the other edit survives. *(Task 4.)*
4. **The selected Date added day empties** after its only copy is unhauled. The day stays selected and listed with `· 0`, and the list says `No matching books`. It doesn't silently show everything. *(Task 5; Task 7.)*
5. **`Published` From > To, or a year typed with spaces.** It is swapped and trimmed, so 2020–2010 shows 2010–2020. Letters in the field are ignored, as if empty. *(Task 5; Task 7.)*

---

### Task 1: ToS — copy flags, `on_shelf` and cover batch exclusion (ToS PR 1)

**Files (new ToS worktree):**
- Create: `supabase/migrations/<timestamp>_library-copy-flags.sql`, named by `migration new`
- Create: `supabase/tests/database/library_copy_flags.test.sql`

**Setup.** Fetching doesn't edit the main checkout:
```
git -C C:/Users/tierr/Github/tome-of-secrets fetch origin
git -C C:/Users/tierr/Github/tome-of-secrets worktree add C:/Users/tierr/Github/tome-of-secrets-plan6 -b plan6-1-copy-flags-schema origin/main
```
- **First:** load the `supabase:supabase` and `supabase:supabase-postgres-best-practices` skills.
- `docker ps --filter name=supabase` before `start` (Global Constraints).

**Interfaces — Produces:** exactly the SQL in D1 and D3, plus:
- `library.request_cover_searches(p_household uuid, p_book_ids uuid[], p_batch uuid, p_manual boolean) returns table (book_id uuid, outcome text)`. Its outcomes are `queued | already_open | nothing_found | not_found | unhauled` (D5).
  - The book lookup becomes `select b.cover_url, library.on_shelf(b) into v_cover, v_on_shelf from library.books b where ...`.
  - Right after the `not found` branch: `if not v_on_shelf and not coalesce(p_manual, false) then return query select v_id, 'unhauled'::text; continue; end if;`.
- `comment on column library.copies.unhauled_at is 'When the household let this copy go; null = on the shelf. A book is on the shelf unless it has copies and all are unhauled (library.on_shelf).'`, and short comments on `deluxe` and `signed`.
- **The header comment** says the migration is schema only, and that the Deluxe/Signed backfill is a one-off production update, deliberately not here.
- **Idempotent**, like the earlier library migrations: `add column if not exists`, `create index if not exists`, `create or replace function`.

- [ ] **Step 1: Write the failing pgTAP test**, in the setup style of `library_cover_finder.test.sql`. User A is a member of household H1; user B isn't. Invented titles only. One assertion each:
  - **Schema:**
    - `has_column` for `unhauled_at`, `deluxe` and `signed`;
    - `col_not_null` and `col_default_is(..., 'false')` for `deluxe` and `signed`;
    - `col_is_null` for `unhauled_at`;
    - `has_function('library','on_shelf', array['library.books'])`.
  - **`on_shelf`, as A** (`select library.on_shelf(b) from library.books b where b.id = $1`):
    - a book with no copies → true;
    - one on-shelf copy → true;
    - **one unhauled and one on-shelf copy → true;**
    - **its only copy unhauled → false;**
    - two copies, both unhauled → false;
    - clearing one of them → true again.
  - **Through the PostgREST shape:** `select b.on_shelf from library.books b` (attribute notation) gives the same values as above for the "only copy unhauled" book.
  - **Defaults on existing paths:** a copy inserted with the column list `insertCopies` uses (`book_id, owner_user_id, edition_note, libib_id, origin`) has `unhauled_at` null and `deluxe`/`signed` false.
  - **RLS:**
    - A sets `unhauled_at = now()`, `deluxe = true` on an H1 copy: 1 row each;
    - B's update of the same columns: 0 rows, and the values are unchanged;
    - B's `select library.on_shelf(b)` over H1 books returns no rows (B can't see the books);
    - anon: `select library.on_shelf(b) from library.books b` throws permission denied.
  - **Cover batches,** as A:
    - `request_cover_searches(H1, [only-unhauled book], batch, false)` returns `unhauled`, and `cover_searches` has no row for it;
    - the same with `p_manual = true` returns `queued`;
    - a book with one unhauled and one on-shelf copy, non-manual, returns `queued`;
    - a zero-copy book, non-manual, returns `queued`.
- [ ] **Step 2: Run it to verify it fails.** `npx supabase@2.122.1 start --workdir <tos-wt>`, then `npx supabase@2.122.1 db reset --workdir <tos-wt>` and `npx supabase@2.122.1 test db --workdir <tos-wt>`. Expected: FAIL on `has_column ... unhauled_at`.
- [ ] **Step 3: Create the migration** with `npx supabase@2.122.1 migration new library-copy-flags --workdir <tos-wt>`, then write it per D1, D3, D5 and Interfaces.
- [ ] **Step 4: Verify.**
  - `db reset`, then `test db`. Expected: all seven library test files pass, the six existing ones unchanged.
  - **Rerun:** apply the migration file a second time with `psql "<DB URL from status>" -v ON_ERROR_STOP=1 -f supabase/migrations/<timestamp>_library-copy-flags.sql`. Expected: no error. Then `test db` is still green.
  - `npx supabase@2.122.1 db advisors --local --workdir <tos-wt>` (check `--help` for the flags first). Expected: no new `library` findings.
- [ ] **Step 5: Review, commit and open ToS PR 1.**
  - A subagent reviews the diff for:
    - a change to `request_cover_searches` beyond the unhauled branch (diff it against the cover-finder migration's body);
    - a missing revoke;
    - an `on_shelf` that is wrong for zero copies.
  - Commit `feat(library): unhauled, deluxe and signed copies`.
  - Push `plan6-1-copy-flags-schema` and open a PR to `main`, left unmerged. **The body says:**
    - schema and pgTAP only;
    - **merge, then `db push` (user-approved), then the private backfill, before ToS PR 2 or the library PR merges** (D12);
    - what users see between merges (D12's table).

### Task 2: ToS — read `on_shelf` and the copy flags (ToS PR 2, part 1)

**Files:**
- Create the branch: `git -C <tos-wt> checkout -b plan6-2-shelf-unhauled`
- Modify: `assets/js/services/LibraryCatalogService.js` (`BOOKS_SELECT`, `editionLabels`, `toLibraryBook`), `assets/js/services/ShelfBookService.js`
- Test: `tests/libraryCatalogService.test.js`, `tests/shelfBookService.test.js`

**Interfaces — Produces:**
- **The library book shape** gains `unhauled: boolean`. `editionLabels` follows D10.
- **In `ShelfBookService.js`:**
  - `export function isQuestLinked(stateAdapter, libraryBookId): boolean`: some shelf record with that `libraryBookId` has `getLinkedQuestIdsForBook(record.id).length > 0`;
  - `export function isShelfListed(stateAdapter, libraryBook): boolean`: `!libraryBook.unhauled || isQuestLinked(stateAdapter, libraryBook.id)`;
  - `export function listedCatalog(catalog, stateAdapter): Object|null`: `catalog` unchanged unless it is ready, else a shallow copy whose `books` are filtered by `isShelfListed`;
  - `export function isLibraryUnhauled(book, catalog): boolean`: true for a shelf record whose library book is in a ready catalogue with `unhauled` true.
  - `findShelfOffers` matches against `listedCatalog(catalog, stateAdapter).books`.

- [ ] **Step 1: Write the failing tests:**
  - **Select:** the query builder spy receives `BOOKS_SELECT` containing `on_shelf` and `copies(edition_note, deluxe, unhauled_at)`.
  - **Mapping:** `on_shelf: false` → `unhauled: true`; `true`, or the field missing → `false`.
  - **Edition labels:**
    - a book with copies `{ edition_note: null, deluxe: true }` gets `['Deluxe']`;
    - `{ edition_note: 'Deluxe Edition', deluxe: true }` gets `['Deluxe Edition']` only;
    - an unhauled copy's label is left out while another copy is on the shelf;
    - an unhauled book's (every copy unhauled) labels come from all its copies.
  - **Quest-linked unhauled book:** a fake stateAdapter with a shelf record R for library book U, linked to an active quest. Then:
    - `isShelfListed` is true for U, and false for an unhauled V with no record;
    - after the quest is discarded (no longer live), U is false;
    - `listedCatalog` keeps U and drops V, and the original catalogue's `books` still holds both;
    - `isLibraryMissing(R, catalog)` stays false;
    - `isLibraryUnhauled(R, catalog)` is true.
  - **Offers:** a `physical` book whose only strong match is V gets no offer.
- [ ] **Step 2: Run to verify failure.** `docker compose -p tos-plan6 run --rm dev npm test -- libraryCatalogService shelfBookService`. Expected: FAIL.
- [ ] **Step 3: Implement** per Interfaces and D10.
- [ ] **Step 4: Verify.** The same command, then the full `npm test`. Expected: PASS.
- [ ] **Step 5: Review and commit.** A subagent reviews the diff. Commit `feat(library): read unhauled books and deluxe copies from the household library`. Don't push yet.

### Task 3: ToS — hide unhauled books from the shelf lists, and mark linked ones (ToS PR 2, part 2)

**Files:**
- Modify: `assets/js/utils/bookSelector.js` (`shelfMatches`, `renderShelfGroup`, `renderOwnGroup`, the selected-book line near the `MISSING_NOTE` use), `assets/js/controllers/LibraryController.js` (the Add form's `searchShelf` call; the card's `missingHtml`), `assets/js/controllers/LibraryTidyController.js` (`_readyCatalog`), `assets/css/` (the file holding `.library-card-missing`)
- Test: `tests/bookSelector.test.js`, `tests/libraryController.test.js`, `tests/libraryTidyController.test.js`

**Interfaces:**
- Consumes: Task 2.
- Produces:
  - `const UNHAULED_NOTE = 'Unhauled'` in `bookSelector.js`;
  - the CSS class `library-card-unhauled`.

- [ ] **Step 1: Write the failing tests** (one fake catalogue: on-shelf A, unhauled V, unhauled U linked through shelf record R to an active quest; invented titles):
  - **Picker `On our shelf`:** an empty query lists A and U, not V. U's option note is `Unhauled`. A query matching V's title lists nothing from the shelf group.
  - **Picker `Your books`:** R shows the note `Unhauled`. With the quest discarded, R still shows `Unhauled` (it is the player's own record), but U leaves the shelf group.
  - **Selected book:** a quest whose book is R shows `Unhauled` next to it.
  - **Library tab:** R's card contains `.library-card-unhauled` with text `Unhauled` and no `.library-card-missing`. The Add form's shelf results leave out V.
  - **Tidy:** an Unsorted book whose only strong match is V gets no candidate and no preselection. Searching V's title in a row's `Find it in the library…` finds nothing. An Unsorted book matching U gets U as a candidate.
  - **Before-push guard (not a fix, a pin):** a catalogue load whose select is rejected with PostgREST `42703` gives `status: 'unavailable'`, as any other error does today. This records why D12's order matters.
- [ ] **Step 2: Run to verify failure.** `docker compose -p tos-plan6 run --rm dev npm test -- bookSelector libraryController libraryTidyController`. Expected: FAIL.
- [ ] **Step 3: Implement.** Pass `listedCatalog(catalog, stateAdapter)` wherever D10 lists, and the marks. Copy the `.library-card-missing` rule's look for `.library-card-unhauled`.
- [ ] **Step 4: Verify.** The full `npm test`. Then `docker compose -p tos-plan6 up jekyll` with `_config.supabase.yml` on the local stack (copied from `.example`, git-ignored), and check that the picker renders with no console errors.
- [ ] **Step 5: Review, commit and open ToS PR 2.**
  - A subagent reviews the diff. Look for any list still reading the unfiltered catalogue: grep for `searchShelf(`, `matchToLibrary(` and `catalog.books`.
  - Commit `feat: hide unhauled household books from Tome of Secrets unless a quest uses them`.
  - Push and open ToS PR 2 with base `plan6-1-copy-flags-schema`, left unmerged. **The body says:**
    - merge only after the `db push` (D12);
    - the retarget sentence (Global Constraints);
    - the Task 10 walkthrough results.

### Task 4: Library — types, repo, toggles' write and import safety

**Branch:** `git switch -c tshardey/plan-6-copy-flags origin/main` in a new library worktree. Set it up with the `superpowers:using-git-worktrees` skill; don't reuse this planning worktree.

**Files:**
- Modify: `src/lib/types.ts`, `src/lib/library-repo.ts`, `src/lib/libib/fake-store.ts`, and every test fixture that builds a `Book` or `Copy` literal (`tsc -b` lists them)
- Test: `src/lib/library-repo.test.ts`, `src/lib/libib/plan.test.ts`, `src/lib/libib/apply.test.ts`

**Interfaces — Produces:**
- `Book` gains `onShelf: boolean`, and `toBook` sets `onShelf: row.on_shelf !== false`. A row without the field (a `createBook` insert's `select()`) is on the shelf, which is right for a book just created with one copy.
- `Copy` gains `unhauledAt: string | null`, `deluxe: boolean` and `signed: boolean`; `toCopy` maps `unhauled_at`, `deluxe ?? false` and `signed ?? false`.
- `listBooks` selects `"*, on_shelf, copies(*)"`.
- `export interface CopyFlagsPatch { unhauledAt?: string | null; deluxe?: boolean; signed?: boolean }`, in `types.ts`.
- `export async function setCopyFlags(copy: Copy, patch: CopyFlagsPatch): Promise<void>`, in `library-repo.ts`. It sends only the patch's columns plus `user_edited_fields: markEdited(copy.userEditedFields, Object.keys(patch))`.

- [ ] **Step 1: Write the failing tests:**
  - **`listBooks`:** the select is `*, on_shelf, copies(*)`. A row with `on_shelf: false` maps to `onShelf: false`. A copy row with `unhauled_at` and `deluxe: true` maps to `unhauledAt` and `deluxe`.
  - **`setCopyFlags` (Review Focus 3):** `setCopyFlags(copy, { deluxe: true })` sends exactly `{ deluxe: true, user_edited_fields: [...existing, 'deluxe'] sorted }` with `.eq('id', copy.id)`, and nothing else (no `edition_note`, no `copy_note`). `{ unhauledAt: null }` sends `unhauled_at: null` and adds `unhauledAt`.
  - **libib re-import** (`plan.test.ts` and `apply.test.ts`, on the fake store):
    - **An unhauled copy:** a catalogue book whose only copy is unhauled, with `libibId` L, and a ledger with L seen once. Re-importing a file with L at 1 copy plans no new copy and no link. After `applyPlan`, the copy's `unhauledAt` is unchanged.
    - **The same unhauled copy without a `libibId`,** with an empty ledger: the plan links L to it (no new copy), and applying writes only `libib_id`. `unhauledAt`, `deluxe` and `signed` are unchanged.
    - **A deluxe, signed copy:** after a re-import that fills book fields, the copy's `deluxe` and `signed` are still true.
    - **L's copy count rising to 2:** adds exactly one new on-shelf copy, with the defaults.
- [ ] **Step 2: Run to verify failure.** `docker compose run --rm app npm test -- src/lib/library-repo src/lib/libib`. Expected: FAIL.
- [ ] **Step 3: Implement** per Interfaces. Add `onShelf: true`, `unhauledAt: null`, `deluxe: false` and `signed: false` to every fixture literal, and to `fake-store.ts`'s inserted rows.
- [ ] **Step 4: Verify.** `docker compose run --rm app npm test` and `npm run build`. Expected: green.
- [ ] **Step 5: Commit** `feat: read unhauled, deluxe and signed copies`.

### Task 5: Library — filter logic (pure)

**Files:**
- Create: `src/lib/copy-flags.ts`, `src/lib/date-added.ts`, `src/lib/publish-year.ts`, and their `.test.ts`
- Modify: `src/lib/filter-books.ts`, `src/lib/filter-books.test.ts`

**Interfaces — Produces:**
- **`copy-flags.ts`:**
  - `isUnhauled(c: Copy): boolean`;
  - `countedCopies(b: BookWithCopies, showUnhauled: boolean): Copy[]`;
  - `hasUnhauledCopy(b: BookWithCopies): boolean`;
  - `bookBadges(b: BookWithCopies): { unhauled: boolean; deluxe: boolean; signed: boolean }`. Here `unhauled` is `!b.onShelf`, and `deluxe`/`signed` are true when set on any on-shelf copy (spec §5.3).
- **`date-added.ts`:**
  - `localDay(iso: string): string`;
  - `dateAddedOptions(books: BookWithCopies[], showUnhauled: boolean, selected: string | null): { day: string; copies: number }[]`, sorted newest first, with `selected` kept at `copies: 0` when absent (Review Focus 4);
  - `dayLabel(day: string, now?: Date): string`.
- **`publish-year.ts`:** `publishYear(text: string | null): number | null`.
- **`filter-books.ts`:**
  - `filterBooks(books, opts: FilterOptions): BookWithCopies[]`, where `FilterOptions` is today's options plus `unhauled?: boolean`, `deluxe?: boolean`, `signed?: boolean`, `addedDay?: string | null`, `publishedFrom?: number | null` and `publishedTo?: number | null`;
  - `export function showsUnhauled(opts: { query: string; unhauled?: boolean }): boolean`.
  - Behaviour is D6, D7 and D8. Existing callers that omit the new options keep today's results, except that books with `onShelf === false` are hidden without a query.

- [ ] **Step 1: Write the failing tests** (invented titles; three books throughout: **P** with one unhauled and one on-shelf copy, **U** whose only copy is unhauled (`onShelf: false`), and **Z** with zero copies):
  - **Main view:** `filterBooks([P, U, Z], { query: "", owner: "all" })` gives P and Z.
    - The query `"   "` gives the same.
    - A query matching U's title gives U.
    - A query matching all three gives all three.
  - **Unhauled filter:** gives P and U, never Z.
  - **Counted copies (D7):**
    - P's unhauled copy is Member B's and its on-shelf copy Member A's. Owner B without a query: P is hidden. Owner B with the Unhauled filter: P shows.
    - Deluxe set only on P's unhauled copy: the Deluxe filter leaves P out of the main view. `bookBadges(P).deluxe` is false.
  - **Filters combine:** Deluxe + Signed on different on-shelf copies of one book matches. Deluxe + owner A + a series all apply.
  - **`localDay` at a local-midnight boundary** (TZ-independent: build the instants from local fields):
    - `localDay(new Date(2026, 10, 12, 0, 0, 0).toISOString())` is `"2026-11-12"`;
    - `localDay(new Date(2026, 10, 11, 23, 59, 59).toISOString())` is `"2026-11-11"`.
  - **`dateAddedOptions`:**
    - three copies on Nov 12 (one of them unhauled) and one on Nov 11 give `[{ "2026-11-12", 2 }, { "2026-11-11", 1 }]` without `showUnhauled`, and 3 for Nov 12 with it;
    - a selected `"2026-11-10"` with no copies is appended as `{ day: "2026-11-10", copies: 0 }`.
  - **The Date added filter** with Nov 12: a book whose only Nov 12 copy is unhauled is hidden without a query, and shown with the Unhauled filter.
  - **`dayLabel`:** `"2026-11-12"` with `now` in 2026 is `"Nov 12"`; with `now` in 2027 it is `"Nov 12, 2026"`.
  - **`publishYear`:**
    - `"2019"`, `"2019-03-05"`, `"March 5, 2019"` and `"05/03/2019"` give 2019;
    - `""`, `null`, `"n.d."`, `"junk"`, `"12345"` and `"0999"` give null;
    - `"c. 1887"` gives 1887.
  - **Published range:**
    - From 2010 to 2020 keeps books from 2010 and 2020, and drops 2009, 2021 and a null year;
    - only From 2019: 2019 onward;
    - From 2020 to 2010 behaves as 2010–2020 (Review Focus 5).
- [ ] **Step 2: Run to verify failure.** `docker compose run --rm app npm test -- src/lib/copy-flags src/lib/date-added src/lib/publish-year src/lib/filter-books`. Expected: FAIL.
- [ ] **Step 3: Implement** per Interfaces. `dayLabel` uses `toLocaleDateString(undefined, { month: "short", day: "numeric" })`, plus `year: "numeric"` for another year.
- [ ] **Step 4: Verify.** The same command, then the full suite. Expected: PASS. The existing `filter-books.test.ts` cases pass unchanged once their fixtures have `onShelf: true`.
- [ ] **Step 5: Commit** `feat: unhauled, deluxe, signed, date-added and published filtering`.

### Task 6: Library — copy toggles on the book page, and the scan line

**Files:**
- Modify: `src/components/book/CopyList.tsx`, `src/components/book/BookDetail.tsx`, `src/lib/scan/owners.ts`
- Test: `src/components/book/CopyList.test.tsx`, `src/components/book/BookDetail.test.tsx`, `src/lib/scan/owners.test.ts`

**Interfaces:**
- Consumes: `setCopyFlags` (Task 4); `isUnhauled`, `dayLabel(localDay(...))` (Task 5).
- Produces: none new.

**Exact copy** (D4):
- the buttons `Deluxe`, `Signed`, `Unhaul`, `Undo unhaul`, and the line `Unhauled {dayLabel}`;
- the error `Couldn't save the copy.`;
- the counts line `{n} on the shelf · {m} unhauled`;
- the book note `Unhauled. This book is hidden from the library unless you search for it or use the Unhauled filter.`

**The scan line** (`ownedInfo`) counts on-shelf copies only. When the matching books' copies are all unhauled, the line is `We had this and unhauled it`, and `recordedForOwner` is false, so a re-bought copy can be scanned in.

- [ ] **Step 1: Write the failing tests** (repo mocked):
  - **Toggles:**
    - pressing `Deluxe` calls `setCopyFlags(copy, { deluxe: true })` once, then `onChanged`. Pressing it on a deluxe copy sends `{ deluxe: false }`;
    - `Signed` the same way;
    - `Unhaul` sends `{ unhauledAt: <ISO string> }` with the faked system time.
  - **Unhauled copy:** it renders with `data-unhauled="true"`, `Unhauled Nov 12` and `Undo unhaul`. `Undo unhaul` sends `{ unhauledAt: null }`.
  - **Double tap (Review Focus 2):** two quick clicks on `Unhaul` call `setCopyFlags` once.
  - **Failure:** a rejected write shows `Couldn't save the copy.` and re-enables the button.
  - **Book page, one unhauled and one on-shelf copy:** both copies listed, `1 on the shelf · 1 unhauled`, and no book note.
  - **Book page, only copy unhauled (Review Focus 1):** `onShelf: false` shows the book note. `Undo unhaul` is there, and pressing it reloads.
  - **Scan line:**
    - only unhauled copies → `We had this and unhauled it`, and `recordedForOwner` false;
    - one unhauled Member A copy plus an on-shelf shared copy → `Already in library — shared copy`.
- [ ] **Step 2: Run to verify failure.** `docker compose run --rm app npm test -- src/components/book src/lib/scan/owners`. Expected: FAIL.
- [ ] **Step 3: Implement** per D4.
- [ ] **Step 4: Verify.** The full suite and `npm run lint`. Expected: green.
- [ ] **Step 5: Commit** `feat: unhaul, deluxe and signed toggles on each copy`.

### Task 7: Library — filter controls, badges and the result count

**Files:**
- Create: `src/lib/library-view.ts`, holding only the `LibraryView` type and `DEFAULT_VIEW` (Task 9 adds the store)
- Modify: `src/components/library/LibraryFilters.tsx`, `src/components/library/LibraryPage.tsx`, `src/components/library/BookCard.tsx`
- Test: `src/components/library/LibraryPage.test.tsx`, `src/components/library/BookCard.test.tsx`

**Interfaces:**
- Consumes: Task 5.
- Produces:
  - `LibraryFilters` gains `unhauled`, `deluxe`, `signed`, `addedDay`, `addedOptions: { day: string; copies: number }[]`, `publishedFrom`, `publishedTo`, and `onChange(patch: Partial<LibraryView>)`, with `LibraryView` exactly as in Task 9's Interfaces.
  - `BookCard` renders `data-book-id={book.id}` on its link.

**Exact copy:**
- **Chips:** `Deluxe`, `Signed`, `Unhauled`.
- **Selects and inputs:** the select `Date added` with first option `Any day` and options `{dayLabel} · {copies}`; the inputs `Published from` / `Published to` under the visible label `Published`.
- **The count:** `{n} book` / `{n} books`, in a `<p aria-live="polite">` above the wall. When the count is 0, it's replaced by the existing `No matching books`.
- **Badges** on the card under the author, small and stone-coloured: `Unhauled`, `Deluxe`, `Signed`, from `bookBadges`.

- [ ] **Step 1: Write the failing tests** (catalog hook mocked; P, U and Z from Task 5, plus 40 on-shelf books):
  - **Main view:** shows `42 books`, and U's card is absent.
  - **Search** for U's title: U's card shows with the `Unhauled` badge, and the count is `1 book`.
  - **Unhauled chip:** P and U show, with `2 books`.
  - **Deluxe chip:** only books with an on-shelf deluxe copy; their cards show `Deluxe`.
  - **Date added:** the select lists `Nov 12 · 3` first. Choosing it shows exactly the books with a counted copy that day.
  - **The selected day empties (Review Focus 4):** after a catalogue update in which the selected day's only copy is unhauled, the select still shows that day with `· 0`, and the page reads `No matching books`.
  - **Published:**
    - typing `2010` and `2020` filters, and the count follows;
    - typing ` 2015 ` (spaces) acts as 2015;
    - letters are ignored, as if empty;
    - 2020/2010 shows the same books as 2010/2020 (Review Focus 5).
  - **Combination:** Unhauled chip + Date added Nov 12 shows only books with an unhauled copy and some copy (counted with unhauled) added Nov 12, per D7.
  - The existing `LibraryPage` and `LibraryPage.covers` tests stay green.
- [ ] **Step 2: Run to verify failure.** `docker compose run --rm app npm test -- src/components/library`. Expected: FAIL.
- [ ] **Step 3: Implement** per D8. Leave `LibraryPage` holding the view in `useState` for now; Task 9 swaps in the store.
- [ ] **Step 4: Verify.** The full suite, lint and build. Expected: green.
- [ ] **Step 5: Commit** `feat: deluxe, signed, unhauled, date-added and published filters with a result count`.

### Task 8: Library — cover finder leaves unhauled books out

**Files:**
- Modify: `src/lib/covers/eligibility.ts`, `src/lib/covers/cover-repo.ts` (`RequestOutcome`), `src/contexts/CoverFinderContext.tsx` (outcome counting)
- Test: `src/lib/covers/eligibility.test.ts`, `src/components/covers/CoverBatchFooter.test.tsx`, `src/contexts/CoverFinderContext.test.tsx`

**Interfaces:**
- Consumes: `Book.onShelf` (Task 4).
- Produces: `RequestOutcome = "queued" | "already_open" | "nothing_found" | "not_found" | "unhauled"`.

- [ ] **Step 1: Write the failing tests:**
  - **`applyCoverFilter`:**
    - `no_cover` over [coverless P, coverless U, coverless Z] gives P and Z;
    - `marked` with marks on P and U gives P;
    - `nothing_found` is unchanged.
  - **`batchSelection`** given U directly doesn't put it in `eligible`.
  - **Footer, with a search showing U and the No cover filter:** `2 books · about …`, and `Find covers` requests exactly P's and Z's ids.
  - **Provider:** a `request_cover_searches` reply with one `unhauled` row and two `queued` rows gives `Searching 2 books.`
  - **Manual:** `findNow` on U's page still calls the RPC with `p_manual: true` (D5).
- [ ] **Step 2: Run to verify failure.** `docker compose run --rm app npm test -- src/lib/covers src/components/covers src/contexts`. Expected: FAIL.
- [ ] **Step 3: Implement** per D5.
- [ ] **Step 4: Verify.** The full suite. Expected: PASS.
- [ ] **Step 5: Commit** `feat: leave unhauled books out of cover batches`.

### Task 9: Library — the view store, cached catalogue and scroll restoration

**Files:**
- Create: `src/hooks/useRestoreScroll.ts`, `src/lib/library-view.test.ts`, `src/hooks/useRestoreScroll.test.tsx`, `e2e/scroll-restore.spec.ts`
- Modify: `src/lib/library-view.ts` (from Task 7), `src/hooks/useCatalog.ts`, `src/hooks/useCatalog.test.tsx`, `src/contexts/AuthContext.tsx` (sign-out clears the caches), `src/test/setup.ts`, `src/components/library/LibraryPage.tsx`, `src/components/library/CoverWall.tsx`

**Interfaces — Produces:**
```ts
// src/lib/library-view.ts
export interface LibraryView {
  query: string; owner: OwnerFilter; edition: string | null; tags: string[]; coverFilter: CoverFilter;
  unhauled: boolean; deluxe: boolean; signed: boolean; addedDay: string | null;
  publishedFrom: number | null; publishedTo: number | null;
}
export const DEFAULT_VIEW: LibraryView;
export function useLibraryView(householdId: string | null): [LibraryView, (patch: Partial<LibraryView>) => void];
export interface ScrollAnchor { bookId: string; top: number; scrollY: number; viewKey: string }
export function saveScrollAnchor(a: ScrollAnchor): void;
export function takeScrollAnchor(): ScrollAnchor | null;   // returns it once, then null
export function resetLibraryView(): void;                  // sign-out, tests
// src/hooks/useCatalog.ts
export function clearCatalogCache(): void;
// src/hooks/useRestoreScroll.ts
export function useRestoreScroll(ready: boolean, viewKey: string, container: RefObject<HTMLElement | null>): void;
```
- **Store:** `useLibraryView` resets to `DEFAULT_VIEW` when `householdId` differs from the one it last held.
- **The wall's click capture** (`onClickCapture` on `CoverWall`'s grid) finds the closest `[data-book-id]` and saves the anchor (D9).
- **Constants:** `RESTORE_WINDOW_MS = 2000`, and the stop events `["wheel", "touchstart", "pointerdown", "keydown"]`.

- [ ] **Step 1: Write the failing unit tests:**
  - **Store:** a patch persists across unmounting and remounting the hook. A different `householdId` resets it. `resetLibraryView` resets it. `takeScrollAnchor` returns the anchor once.
  - **Catalogue cache:** the second mount of `useCatalog` for the same household renders the cached books with `loading` false on its first render, and calls `listBooks` once more in the background. `clearCatalogCache()` makes the next mount show loading again.
  - **`useRestoreScroll`** (jsdom; `window.scrollTo` and `getBoundingClientRect` stubbed, `ResizeObserver` faked):
    - with a matching view key, it scrolls by the anchor card's current top minus the saved `top`;
    - after a fake resize within 2 s it scrolls again;
    - after a `wheel` event it doesn't;
    - with a different view key it uses `scrollY`;
    - **with the anchor card missing** (Review Focus 1) it uses `scrollY`.
  - **`LibraryPage`:** set a search and the Deluxe chip, unmount, remount: the search box and chip are restored.
- [ ] **Step 2: Write the failing e2e test** `e2e/scroll-restore.spec.ts`, in the style of `scan.spec.ts`:
  - **Setup:** `newUserWithHousehold`. Insert 150 books by REST with invented titles `Folio {n}` and one on-shelf copy each, 30 of them with the copy `deluxe: true`. Give every book a cover URL on an invented host that `page.route` answers after a 1500 ms delay with a small generated PNG.
  - **Steps:** `signIn`. Type `Folio` in the search and press the `Deluxe` chip. Scroll to the 25th result and record its card's `boundingBox().y`. Click it, wait for the book page, then `page.goBack()`.
  - **Expected:**
    - the search box still says `Folio`, and `Deluxe` is pressed;
    - the count reads `30 books`;
    - after the delayed covers finish loading (wait for the network to go idle), the 25th card's `y` is within 8 px of the recorded value.
- [ ] **Step 3: Run to verify failure.**
  - `docker compose run --rm app npm test -- src/lib/library-view src/hooks src/components/library`. Expected: FAIL.
  - The e2e against the `<tos-wt>` stack after `db reset`: `E2E_SUPABASE_PUBLISHABLE_KEY=<local key> docker compose run --rm e2e npx playwright test e2e/scroll-restore.spec.ts`. Expected: FAIL (the list returns to the top, and the search is empty).
- [ ] **Step 4: Implement** per D9 and Interfaces. `LibraryPage` reads the view from `useLibraryView`, calls `useRestoreScroll(!loading, viewKey, wallRef)`, and keeps the route series as today.
- [ ] **Step 5: Verify.** Both commands, then the full suite, lint and build. Expected: green.
- [ ] **Step 6: Commit** `fix: keep the library's place, filters and search when going back from a book`.

### Task 10: Local walkthrough, docs and the library PR

**Setup (local only):**
- **The stack:** `npx supabase@2.122.1 db reset --workdir <tos-wt>` on `plan6-2-shelf-unhauled`.
- **The library app:** `docker compose run --rm --service-ports app npm run dev -- --host`, with `.env.local` on the local stack.
- **ToS:** `docker compose -p tos-plan6 up jekyll`, with `_config.supabase.yml` on the local stack. If the magic-link redirect is refused, add `http://localhost:4000/tome-of-secrets/**` to `supabase/config.toml` `additional_redirect_urls` **locally only, without committing it**.
- **Two users,** signed up through Mailpit (`http://127.0.0.1:54324`): Member A creates household "Test Home", and Member B joins with the invite code, each in their own browser profile.
- **Seed** about 30 books with invented titles via `Add`. They include:
  - **P**, with two copies;
  - **U**, with one copy;
  - **Z**, whose copy you delete (a zero-copy book);
  - a few with no cover;
  - a mix of publish dates (`2019`, `2019-03-05`, `March 5, 2019`, empty, `junk`).

- [ ] **Step 1: Unhaul.**
  - Member A unhauls one of P's copies: P stays in the list, and its page shows `1 on the shelf · 1 unhauled`.
  - Member A unhauls U's only copy: U's page shows the hidden note. Back, U is gone and the count drops by one.
  - Member B (after a refresh) doesn't see U either.
  - **Search U's title:** it shows with `Unhauled`. The Unhauled chip shows P and U. Z is still in the main view.
  - `Undo unhaul` brings U back.
- [ ] **Step 2: Deluxe and Signed.**
  - Toggle each on a copy of P: the badges show on the copy and the card.
  - The Deluxe and Signed chips filter.
  - Studio shows the copy's notes unchanged, and `user_edited_fields` holding `deluxe` and `signed`.
- [ ] **Step 3: Date added.** Today's option reads `{today} · {n}`, with n the number of copies added today. Unhauling one of today's copies lowers n by one, unless the Unhauled chip is on.
- [ ] **Step 4: Published.** 2019–2019 shows exactly the three dated books; the empty and `junk` ones are left out.
- [ ] **Step 5: Covers.**
  - With U unhauled and coverless, the No cover footer doesn't count it.
  - In SQL, `select * from library.request_cover_searches('<H>', array['<U>']::uuid[], gen_random_uuid(), false)`, run as Member A through the Studio SQL editor's role switch, returns `unhauled`.
- [ ] **Step 6: Scroll.** At 390 px with "Slow 4G" throttling: search, chip, scroll far down, open a book, Back. Expected: the same place, with the search and filters kept, and no jump as covers load.
- [ ] **Step 7: Tome of Secrets.**
  - Member A links U to a new quest from `On our shelf` before unhauling it, then unhauls U in the library app and refreshes ToS. The quest keeps its book, and shows `Unhauled` in the selected-book line and on the Library tab card.
  - An unlinked unhauled book isn't in the picker, the Add form's shelf results or the tidy review.
  - A Deluxe copy with an empty note triggers the Special / Illuminated Edition suggestion when picked.
- [ ] **Step 8: libib re-import.** Export nothing real: build a synthetic libib CSV for U's and P's titles. Then:
  - import it over the unhauled and flagged copies; U stays unhauled and P's flags stay set;
  - then change U's row to 2 copies; exactly one new on-shelf copy is added, and U returns to the main view.
- [ ] **Step 9: Gates and privacy.**
  - `docker compose run --rm app npm test`, `npm run lint` and `npm run build`; the e2e spec; the ToS `npm test`; `npx supabase@2.122.1 test db --workdir <tos-wt>`. All green.
  - `git diff --name-only origin/main...HEAD` in both repos lists no `.env`, CSV or image file.
- [ ] **Step 10: README, review, PRs.**
  - **README:** add an `Unhauling and copy flags` section covering the toggles, what Unhauled hides and where it still shows, and the new filters and count.
  - **Review:** a whole-branch subagent review against the spec and D1–D12, with Review Focus 1–5 called out. Tell it: no AI attribution.
  - **Commit:** `docs: unhauled, deluxe and signed copies`.
  - Push `tshardey/plan-6-copy-flags` and open a PR to `main`, left unmerged. **The body says:**
    - **merge only after ToS PR 1's `db push`**, because the catalogue reads `on_shelf` (D12);
    - the walkthrough checklist with results.
  - Add the walkthrough results to ToS PR 2's body too.

---

## USER-APPROVED STEP: production rollout

**Agents don't run this without the user's explicit go-ahead at that moment.** Approval of this plan isn't approval of this step. The user runs it, or explicitly tells an agent to, in this order:

1. **Merge ToS PR 1** (`plan6-1-copy-flags-schema`).
2. **`db push`, from a fresh push worktree at the merged `main`:**
   ```
   git -C C:/Users/tierr/Github/tome-of-secrets fetch origin
   git -C C:/Users/tierr/Github/tome-of-secrets worktree add --detach C:/Users/tierr/Github/tome-of-secrets-plan6-push origin/main
   npx supabase@2.122.1 link --project-ref cdhorluhpuchzlnahzlt --workdir C:/Users/tierr/Github/tome-of-secrets-plan6-push
   npx supabase@2.122.1 db push --dry-run --workdir C:/Users/tierr/Github/tome-of-secrets-plan6-push
   ```
   - Confirm that the only pending migration is `..._library-copy-flags`, then run it without `--dry-run`. No function deploy.
   - Afterwards: `git -C C:/Users/tierr/Github/tome-of-secrets worktree remove C:/Users/tierr/Github/tome-of-secrets-plan6-push`.
3. **Backfill (D11), with Tierra's go-ahead at each half:**
   1. The coordinator runs the read-only candidate query and shows Tierra the list privately in chat.
   2. Tierra rules each copy in or out.
   3. The coordinator runs the one-off update on exactly the approved ids, and reports the row count.

   Nothing from it goes in a file, commit or PR. It isn't part of any migration or repo.
4. **Merge ToS PR 2 and the library PR,** in either order. Hard-refresh both sites after the Pages deploys.
5. **Tierra unhauls this week's traded-in copies.** They check that those books are gone from the main view and from ToS's `On our shelf`, and that a search still finds them, marked `Unhauled`.

## User checks after rollout

1. **One tap each:** unhaul a copy from its book page, and undo it.
2. **A kept deluxe with a donated original:** unhaul only the original. The book stays in the list with its `Deluxe` badge.
3. **In a bookshop:** search for a title you traded in. It shows, marked `Unhauled`.
4. **The backfill:** the Deluxe chip lists the copies you approved, and their notes read exactly as before.
5. **After the next bulk import:** `Date added: {that day}` shows that day's books, and its count matches the number of copies you added.
6. **Published:** a year range such as this year to blank finds the new releases. Books with no date aren't in it.
7. **Back from far down the list,** with a filter and a search on: you land where you were.
8. **Tome of Secrets,** for both Tierra and AJ: a quest whose book was unhauled still has its book, with the `Unhauled` mark. An unhauled book isn't offered when picking a book for a new quest.
9. **Covers:** the No cover filter doesn't count unhauled books.

## Follow-ups (not built)

1. **Show the unhaul date range in a filter** ("unhauled this month"). The `unhauled_at` timestamp is kept for it.
2. **Signed in Tome of Secrets,** if a quest or tag ever uses it.
3. **Persist the view across reloads** (`sessionStorage`, `tpl_` prefix), if a reload losing the filters turns out to annoy.

## Open questions for the user (resolved)

All five were resolved on 2026-11-12: Tierra approved each default below. The plan builds them as written.

1. **Find now on an unhauled book's page (D5). Resolved: allowed**, because it is an explicit request. Batches and the No cover filter leave unhauled books out as the spec says.
2. **The scan line for a book you unhauled (Task 6). Resolved:** `We had this and unhauled it`, and scanning a re-bought copy is allowed.
3. **Copy filters combine per filter, not per copy (D7). Resolved: per filter.** "Member B + Deluxe" matches a book where Member B owns one on-shelf copy and another on-shelf copy is deluxe, as the owner and edition filters already work.
4. **Deluxe shows as an edition label in ToS (D10). Resolved: yes**, so the Special / Illuminated Edition suggestion fires for deluxe copies whose note is empty.
5. **Filters persist for the session, not across a reload (D9). Resolved:** in memory only.
