# Plan 4 — Tome of Secrets ↔ Library Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A player links a household-library book to a quest straight from the quest, in a couple of taps. Every ToS book gets a type. Tome of Secrets tags on shelf books are shared through the library. The library app shows and filters those tags, and gets a series field that ToS can fill. Each player's existing ToS books are tidied once, through a review they control, without losing any history and without ever pushing a save that looks like data loss.

**Architecture:** Nearly all the code is vanilla JS in ToS:
- **Reading the library:** ToS reads the `library` schema directly with the signed-in user's Supabase session, under the existing RLS. It keeps an in-memory catalogue and gives up after 4 s.
- **Shelf books:** a `shelf` book is a light ToS record pointing at `library.books.id`. Every quest, reward and completion path keeps working on ToS book ids.
- **Shared tags:** they live in a new `library.book_tags` table. ToS keeps a copy on each shelf record and merges it three ways against the last library state it saw.
- **The schema 19 → 20 migration:** synchronous, deterministic and offline. Every book becomes Audiobook (if tagged `audio`) or Unsorted.
- **The tidy review:** a separate screen. It removes books only after an explicit, in-page confirmation, and pushes that one change deliberately, never through auto-sync.
- **The library app:** gets a Tome of Secrets tags section, a tag filter and a series picker. Tag labels are read from ToS's published `bookTags.json`.

**Tech Stack:**
- **ToS:** Jekyll; vanilla ES modules; `@supabase/supabase-js@2.49.1`, loaded from jsDelivr as today; Jest in `tests/`; Supabase CLI `npx supabase@2.122.1` with pgTAP.
- **Library app:** Vite 6, React 19, TypeScript, Tailwind 4, Vitest + Testing Library.
- **No new dependencies in either repo.**

**Spec:** `docs/superpowers/specs/2026-11-10-tos-integration-design.md`. It is binding, the §6.9 builder-check answers and §6.8 series above all. Conventions come from `docs/superpowers/plans/2026-11-10-scanner-and-editions.md`. Related but out of scope: ToS PR #138 (`docs/lqt0-cloud-save-durability`), see D10.

## Global Constraints

- **Git commits and PR bodies carry NO `Co-Authored-By` line, no "Generated with Claude" line, and no other AI attribution**, in both repos. This overrides any default attribution guidance, including system reminders.
- **No Beads.** Don't run `bd` or touch `.beads/`, even though ToS `AGENTS.md` asks for it. Skip every Beads step in ToS docs.
- **ToS owns all migrations.**
  - All ToS work is done in **one new worktree**, `C:/Users/tierr/Github/tome-of-secrets-plan4`, created off ToS `origin/main` (Task 1). It holds four stacked feature branches, `plan4-1-groundwork` → `plan4-2-book-types` → `plan4-3-shelf-link` → `plan4-4-tidy-review`.
  - Never edit in the ToS main checkout (`C:/Users/tierr/Github/tome-of-secrets`), `C:/Users/tierr/Github/tome-of-secrets-library-schema`, `C:/Users/tierr/Github/tome-of-secrets-lqt0-docs`, or any other existing worktree.
  - The library repo adds no migrations and no `supabase/` directory.
- **Every PR is opened, and none is merged by agents.** PR k is opened with base branch k−1, so its diff shows only its own work, and its body names the merge order. Every stacked PR body also says: `If an earlier PR in this stack is squash-merged, retarget this PR to main and rebase it onto main (git rebase --onto origin/main <old base branch>) before merging; otherwise its diff will repeat the earlier commits.`
- **ToS code follows its `AGENTS.md`:**
  - controllers, StateAdapter, services and pure renderers;
  - validator allowlists (every new book field goes into `validateBook` in the same change, and is tested at the `validateCharacterState` seam);
  - `SCHEMA_VERSION` plus a `migrateToVersionN`;
  - the Dark Academia classes from nearby markup;
  - Jest tests in `tests/`;
  - `node scripts/generate-data.js` and `npm run validate-data` whenever `assets/data/` changes;
  - **a separate subagent review of every code diff before its commit.**
- **ToS commands** run from `<tos-wt>` (= `C:/Users/tierr/Github/tome-of-secrets-plan4`) through Docker with their own project name: `docker compose -p tos-plan4 run --rm dev npm test` (it starts in `tests/`).
  - Jekyll: `docker compose -p tos-plan4 up jekyll`, which always serves **both** `_config.yml` and `_config.supabase.yml`.
  - Supabase CLI: `npx supabase@2.122.1 <cmd> --workdir <tos-wt>`, **on the host**.
  - Library app: `docker compose run --rm app ...`.
- **Production changes happen only in the USER-APPROVED step, which agents never run:** `db push`. This plan changes no Edge Function, so there is no function deploy. Never point a tool at the production project.
- **Both repos are public.**
  - No real titles, authors, ISBNs, ids, saves or household names go in fixtures, tests, commits or PR text. Use invented titles ("The Salt Road", "Glass Orchard"), synthetic uuids, and invented member names ("Member A", "Member B").
  - Never log titles, authors or tag sets. `console.warn`/`console.error` get an error name or code only.
- **Nothing in ToS blocks on the library** (spec §4, §6.7).
  - Every library call goes through `LibraryCatalogService` (Task 5), which never throws to callers and gives up at `LIBRARY_TIMEOUT_MS = 4000` (reads) or `LIBRARY_WRITE_TIMEOUT_MS = 8000` (writes).
  - Signed-out and household-less players make **zero** library requests.
- **`LARGE_STATE_KEYS` in `persistence.js` is not changed.** lqt0's planned "collapsed save" definition is built on that set (D10).
- `localStorage` keys added by the library app are prefixed `tpl_`. Every read and write is wrapped in try/catch.

## Decisions

These settle what spec §7 leaves to the builder and the brief's points. Where the code and the spec disagree, the decision says so; the spec isn't edited.

**D1. How ToS reads and writes the library.**
- **Direct `library` schema queries with the player's own session, no RPCs.** RLS already limits every row to household members, as pgTAP proves today (`library_rls.test.sql`). Every write ToS makes is a plain, idempotent row operation:
  - insert a tag;
  - delete a tag;
  - a conditional `update books set series_name = $1 where id = $2 and series_name is null`.

  None needs definer rights or a multi-row transaction, so an RPC would only add grants and pgTAP surface. The tag filter in the library app is client-side for the same reason (D4).
- **One Supabase client per page.** The client `cloudAuth.js` creates today is local to `initializeCloudAuth`. Task 5 moves its creation into `services/supabaseClient.js`, `getSupabaseClient()`, which is memoized and returns null when Supabase isn't configured. Cloud save and the library both use it, so they share one GoTrue session and its storage key, `sb-<ref>-auth-token`. That is the session the library app already shares on the same origin. Library queries use `client.schema('library').from(...)`. Task 5 Step 1 checks that `schema()` exists in the pinned 2.49.1 build before relying on it; if it doesn't, the fallback is a second `createClient(url, key, { db: { schema: 'library' } })`, which is still one auth session.
- **The household:** the player's earliest-joined membership (`household_members ... order by created_at limit 1`). That is the exact rule of the library app's `getMyHousehold`, so both apps always mean the same household.
- **Timeouts:** reads are raced against a `LIBRARY_TIMEOUT_MS = 4000` timer, writes against `LIBRARY_WRITE_TIMEOUT_MS = 8000`. The race also covers `getSession()`, which may refresh a token over the network. A timeout, a network error or an HTTP/PostgREST error marks the catalogue `unavailable`.
- **Caching:** the catalogue is held in memory only, per page:
  - It is fresh for `CATALOG_TTL_MS = 600000` (10 min).
  - It refreshes when a picker opens on a stale catalogue, when the tab becomes visible on a stale catalogue, and after every write.
  - After a failure it isn't retried for `RETRY_AFTER_MS = 60000`, unless the player presses `Retry`.

  Nothing is cached across reloads. Offline means "On our shelf unavailable", exactly as spec §6.7 says, and the save keeps shelf records' own title/cover/tags, so play goes on. *(Rejected: a localStorage copy of the catalogue. It would offer shelf links offline, but it adds a second stale source of truth and a cache-invalidation story for a rare case.)*
- **Two queries, so a tag failure never hides the shelf:** `books` with `copies(edition_note)`, and `book_tags` for the household, run in parallel. If only the tag query fails, for example before the `db push` or because of a PostgREST error, shelf results still show, `tagsAvailable` is false, and no tag merge runs.
- **Paging is stable:**
  - `books` is ordered by `id`;
  - `book_tags` by `book_id`, then `tag_id`;
  - both are read in pages of 1000 until a page comes back empty.

  **If any `book_tags` page fails, the whole tag set is discarded and `tagsAvailable` is false.** A partial read is never used, because a tag missing from a partial read would look like a removal to the three-way merge (D4) and would be deleted locally.
- **Signed out, or no household:** `status: 'signed-out' | 'no-household'`. Pickers hide the shelf group, no tags are shared, and the review is the simple version (D9). Types and the new Library tab still apply.
- **A player who left the household mid-session:** RLS answers empty or `42501`. The catalogue goes `no-household`, shelf records keep working from their own fields, and pending tag changes stay pending (D4). Nothing is retried in a loop.

**D2. The ToS book model and the schema 19 → 20 migration.**

| Field | v20 rule | Why |
|---|---|---|
| `type` | `'unsorted' \| 'shelf' \| 'audiobook' \| 'ebook' \| 'library-loan' \| 'physical'` (`utils/bookTypes.js`, `BOOK_TYPES`) | Spec §6.1. `physical` is "Physical, not in the library yet" (§6.2); `unsorted` is §6.9's temporary type |
| `libraryBookId` | string for `shelf`, else `null`. A `shelf` book without one is re-typed `unsorted` by the validator | §6.1 |
| `libraryTagsBase` | `string[]` for `shelf` (the shared tags as last seen in the library, D4), else `null` | Needed for the three-way tag merge |
| `shelfMatchDismissed` | `string \| null`: the library book id the player said "not this one" to | So "Found on our shelf" (§6.9) never nags about the same match |
| `status` | `'reading' \| 'completed'`. `'reading'` now means only "not completed"; `'other'` becomes `'reading'` | §6.1 keeps completed/not completed internally. **Why not rename it:** the forward-compatible validator of PR 1 (and any rolled-back build) already accepts both values, so a rollback never drops a status |
| `shelfCategory` | deleted | §6.1 retires Physical TBR; "it's on our shelf" now comes from the link |
| `tags` | the manually set tag ids, **never** a type-derived id (`audio`) | D3 |
| everything else | unchanged (`id`, `title`, `author`, `cover`, `pageCount`, `dateAdded`, `dateCompleted`, `links` including `grandfatheredQuestIds`) | Quest/reward/completion code stays on ToS ids (§6.1) |

- **`deriveBookType(book)`** (pure, `utils/bookTypes.js`):
  - a valid `type` is kept (a `shelf` type needs a `libraryBookId`);
  - else a book whose tags include `audio` is `audiobook`;
  - else it is `unsorted`.

  The migration and the validator both call it, so a v19 snapshot that reaches v20 code by any path gets the same answer.
- **`migrateToVersion20(state)`**, for every book:
  - set `type` with `deriveBookType`;
  - strip `audio` from `tags`;
  - turn `status 'other'` into `'reading'`;
  - delete `shelfCategory`;
  - normalize the three new fields.

  If the state has no `bookTidy` key, it adds one (D9): `status 'pending'` when any book is `unsorted`, else `'done'`. A present one is kept.
- **The migration:**
  - **makes no network call;**
  - **never reads the clock** (the `bookTidy` it adds has `postponedAt: null` and `completedAt: null`);
  - **makes no random ids;**
  - **removes no book.**

  It is idempotent: running it on v20 data changes nothing.
- **Both entry points use it.** `loadState()` runs it through `migrateState` from the stored version. `applySnapshot()` runs it from **the snapshot's own** version (it already passes `fromVersion`), so a v19 cloud snapshot pulled after this deploy arrives as v20 with Unsorted books and a pending review (Review Focus covers it).
- **A new key, `bookTidy`.** It is **localStorage-backed**: it goes in `CHARACTER_STATE_KEYS`, in the `utils/storage.js` event allowlist, and in `loadAndMigrateState`'s key list, but **not** in `LARGE_STATE_KEYS` (D10). Shape (`validateBookTidy`):

  ```js
  { status: 'pending' | 'postponed' | 'done',
    postponedAt: string|null, completedAt: string|null,
    removedBooks: { [bookId]: Book } }   // full v20 records, kept for undo (D9)
  ```

  Empty-state default: `{ status: 'done', postponedAt: null, completedAt: null, removedBooks: {} }`.
- **Series "in progress"** (`getSeriesProgressSummary.inProgressCount`) becomes: not completed and linked to an **active** quest (§6.8). It no longer reads `status === 'reading'`, which now means every unfinished book.

**D3. Effective tags and tag scope.**
- **`bookTags.json` gets two optional, data-only fields** (PR 1, so the library app can rely on them whichever ships first):
  - `"derivedFromType": "audiobook"` on `audio`;
  - `"scope": "reader"` on the tags that describe the reading or the reader, not the book. The list is exactly `new-author`, `new-country`, `re-read`, `picked-back-up`, `long-tbr`, `recommended` and `genre-stretch`, as the user confirmed (Open question 1, resolved). `borrowed` (Borrowed Copy) is shared like any other tag and has no `scope`.
- **The `scope` field is the only place the reader-tag list lives**, so the user's answer to Open question 1 is a data edit to `bookTags.json` and nothing else:
  - no JS or TS file names a reader tag id;
  - no test pins the list: tests build their own fixture tags with and without `scope`, and `bookTags.test.js` checks only that `scope` is absent or `"reader"`;
  - the library app reads the same field from the published JSON.

  Changing the list later moves no data. Reader tags already pushed to the library before a tag became reader-scoped stay there, shown read-only as `set in Tome of Secrets`.
- **`utils/bookTagRules.js`** is the one place that knows the rules:
  - `effectiveBookTags(book)` = `book.tags` ∪ the ids whose `derivedFromType === book.type`;
  - `isTypeDerivedTag(id)`;
  - `isSharedTag(id)`: in `bookTags.json`, not type-derived and not `scope: "reader"`;
  - `sharedTags(ids)` and `readerTags(ids)`.
- **Every place that evaluates a book's tags uses `effectiveBookTags`:**
  - `RewardCalculator._buildQuestCompletedPayload` (~286);
  - the two edit-drawer bonus-card refreshes in `QuestController` (~1753, ~1789), which feed `classifyBonusCardState`;
  - the new selector chip (D7).

  The tag picker no longer renders type-derived tags, and marks reader tags "just you". `getApplicableTagIds` is unchanged: if an effect ever names `audio`, it sees audiobooks as tagged.
- **Equivalence (anti-goal "rewards keep firing exactly as before"):** for every v19 book, `effectiveBookTags(migrated)` equals the v19 `tags` as a set. Task 3 pins it on a fixture covering every tag.
- **Reader tags** stay on the player's own record: never written to the library, never removed by a library refresh. **Type-derived tags** are never stored anywhere; the database refuses `audio` too (D4).
- **A completed quest's rewards never change.** `BaseQuestHandler` computes rewards at completion and stores them on the quest. `handleSaveQuestChanges` and `handleUpdateQuest` don't recompute a completed quest, and validation keeps `rewards`. A later tag edit or library refresh changes only active previews and bonus-card states (§6.9). Task 7 pins this end to end.

**D4. The shared tags table and its sync rules.**
- **Schema** (ToS migration `library-book-tags-series`, Task 1):

  ```sql
  alter table library.books add constraint books_id_household_key unique (id, household_id);
  create table library.book_tags (
    book_id      uuid not null,
    household_id uuid not null,
    tag_id       text not null,
    created_at   timestamptz not null default now(),
    primary key (book_id, tag_id),
    foreign key (book_id, household_id) references library.books (id, household_id) on delete cascade,
    constraint book_tags_tag_id_format check (tag_id ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(tag_id) <= 40),
    constraint book_tags_not_type_derived check (tag_id <> 'audio')   -- bookTags.json derivedFromType; §6.4
  );
  ```

  - The composite foreign key makes a tag's `household_id` always its book's, so RLS can test `is_member(household_id)` without a join.
  - **RLS:** select, insert and delete for members. **No update** (a tag row is either there or not).
  - **Grants:** `select, insert, delete` to `authenticated`, nothing to `anon`/`public`.
  - Tag ids aren't checked against the vocabulary, which lives in ToS JSON. An unknown id is shown as-is by the library app and ignored by ToS rules.
- **Source of truth (§6.4):** the library, for `shelf` books. The ToS record holds:
  - `tags` = the shared tags as ToS believes them, ∪ the player's reader tags;
  - `libraryTagsBase` = the shared set at the last successful exchange.
- **`mergeShelfTags({ local, base, library })`** (pure; all inputs reduced to `sharedTags` first):
  - `merged = (library ∪ (local − base)) − (base − local)`;
  - `toAdd = merged − library`;
  - `toRemove = library − merged`.

  After a successful push, `tags = merged ∪ readerTags(local)` and `libraryTagsBase = merged`. After a failed push, `tags` is the same but `libraryTagsBase = library`, so the same diffs are recomputed and re-pushed next time.
- **What this gives:**
  - **Offline edits** wait in the record itself, so they survive a reload and a cloud sync to another device. Re-pushing an add or a remove is idempotent.
  - **Last write wins per tag**, measured as the last write *to reach the library*. A ToS edit made offline wins over a library-app edit made before ToS came back online. Spec §6.4 accepts this for two people. True timestamp ordering would need tombstones in a public table for a case that needs both people to edit the same tag on the same book within one offline window.
- **When it runs:**
  - **write-through:** on every tag edit of a shelf record, `syncShelfTags` reads that book's tags, merges and pushes;
  - **refresh:** on every catalogue load, `refreshShelfRecords` merges every shelf record against the loaded tags and pushes all diffs;
  - when linking (`ensureShelfRecord` takes the library's tags as both `tags` and base).

  The shared tags of an active quest's book therefore follow the library (§6.9).
- **Type-derived and reader tags never reach the library**, by three guards: `sharedTags` filtering, the database check for `audio`, and tests.
- **The library app reads labels from `bookTags.json`:**
  - **URL:** `https://tshardey.github.io/tome-of-secrets/assets/data/bookTags.json`. Checked 2026-11-10: `200`, `application/json`, 48 entries, `Access-Control-Allow-Origin: *`, `Cache-Control: max-age=600`.
  - **In production** the app fetches the same-origin path `/tome-of-secrets/assets/data/bookTags.json`, so CORS doesn't apply.
  - **In dev** a Vite proxy maps `/tome-of-secrets` to `TOS_JEKYLL_URL` (default `http://host.docker.internal:4000`). `VITE_TOS_BOOK_TAGS_URL` overrides the path.
  - **Caching:** the app keeps the last good copy in `tpl_tos_book_tags` for when the fetch fails. With no copy at all, tags show as raw ids under "Other".
  - **What it shows:** the editor and filter offer only shared tags (`isSharedTag`, ported to `src/lib/tos-tags.ts`). Existing rows with other ids are shown read-only.

**D5. Series in the library schema (§6.8).**
- **Columns:**
  - `books.series_name text`, check `series_name is null or (series_name = btrim(series_name) and char_length(series_name) between 1 and 200)`;
  - `books.series_volume numeric(6,2)`, check `series_volume is null or (series_volume >= 0 and series_volume < 10000)`, so 2.5 novellas sort between 2 and 3.
- **No index:** filtering is client-side over at most a few thousand rows.
- **The ToS fill rule:**
  - when a `shelf` record is in a ToS series, ToS calls `fillSeries(libraryBookId, series.name)`, which runs the conditional update in D1;
  - `fillSeries` trims the name and clips it to 200 characters, the column limit. A blank name makes no call. A `23514` check violation counts as `'kept'` and is never retried;
  - it runs when the book is added to a series (Task 8's chip and the book drawer), and on every refresh for shelf records already in one;
  - ToS never writes a series that is already set, never clears one, and never writes a volume.

  The conditional `where series_name is null` makes the fill race-free against an edit in the library app.
- **ToS's own `series.bookIds` stays the game's source of truth** (§6.8).

**D6. Shelf records.**
- **`ensureShelfRecord(stateAdapter, libraryBook)`:**
  - if one exists, it returns the **oldest** (`dateAdded`, then `id`) ToS book with `type 'shelf'` and that `libraryBookId`;
  - else it adds one with `type 'shelf'`, the library book's title, `author = authors.join(', ')`, `cover = coverUrl`, `pageCount`, `tags = libraryTagsBase = sharedTags(library tags)`, and empty links.
- **Metadata refresh:** title, author, cover and page count are copied from the library when it is reachable and the library value isn't null. A null library value never blanks a ToS one. **A refresh that changes nothing writes nothing** (Review Focus 2).
- **Orphans:** a record created by a pick that was then cancelled stays in the save, invisible (not completed, no links), and is reused by the next pick of that book. It is **never pruned**, because a prune would be a silent shrink (D10).
- **A library book that was deleted:** the record keeps its last metadata and tags, and its card and chip say `No longer in the household library`. That state is derived at render time and never stored. Refresh skips it, and its tags stay local.
- **Duplicates:** two ToS records may point at one library book, when both carried history at review time (D9). `isSameBook` and `getSameBookLinks` already merge their links for one book, one quest. Linking always reuses the oldest.
- **Same title, different type:** an audiobook, ebook or loan with a shelf book's title is a separate record. It is never offered for shelf reuse, never matched in the review (only `unsorted` books are), and never gets "Found on our shelf" (only `physical` books do). **One book, one quest still counts them as the same book**, because `isSameBook` is type-agnostic. That is unchanged behaviour and deliberate: reading the same work in another format isn't a second book for quest quotas.

**D7. The picker, the Library tab, and "Found on our shelf".**
- **`createBookSelector` stays the one shared selector** (§6.9). It gains the options `libraryCatalog`, `onlineSearch`, `onBookChanged` and `showTagsAndSeries` (Task 8 Interfaces). The dropdown shows three groups, in order:
  1. **On our shelf.** Catalogue books whose title or author contains the search text (accents folded), at most 20.
     - While loading: `Checking the household library…`.
     - When unavailable: `On our shelf unavailable` and `Retry`.
     - Hidden when signed out or without a household.
     - Picking one: `ensureShelfRecord`, then `onSelect(id)`. If any copy has an edition label and the book lacks `special-edition`, a toast suggests the tag (§6.4).
  2. **Your books.** ToS books as today. Shelf records whose library book is in a ready catalogue are left out, since they appear in group 1. So when the library is unreachable, shelf records still show here and can be linked offline.
  3. **Search online.**
     - A `Search online for "{q}"` button calls `searchBooks`. It doesn't search on each keystroke, to spare OpenLibrary and the Google key.
     - Picking a result, or `Add "{q}" without searching`, opens an inline type choice: `Audiobook`, `Ebook`, `Library book`, `Physical, not in the library yet`. That calls `addBook({ type, ... })`, then `onSelect(id)`.
- **The four call sites** (quest add form, quest edit drawer, curriculum prompt, book club) all pass the catalogue and `searchBooks`, so curriculum prompts get shelf results too (§6.9). `describeBookForQuestLink` still disables books at their quota. For a shelf result it describes the existing shelf record, if any, without creating one.
- **Tagging an in-progress shelf book:**
  - **Problem:** a shelf book on an active quest is in no Library-tab list (§6.1). `DrawerManager` opens one drawer at a time, so the book drawer can't open over the quest drawer.
  - **Fix:** the selected-book chip gets `Tags & series`. It opens an inline panel inside the selector's container, which works inside drawers. The panel holds the shared tag picker (`utils/tagPicker.js`, extracted from `LibraryController._renderTagPicker`) and the Archive series select.
  - **Saving:** it updates the record, runs `syncShelfTags`, `fillSeries` and the series membership, and calls `onBookChanged(id)`. `QuestController` uses that to re-render bonus cards with `effectiveBookTags`. Tagging stays where the player already is.
- **Library tab** (§6.3), `_includes/character-sheet/tabs/library.html`:
  - **Sections, in order:**

    | Section | Container id |
    |---|---|
    | Unsorted (hidden when empty) | `library-cards-unsorted` |
    | Audiobooks | `library-cards-audiobook` |
    | Ebooks | `library-cards-ebook` |
    | Library books | `library-cards-library-loan` |
    | Not in the library yet (hidden when empty) | `library-cards-physical` |
    | Completed, by year | `library-cards-completed` |

  - **What each list holds:** a type list shows every book of that type, newest first, each with `On a quest` or `Completed` (§6.3). Completed holds every completed book of any type, shelf included.
  - **Two spec gaps filled:**
    - **Unsorted:** spec §6.9 calls it "its own list".
    - **Not in the library yet:** spec §6.3 names no list for `physical` books, but they would otherwise be invisible until completed.
  - **`renderBooks` renders each section whose container exists, independently.** The early return that today needs all three containers is removed, and a test pins it.
  - **Removed:** the status radios, the shelf radios, the Physical TBR badge, and the drawer's status and shelf selects.
  - **The Add form:** the type choice comes first (no default; `Add Book` stays disabled until one is chosen), then search and manual entry. Its search shows `On our shelf` results with the note `Link it from a quest`, and no add button (§6.3).
  - **The drawer's type select:** offers the four pickable types. For `shelf` it shows `On our shelf`, plus `Unlink from the library`, which makes the book `physical` with `shelfMatchDismissed` set. That is how a wrong review match is undone.
- **"Found on our shelf — link it?"** (§6.9): `findShelfOffers` returns `physical` books with **exactly one** strong match (D8) that isn't their `shelfMatchDismissed`.
  - It runs on every catalogue load.
  - The card shows `Found on our shelf — link it?` with `Link` (`linkPhysicalToShelf`: converts in place, merges tags as a union, links nothing new) and `Not this one` (`dismissShelfOffer`).
  - **Never automatic.**

**D8. Matching, ported to vanilla JS (`utils/bookMatching.js`, §6.9).**
- **A line-for-line port:**
  - `baseNormalize`, `EDITION_RE`/`stripEdition`, `titleKey`, `baseTitleKey`, `authorKey` and `authorsOverlap` from `src/lib/libib/match-keys.ts` and `parse.ts`;
  - `trigramSimilarity` from `src/lib/photo/similarity.ts`;
  - the classify step of `src/lib/photo/propose.ts`.
- **Thresholds pinned:** `SIMILAR_WITH_AUTHORS = 0.5`, `SIMILAR_ANY_AUTHORS = 0.8`, `MAX_CANDIDATES = 3`.
- **Authors:** ToS keeps one string. `splitAuthorString` splits it on `;`, ` & ` and ` and ` first, then on `,`, and then:
  - rejoins name suffixes (`Jr`, `Sr`, `II`, `III`, `IV`, `PhD`, `MD`), as the library's `joinNameSuffixes` does;
  - **handles "Surname, First":** a part with exactly two comma pieces, where the first is one word and the second is one or two words or initials and not a suffix, becomes one name `First Surname`. So `"Writer, Ada"` gives `["Ada Writer"]`, and `"Ada Writer, Ben Other"` gives two names.
- **`matchToLibrary(tosBook, libraryBooks)` returns `{ strong, weak }`:**
  - `strong`: library books with `same_title` (equal non-empty `titleKey` **and** `authorsOverlap`);
  - `weak`: `series_sibling` and `similar_title` candidates, best score first, at most 3.
  - A series sibling (same base title, different volume) is **never strong**.
  - **A deliberate deviation from the library app:** a ToS book without an author is never a strong match, so a same-title hit is weak. In the library's `match-keys.ts`, `authorsOverlap([], [])` is true, so there an authorless pair with the same title is `same_title`. The port keeps `authorsOverlap` exactly as it is (the copied vectors pin it). `matchToLibrary` adds the rule `strong requires a non-empty ToS author`. **Why:** a strong match is preselected and, unprotected, removes the book, and a title alone is too thin for that (spec §4, "no silent wrong match").
- **The test vectors are copied from the library's own tests** (`match-keys.test.ts`, `similarity.test.ts`), so both apps score the same pair the same way. Those fixtures are already public and synthetic. Task 6 adds boundary cases at 0.5 and 0.8.

**D9. The tidy review.**
- **Scope:** only `unsorted` books. Audiobooks were typed by the migration, and any other typed book was chosen by the player.
- **`planTidy(state, catalog)` makes one row per Unsorted book:**
  - `protected` is true when the book is linked to any quest (active, completed or discarded, by `quest.bookId` or `links.questIds`/`grandfatheredQuestIds`), or to any curriculum prompt (`links.curriculumPromptIds` or `prompt.bookId`), or is completed (`status` or `dateCompleted`), or is in any series;
  - its candidates come from `matchToLibrary`;
  - **preselected** = the single strong match when there is exactly one, else none.
- **What a decision does** (§6.5):

  | Decision | Not protected | Protected |
  |---|---|---|
  | `link` to a library book | **removed** from ToS (to `bookTidy.removedBooks`); its shared tags first merged into the library (union) | becomes `shelf` with that `libraryBookId`. `tags` = ToS ∪ library shared tags, base = the shared union; library gets ToS's shared tags (union). Links, dates and curriculum untouched |
  | `type` (Audiobook, Ebook, Library book, Physical not in the library yet) | re-typed | re-typed |
  | `drop` | removed (to `removedBooks`) | **not offered** (§6.5) |

- **Rows without a decision stay Unsorted.** Apply works in sittings, and `bookTidy.status` becomes `done` (with `completedAt`) only when no Unsorted book is left.
- **Duplicate matches:**
  - **Two strong library candidates for one book:** nothing is preselected and both are listed with their authors and cover.
  - **Two ToS books strong-matching one library book:** each row resolves on its own. Removable ones are removed; protected ones each become a shelf record (D6 allows the duplicate).
- **Postpone (§6.5, "can be postponed but not skipped forever"):**
  - there is no "never" choice;
  - while `status` isn't `done`, the Library tab shows the review panel at the top, always;
  - a banner on character-sheet load offers `Tidy your library` or `Later`. `Later` sets `status 'postponed'` and `postponedAt`, and the banner returns once `TIDY_REMIND_AFTER_DAYS = 7` have passed.
- **Signed out, no household, or library unavailable:** the simple version. There is no matching, each row offers only the four types (and `drop` when not protected), and nothing needs the network.
- **Undo:**
  - removed records are kept in `bookTidy.removedBooks`, whole except that a `data:` cover is set to `null` (`stripInlineCovers`). `bookTidy` is localStorage-backed, so a multi-MB inline cover could fill the quota, and `stripInlineImages` in `cloudSync.js` only cleans `books`, so it would also reach the cloud. An http(s) cover is kept;
  - **`removedBooks` only ever grows by id.** Every apply merges the newly removed records into the existing map (an id already there is overwritten with the newer record), and no apply ever replaces or clears the map. Only `restoreRemovedBooks` deletes entries, and only the ones it restored;
  - `Restore removed books` in the panel puts them back (by id, skipping ids already present in `books`) and returns `status` to `pending`;
  - spec §6.5 says removed books "live in the library app", and this adds the reversibility that lqt0 asks for (D10).
- **Write order on apply** (`stateAdapter.applyBookTidy(nextBooks, nextTidy)`, which is **async**):
  1. `setBookTidy(nextTidy)`, checking `safeSetJSON`'s return value. It returns `false` on a full quota without throwing. If the write fails, apply stops with `blocked 'storage'` **before `books` is touched**;
  2. `await setStateKey(BOOKS, nextBooks)`. This doesn't use `_persistBooks`, which fires `void setStateKey` without waiting. If the write rejects, apply stops with `blocked 'storage'`. Removed records then sit in `removedBooks` while still in `books`, which is the interrupted case below;
  3. update `characterState` and emit one `BOOKS_CHANGED`.

  The push (D10 step 5) runs only after both writes have resolved, because `buildLocalSnapshot` reads from storage, not RAM.
- **An interrupted apply.** If the tab dies between the two writes, the books are still in `books` and still Unsorted. The next apply puts them into `removedBooks` by id again (no duplicate), and restore skips ids that exist (Review Focus 3).
- **The status heals itself.** On every load, after validation, `healTidyStatus(state)` sets `bookTidy.status` back to `pending` (keeping `postponedAt`) when any book is Unsorted, even if the stored status is `done`. An interrupted apply, a restore elsewhere, or an older snapshot can therefore never hide the review for good. It writes only when the status actually changes.

**D10. Sync safety, and compatibility with lqt0.**
- **The migration never shrinks a save.** v20 removes no book, so its first auto-push differs in shape but not in count.
- **Only the review removes books, and it never does so through auto-sync.** `applyTidy` runs inside `runExclusiveSync` (Task 5).
  - **The lock covers every tab, not just one.** `runExclusiveSync` takes the Web Locks API lock `navigator.locks.request('tos-cloud-sync', …)` when `navigator.locks` exists. Without it (old browsers, jsdom) it falls back to an in-tab promise queue.
  - **Who takes it:** `syncAuto`, `syncNow` and `applyTidy` all take it.
  - **Why every tab matters:** `bookTidy` is localStorage-backed, so a write to it fires a `storage` event in every other tab. `cloudAuth` then requests a sync there (`CLOUD_SYNCED_KEYS`, `cloudAuth.js` ~104-109 and ~174-179). That tab's `syncAuto` now waits for the lock instead of pushing a half-applied snapshot.

  The steps, in order:
  1. **Recheck and precheck, inside the lock.**
     - **Protection is recomputed from live state.** For every `link` or `drop` decision, `isProtected` is recomputed now. A book that gained a quest, prompt, completion or series after `planTidy` ran becomes `shelf` for a `link` decision, and its `drop` is refused with `blocked 'protected'`.
     - **The cloud precheck** (`checkReadyForDeliberateChange`) runs when the player is signed in, has a cloud save, and the decisions remove anything. The cloud must equal `lastSyncedHash`.
     - **One rule for every blocked outcome: a blocked apply writes nothing at all.** Type choices aren't saved separately. The panel keeps every choice on screen, so the player can press `Apply` again once the cause is fixed. A save made only of type choices needs no precheck, so it isn't blocked offline.
     - **The blocked reasons are a closed list**, shared by `checkReadyForDeliberateChange` and `applyTidy`: `'unsynced'` (the cloud changed since this device last synced; `Sync now` first), `'offline'`, `'newer-schema'` (D10 forward-compatibility; reload first), `'library'`, `'protected'` and `'storage'`.
  2. **Confirm in-page** (`ui/confirmDialog.js`, which follows lqt0 §4):
     - it can't be suppressed;
     - it has no default action; Escape and the backdrop cancel;
     - it states the counts: `Remove 45 books from Tome of Secrets. They stay in the household library. Your save goes from 52 to 7 books. You can restore them from this panel.`;
     - the destructive button says what it does: `Remove 45 books`.
  3. **Push the tag unions** to the library. A failure aborts, with nothing changed locally.
  4. **The local writes,** in D9's order. Both are awaited and checked before step 5.
  5. **`pushDeliberateChange(supabase, { reason: 'library-tidy', booksBefore, booksAfter })`:**
     - a manual-class push that upserts only if the cloud still equals `lastSyncedHash`;
     - it logs `tos_sync_events` `push` with detail `library-tidy: books 52→7`;
     - if it can't push, the panel says `Saved on this device. It will upload with your next sync.`
  - No sync in any tab can run between steps 1 and 5, because the cross-tab lock is held throughout.
- **Forward compatibility, which also covers the rollback case** (PR 1, before any v20 code ships). The danger isn't only `migrateState`. `state.js` `saveState` (~95-112) writes **every** key from RAM, then calls `saveSchemaVersion()` unconditionally. And `loadState` writes every `LARGE_STATE_KEY` back on load. A tab still holding v19-shaped books in RAM would overwrite a v20 save written by another tab and relabel it 19. So PR 1 adds one **write gate** to `dataValidator.js`:
  - `rememberLoadedSchemaVersion()` records the stored version when `loadState` starts. Every version this tab writes itself also updates the record;
  - `isSchemaWriteSafe()` is true only when the stored version is ≤ `SCHEMA_VERSION` **and** equals the version this tab last loaded or wrote. So only another tab's change closes it;
  - **`saveSchemaVersion` never lowers the version:** it writes only when the stored version is null or below `SCHEMA_VERSION`;
  - **`saveState` and the `loadState` writeback** do nothing when `isSchemaWriteSafe()` is false. RAM stays as it is, and the player is shown the reload banner below;
  - **sync** returns `{ action: 'blocked' }` when the write gate is closed, or when the local stored version or the cloud snapshot's version is above `SCHEMA_VERSION`. It neither pushes nor applies. The hint says `This save was made by a newer Tome of Secrets. Reload to update; cloud sync is paused until then.`;
  - `applySnapshot` refuses such a snapshot as a second guard;
  - **a `storage` listener on `tomeOfSecrets_schemaVersion`** shows an unclosable banner when another tab changes the version: `Tome of Secrets was updated in another tab. Reload this tab to keep playing.`, with a `Reload` button;
  - `migrateState` with a stored version above `SCHEMA_VERSION` returns the state untouched and skips `saveSchemaVersion`;
  - `validateBook` passes the v20 fields through (`type`, `libraryBookId`, `libraryTagsBase`, `shelfMatchDismissed`).

  So a stale tab running PR 1 or later, or a reverted deploy, can neither strip v20 fields, nor push them away, nor relabel the save v19.
- **What the gate can't reach: a tab opened before PR 1 deployed.** It runs code with no gate at all (`cloudSync.js` ~378-386 pushes whatever it holds). The only protection is procedural. **After each ToS deploy, and before the next ToS PR merges, the user reloads or closes every ToS tab on every device.** That is an explicit rollout step. It matters most between PR 1 and PR 2: the PR 1 reload is what puts the gate into every open tab before any v20 save exists.
- **How this stays compatible with lqt0** (PR #138, not built yet), point by point:
  - **Collapse definition untouched:** `LARGE_STATE_KEYS` is unchanged, and `bookTidy` is localStorage-backed. lqt0's "collapsed" definition (all IndexedDB collection keys empty), shared verbatim by `tos_snapshot_is_collapsed`, is unaffected. A tidy can't collapse a save: removal needs a matched library book, and protected books are never removed.
  - **Shrink guard satisfied:** lqt0's planned guard (`syncAuto` never pushes a shrinking collection) is already met, because the tidy's shrink never goes through `syncAuto`. Its push is a manual-class push with an explicit declaration (`reason`, `booksBefore`, `booksAfter`), the hook a future guard can honour or turn into its own confirm.
  - **Matching the dialog spec:** `confirmDialog.js` is built to lqt0 §4's dialog requirements, so lqt0 can adopt it instead of building another.
  - **`window.confirm` left alone:** this plan adds no new use of it and doesn't rewrite the existing conflict prompts; that's lqt0's job.
  - **Reversible:** removed books stay recoverable in `removedBooks` (lqt0's reversibility property).
  - **`getStateKey` untouched, and the `loadState` writeback only gated:** lqt0 owns reworking both. This plan only adds a refusal (the write gate above) to the existing writeback, and adds no new writeback path. lqt0's per-key writeback can keep the same gate as one extra condition.
  - **One lock:** lqt0's sync guards can live inside the same `tos-cloud-sync` lock.
  - **Self-heal interaction:** lqt0's planned self-heal merges IndexedDB keys from history with local localStorage keys. It could bring back pre-tidy `books` next to a post-tidy `removedBooks`. The id-based restore and the re-runnable review handle that without duplicates (Task 9 test).

**D11. PR split, order, and what users see between merges.**
- **One plan, not 4a/4b.** The PRs share the type names, the tag rules, the matching and the rollout order. Splitting the plan would mean copying those decisions into two files that could drift.

| # | Repo / branch | Contents | Users see after merge |
|---|---|---|---|
| ToS 1 | `plan4-1-groundwork` | Task 1 migration + pgTAP; Task 2 forward-compatible saves; `bookTags.json` `scope`/`derivedFromType` | Nothing. After the user's `db push`: still nothing |
| Library | `tshardey/plan-4-tos-integration` (this branch) | Tasks 11–12: tags section and filter, series picker and filter | Book page `Tome of Secrets` section (empty until tagged) and series; new filters. **Needs the `db push`** |
| ToS 2 | `plan4-2-book-types` | Tasks 3–4: v20, types, effective tags, Library tab | New Library tab: Unsorted holds most books, audiobooks are typed, the Add form asks for a type. No library connection yet; nothing removed |
| ToS 3 | `plan4-3-shelf-link` | Tasks 5–8: client/lock refactor, catalogue, matching, shelf records, tag and series sync, picker, Found on our shelf | `On our shelf` in every picker; tags flow between apps; series fill |
| ToS 4 | `plan4-4-tidy-review` | Tasks 9–10: review service and screen, confirm dialog, deliberate push, restore | The tidy banner and review |

- **Merge order:** ToS 1 → `db push` → Library → ToS 2 → ToS 3 → ToS 4. The Library PR may also merge any time after the push; it doesn't depend on ToS 2–4.
- **Rollback matrix:**
  - **Library PR deployed before the `db push`:** the catalogue still loads, because tags come from their own query (Task 11). The tags section shows `Tome of Secrets tags unavailable`, and saving a series fails with `Couldn't save the series.` Fixed by the push; nothing is written wrongly.
  - **Library PR deployed before ToS 2–4:** tags typed in the library app wait in the table, and ToS 3 picks them up when shelf records are linked.
  - **Library PR deployed after ToS 3:** ToS writes tags; the library shows them once deployed.
  - **Library PR reverted:** ToS is unaffected; the table and columns stay.
  - **ToS 2 reverted after players migrated:** PR 1's guard keeps the v20 fields and version, and pauses cloud sync with the "newer Tome of Secrets" hint until v20 is redeployed. `'other'` books display as Reading; nothing is lost.
  - **ToS 3 reverted:** shelf records are plain books of type `shelf`, which ToS 2 code already renders (Completed, or reachable from their quest). Tags and series stop syncing.
  - **ToS 4 reverted:** applied tidies are just data, and `removedBooks` stays in the save.

**D12. Two players.** Each player has their own `tos_saves` row, their own shelf records, their own review and their own reader tags. They share library books and shared tags. A tag one player adds through ToS or the library app reaches the other's shelf record on their next refresh, by the three-way merge. Neither player's review touches the other's save. Task 7 runs both saves against one fake library; Task 13 runs it on the local stack.

## Review Focus

Each has a test in the named task.

1. **A stale tab or a reverted build meets a v20 save.** Fields kept, stored version not lowered, no push, no apply, and the hint shown. *(Task 2.)*
2. **A library refresh that changes nothing** must not write the save. Otherwise every page load would emit `tos:localStateChanged` and push. *(Task 7: a `setStateKey` spy is never called.)*
3. **The tab is closed between the `bookTidy` write and the `books` write of an apply.** Reopening shows the books still Unsorted; applying again and restoring both leave exactly one record per id. *(Task 9.)*
4. **A shelf book whose library row was deleted.** It keeps working, says `No longer in the household library`, is never removed, isn't offered as a shelf result, and its tags aren't pushed. *(Task 7, Task 8.)*
5. **The player has left the household, or RLS answers `42501`.** The catalogue goes `no-household` with no retry loop, shelf records keep their fields, and pending tag diffs stay pending in `libraryTagsBase` terms. *(Task 5, Task 7.)*

---

### Task 1: ToS — `library.book_tags` and series columns (ToS PR 1, part 1)

**Files (new ToS worktree):**
- Create: `supabase/migrations/<timestamp>_library-book-tags-series.sql`, named by `migration new`
- Create: `supabase/tests/database/library_book_tags_series.test.sql`

Set up the worktree. Fetching doesn't edit the main checkout:
```
git -C C:/Users/tierr/Github/tome-of-secrets fetch origin
git -C C:/Users/tierr/Github/tome-of-secrets worktree add C:/Users/tierr/Github/tome-of-secrets-plan4 -b plan4-1-groundwork origin/main
```
- **First:** load the `supabase:supabase` and `supabase:supabase-postgres-best-practices` skills.
- **Before `start`:** run `docker ps --filter name=supabase`. If a local stack from another ToS worktree is running, **don't stop it yourself.** Ask the coordinator (`orca orchestration ask`, or the user when not under Orca), and wait for a yes before running `npx supabase@2.122.1 stop --workdir <that wt>`. Another agent or the user may be using it.
- Copy `_config.supabase.yml.example` to `_config.supabase.yml` with the local stack's URL and publishable key from `npx supabase@2.122.1 status --workdir <tos-wt>` (git-ignored).

**Interfaces — Produces:** exactly the SQL in D4 and D5, plus:
- RLS: `book_tags_select_member`, `book_tags_insert_member` and `book_tags_delete_member`, each `to authenticated` with `library.is_member(household_id)`;
- the index `book_tags_household_id_idx (household_id)`;
- `revoke all on library.book_tags from public, anon, authenticated; grant select, insert, delete ... to authenticated`.

It is idempotent like the earlier library migrations: `add column if not exists`, `create table if not exists`, `drop constraint if exists` before each `add constraint` (the series checks), and `drop policy if exists`.

**One exception: `books_id_household_key`.** The `book_tags` foreign key depends on it, so on a rerun `drop constraint if exists books_id_household_key` fails with `2BP01` (dependent objects). Add it instead in a guard:

```sql
do $$ begin
  if not exists (select 1 from pg_constraint
                  where conname = 'books_id_household_key' and conrelid = 'library.books'::regclass) then
    alter table library.books add constraint books_id_household_key unique (id, household_id);
  end if;
end $$;
```

The `book_tags` table's own constraints are inline in `create table if not exists`, so they need no drop.

- [ ] **Step 1: Write the failing pgTAP test**, in the setup style of `library_scan_intake.test.sql`. Users A (in households H1 and H2) and B (in neither). `test_vals`. Invented titles only. One assertion each:
  - **Schema:**
    - `has_table('library','book_tags')`;
    - `has_column` for `series_name` and `series_volume`;
    - `col_is_pk` on `(book_id, tag_id)`;
    - the unique constraint `books_id_household_key` exists;
    - RLS is enabled on `book_tags`: `select relrowsecurity from pg_class where oid = 'library.book_tags'::regclass` is true.
  - **Member writes:**
    - A inserts `('fantasy')` on an H1 book with `household_id = H1`: `lives_ok`;
    - the same row again throws `23505`;
    - `upsert ... on conflict do nothing` changes 0 rows;
    - A deletes it: 1 row.
  - **Checks:**
    - `'Fantasy'`, `''`, `'-x'`, `'a--b'` and a 41-character id throw `23514`;
    - `'audio'` throws `23514` (`book_tags_not_type_derived`);
    - an H1 book with `household_id = H2` throws `23503` (the composite foreign key).
  - **Cascade:** deleting the book deletes its tags.
  - **Series:**
    - `' Saga'`, `''` and a 201-character name throw `23514`;
    - volume `-1` and `10000` throw `23514`; `2.5` is stored as `2.50`;
    - the fill update `... set series_name = 'Second' where id = $1 and series_name is null` on a book already named `First` changes 0 rows, and the name stays `First`.
  - **Non-members:**
    - B: `select` on A's tags `is_empty`;
    - B: insert on A's book throws `42501`;
    - B: delete of A's tag changes 0 rows;
    - B: the series update on A's book changes 0 rows;
    - anon: `select` on `book_tags` throws permission denied.
  - **No update grant:** A's `update library.book_tags set tag_id = 'cozy'` throws `42501`.
- [ ] **Step 2: Run it to verify it fails.** `npx supabase@2.122.1 start --workdir <tos-wt>`, then `npx supabase@2.122.1 test db --workdir <tos-wt>`. Expected: FAIL, `relation "library.book_tags" does not exist`.
- [ ] **Step 3: Create the migration** with `npx supabase@2.122.1 migration new library-book-tags-series --workdir <tos-wt>`, then write it per D4, D5 and Interfaces.
- [ ] **Step 4: Verify.**
  - `npx supabase@2.122.1 db reset --workdir <tos-wt>`, then `test db`. Expected: all five library test files pass, the four existing ones unchanged.
  - **Rerun:** apply the new migration file a second time to the local database: `psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -v ON_ERROR_STOP=1 -f supabase/migrations/<timestamp>_library-book-tags-series.sql`, using the DB URL from `status`. Expected: no error. Then run `test db` again: still green.
  - `npx supabase@2.122.1 db advisors --local --workdir <tos-wt>` (check `--help` for the flags first). Expected: no new `library` findings.
- [ ] **Step 5: Review and commit.** A subagent reviews the migration diff for: a policy that tests the wrong household, a missing revoke, a path that writes `audio`, and series checks that reject valid values. Commit `feat(library): shared Tome of Secrets tags and book series`. Don't push yet (Task 2 completes the PR).

### Task 2: ToS — forward-compatible saves and tag-scope data (ToS PR 1, part 2)

**Files:**
- Modify: `assets/js/character-sheet/dataMigrator.js` (`migrateState`), `assets/js/character-sheet/dataValidator.js` (`validateBook`, `saveSchemaVersion`, the write gate), `assets/js/character-sheet/state.js` (`loadState` start and writeback, `saveState`), `assets/js/services/cloudSync.js`, `assets/js/auth/cloudAuth.js` (the `blocked` hint), `assets/js/character-sheet.js` (the version `storage` listener and reload banner), `assets/data/bookTags.json`, `tests/bookTags.test.js`
- Create: `tests/forwardCompat.test.js`

**Interfaces — Produces:**
```js
// dataValidator.js (D10 write gate)
export function rememberLoadedSchemaVersion() // called first thing in loadState; records getStoredSchemaVersion()
export function isSchemaWriteSafe() /* -> boolean: stored <= SCHEMA_VERSION && stored === remembered (null === null ok) */
// saveSchemaVersion(): writes only when stored is null or < SCHEMA_VERSION; returns false otherwise (never lowers).
//   When it writes, it also updates the remembered version, so this tab's own migration (loadState, applySnapshot)
//   keeps the gate open; only a change made by ANOTHER tab closes it.
// state.js: saveState(form) and the loadState writeback return early, writing nothing, when !isSchemaWriteSafe(),
//   and dispatch 'tos:schemaChangedElsewhere' once
// character-sheet.js: window 'storage' listener for key 'tomeOfSecrets_schemaVersion' (and the event above) shows
//   the unclosable banner "Tome of Secrets was updated in another tab. Reload this tab to keep playing." + Reload
// cloudSync.js
export function schemaGate(localVersion /* number|null */, remoteVersion /* number|null */)
  // -> 'ok' | 'local-newer' | 'remote-newer'   (newer = > SCHEMA_VERSION)
// syncNowWithOptions: when schemaGate(...) !== 'ok' or !isSchemaWriteSafe() -> returns { action: 'blocked', detail: <D10 hint> }
//   before any upsert, applySnapshot or confirm prompt.
// applySnapshot(snapshot): throws Error('newer_schema') when snapshot.version > SCHEMA_VERSION, before any write.
// validateBook: if present and well-typed, passes through type (string in the D2 list), libraryBookId (string),
//   libraryTagsBase (string[]), shelfMatchDismissed (string); otherwise omits them. No other change.
// bookTags.json: "derivedFromType": "audiobook" on audio; "scope": "reader" on the D3 list.
```

- [ ] **Step 1: Write the failing tests** in `tests/forwardCompat.test.js`. Use `SCHEMA_VERSION + 1` everywhere, so the tests stay valid after Task 3:
  - **Version never lowered:** with `localStorage` version `SCHEMA_VERSION + 1`, `migrateState(state)` returns `state` unchanged and the stored version is still `SCHEMA_VERSION + 1`.
  - **`saveSchemaVersion`** with a stored `SCHEMA_VERSION + 1` returns false and leaves it; with a stored `SCHEMA_VERSION - 1` or none it writes `SCHEMA_VERSION`.
  - **`saveState` in this build, with a stored newer version (C1):** with a stored `SCHEMA_VERSION + 1` and v19-shaped books in `characterState`, `saveState(form)`:
    - calls `setStateKey` zero times and `safeSetJSON` for the form zero times;
    - leaves the stored version at `SCHEMA_VERSION + 1`;
    - dispatches `tos:schemaChangedElsewhere`.
  - **Another tab migrated mid-session:** `loadState` with a stored `SCHEMA_VERSION`; then another tab sets the stored version to `SCHEMA_VERSION + 1`; then `saveState` writes nothing. The same holds when the stored version changes from null to `SCHEMA_VERSION` after load.
  - **`loadState` writeback:** with a stored newer version, `loadState` populates `characterState` and calls `setStateKey` zero times.
  - **Own migration keeps the gate open:** a `loadState` from a stored `SCHEMA_VERSION - 1` migrates, stores `SCHEMA_VERSION`, writes back normally, and a following `saveState` writes. The same holds after `applySnapshot` of an older snapshot.
  - **Sync blocked by the write gate:** with `isSchemaWriteSafe()` false, `syncAuto` returns `'blocked'` with no upsert and no apply.
  - **Banner:** a `storage` event for `tomeOfSecrets_schemaVersion` shows the reload banner, which has no close button.
  - **Fields survive validation:** `validateCharacterState` keeps a book's `type: 'shelf'`, `libraryBookId`, `libraryTagsBase: ['fantasy']` and `shelfMatchDismissed`, and drops `type: 7` and `libraryTagsBase: 'x'`.
  - **Sync blocked:**
    - `syncNow` with a remote snapshot at `SCHEMA_VERSION + 1` returns `action 'blocked'`; the mocked `upsert` isn't called and no `setStateKey` runs;
    - `syncAuto` with the local stored version at `SCHEMA_VERSION + 1` and an older remote returns `'blocked'`, with no upsert;
    - `schemaGate(SCHEMA_VERSION, SCHEMA_VERSION)` is `'ok'`, and `schemaGate(null, null)` is `'ok'`.
  - **`applySnapshot`** of a `SCHEMA_VERSION + 1` snapshot rejects with `newer_schema` and writes nothing.
  - **`bookTags.test.js`:**
    - `scope` is absent or `'reader'`;
    - `derivedFromType` is absent or one of `['audiobook']`;
    - `audio` has `derivedFromType 'audiobook'`;
    - **no assertion names the reader-scoped ids** (D3: the list is a data edit only).
- [ ] **Step 2: Run to verify failure.** `docker compose -p tos-plan4 run --rm dev npm test -- forwardCompat bookTags`. Expected: FAIL.
- [ ] **Step 3: Implement** per Interfaces and D10. `cloudAuth` shows `result.detail` as the hint for `blocked`, and the auto-sync path shows it once, like `manual_required`. Run `node scripts/generate-data.js` inside the dev container, then `npm run validate-data`.
- [ ] **Step 4: Verify.** The full `docker compose -p tos-plan4 run --rm dev npm test` and `npm run validate-data`. Expected: green.
- [ ] **Step 5: Review, commit, PR.**
  - **Review:** a subagent reviews the diff against D10 and EXTENDING's validator rules.
  - **Commit:** `feat(sync): never downgrade or overwrite a save from a newer schema`.
  - **Push** `plan4-1-groundwork` and open a PR against `main`, left unmerged. The body states:
    - the migration and its tests;
    - that nothing changes for players;
    - that production needs the user-approved `db push`;
    - that this PR must merge before every other Plan 4 PR;
    - that after it deploys, every open ToS tab on every device must be reloaded or closed before ToS PR 2 merges (D10).

### Task 3: ToS — book types, effective tags and schema 20 (ToS PR 2, part 1)

**Branch:** `git -C <tos-wt> checkout -b plan4-2-book-types plan4-1-groundwork`.

**Files:**
- Create: `assets/js/utils/bookTypes.js`, `assets/js/utils/bookTagRules.js`, `tests/schema20Migration.test.js`, `tests/bookTagRules.test.js`
- Modify: `dataValidator.js` (`SCHEMA_VERSION = 20` with its doc line, `validateBook`, `validateBookTidy`, `validateCharacterState`), `dataMigrator.js` (`migrateToVersion20`, `case 20`, the `loadAndMigrateState` key list), `storageKeys.js` (`BOOK_TIDY: 'bookTidy'`, in `CHARACTER_STATE_KEYS` and the empty state), `utils/storage.js` (event allowlist), `stateAdapter.js` (`addBook`, `updateBook`, `getBook`/`getBooks` with the `shelfCategory` defaulting removed, `getBooksByType`, `getBookTidy`/`setBookTidy`, `getSeriesProgressSummary`), `services/RewardCalculator.js` (~286), `controllers/QuestController.js` (~1753, ~1789), `controllers/LibraryController.js` (`_renderTagPicker` skips type-derived ids)

**Interfaces — Produces:**
```js
// utils/bookTypes.js
export const BOOK_TYPES = ['unsorted','shelf','audiobook','ebook','library-loan','physical'];
export const PICKABLE_TYPES = ['audiobook','ebook','library-loan','physical'];
export const BOOK_TYPE_LABELS = { unsorted: 'Unsorted', shelf: 'On our shelf', audiobook: 'Audiobook',
  ebook: 'Ebook', 'library-loan': 'Library book', physical: 'Physical, not in the library yet' };
export function deriveBookType(book) /* -> one of BOOK_TYPES (D2) */
// utils/bookTagRules.js (reads data.bookTags)
export function effectiveBookTags(book) /* -> string[] */
export function isTypeDerivedTag(id), isSharedTag(id), sharedTags(ids), readerTags(ids)
// stateAdapter
addBook({ ..., type, libraryBookId, libraryTagsBase, shelfMatchDismissed }) // status 'reading'|'completed'; no shelfCategory
updateBook(id, { ..., type, libraryBookId, libraryTagsBase, shelfMatchDismissed })
getBooksByType(type) -> Book[]
getBookTidy() -> BookTidy; setBookTidy(next) -> BookTidy   // localStorage via safeSetJSON, emits BOOK_TIDY_CHANGED
```

- [ ] **Step 1: Write the failing tests.**
  - **`schema20Migration.test.js`**, on a v19 fixture with:
    - a book tagged `['audio','fantasy']`;
    - an `'other'` book with `shelfCategory 'physical-tbr'`;
    - a completed book linked to two quests with `grandfatheredQuestIds`;
    - a book in a series;
    - a book linked to a curriculum prompt.

    Assertions:
    - the audio book is `type 'audiobook'` with tags `['fantasy']`; every other book is `'unsorted'`;
    - no book has `shelfCategory`; `'other'` became `'reading'`;
    - the book count, every `links`, `dateCompleted`, `series.bookIds` and curriculum link are unchanged (deep-equal apart from the D2 fields);
    - `bookTidy.status` is `'pending'`, and a fixture with only audio-tagged books gives `'done'`;
    - **offline and clockless:** with `global.fetch` and `Date.now` replaced by functions that throw, the migration still passes, and two runs on the same input are deep-equal;
    - **idempotent:** migrating v20 output again changes nothing;
    - **the seam:** `validateCharacterState(migrateState(v19, { fromVersion: 19 }))` keeps all of the above;
    - **cloud snapshot:** `applySnapshot` of a v19 snapshot (mocked persistence, as in `cloudSync.test.js`) writes `books` with types per the rule and `bookTidy` pending, and `saveSchemaVersion` records 20;
    - `deriveBookType({ type: 'shelf' })` with no `libraryBookId` is `'unsorted'`.
  - **`bookTagRules.test.js`:**
    - `effectiveBookTags({ type: 'audiobook', tags: ['fantasy'] })` is `['fantasy','audio']` in any order;
    - an ebook adds nothing;
    - `sharedTags(['fantasy','re-read','audio'])` is `['fantasy']`;
    - `readerTags` of the same list is `['re-read']`;
    - **equivalence (D3):** for a fixture holding every `bookTags.json` id spread over v19 books, `new Set(effectiveBookTags(migrated))` equals `new Set(v19.tags)` for every book.
  - **Rewards at the seam:**
    - `RewardCalculator._buildQuestCompletedPayload` for a quest whose book is an audiobook without a stored `audio` tag has `audio` in `payload.tags`;
    - an item with `tagMatch [["audio"]]` (a test-only catalog entry) applies to it;
    - `classifyBonusCardState` with `effectiveBookTags` returns `'auto-applied'`.
  - **Series:** `getSeriesProgressSummary` counts a not-completed series book as in progress only when an **active** quest links it; an unlinked one counts as neither.
- [ ] **Step 2: Run to verify failure.** `docker compose -p tos-plan4 run --rm dev npm test -- schema20Migration bookTagRules RewardCalculator`. Expected: FAIL.
- [ ] **Step 3: Implement** per D2, D3 and Interfaces. Fix any existing test that constructs `shelfCategory` or `status 'other'` by updating its expectation to the v20 shape, and list each such file in the commit body.
- [ ] **Step 4: Verify.** The full suite plus `npm run validate-data`. Expected: green.
- [ ] **Step 5: Commit** `feat(library): book types and schema 20 (audiobook replaces the audio tag)`, after a subagent review of the diff for fields the validator would drop and for tag reads that bypass `effectiveBookTags` (`grep -rn "\.tags" assets/js`).

### Task 4: ToS — the Library tab rework (ToS PR 2, part 2)

**Files:**
- Modify: `_includes/character-sheet/tabs/library.html`; the book edit drawer markup (the include that defines `book-edit-status`; find it with `grep -rln book-edit-status _includes`); `controllers/LibraryController.js`; the stylesheet that defines `.library-cards-grid` (`grep -rln library-cards-grid assets/css`)
- Test: `tests/libraryController.test.js`, `tests/libraryRendererProgress.test.js` (extend)

**Interfaces:**
- Consumes: Task 3's `BOOK_TYPES`, `PICKABLE_TYPES`, `BOOK_TYPE_LABELS`, `getBooksByType`, `effectiveBookTags`.
- Produces:
  - the D7 container ids;
  - Add-form radios `name="library-add-type"`, with values from `PICKABLE_TYPES`;
  - the drawer select `#book-edit-type`;
  - `LibraryController.renderBooks()` renders every present section independently;
  - `LibraryController.renderBookCard(book)`, the extracted `_renderCardList` item, which Task 8 reuses for the offer line.

- [ ] **Step 1: Write the failing tests:**
  - **Placement:** with all six containers, an audiobook appears in `library-cards-audiobook`, an unsorted book in `library-cards-unsorted`, and a completed ebook in both `library-cards-ebook` (badge `Completed`) and `library-cards-completed` under its year.
  - **Early return gone:** with only `library-cards-completed` and `library-cards-ebook` in the DOM, both still render.
  - **Empty sections:** an empty Unsorted section and an empty `physical` section are hidden; an empty Audiobooks section shows `None`.
  - **Add form:**
    - `Add Book` is disabled until a type radio is checked;
    - checking `ebook` and adding calls `addBook` with `type 'ebook'` and no `status` or `shelfCategory` key;
    - the markup has no `library-add-status`, `library-add-shelf-category` or `Physical TBR` text.
  - **Edit drawer:**
    - the drawer of an unsorted book offers `Unsorted` plus the four pickable types;
    - saving `audiobook` calls `updateBook` with `type 'audiobook'`;
    - the drawer of a `shelf` book shows `On our shelf` and no type options.
  - **Tag picker:** it renders no `audio` checkbox, and the `re-read` label has the note `just you`.
  - **Mark complete:** `✓` still calls `markBookComplete`, and the card moves to Completed.
- [ ] **Step 2: Run to verify failure.** `docker compose -p tos-plan4 run --rm dev npm test -- libraryController libraryRenderer`. Expected: FAIL.
- [ ] **Step 3: Implement.** Reuse the existing `rpg-panel`, `library-books-section`, `library-section-title` and badge classes, and add only the badge variants the new types need. The Unsorted section's note reads `Sort these once the tidy-up is available, or set a type from each book's ✏ button.`
- [ ] **Step 4: Verify.**
  - The full suite.
  - `docker compose -p tos-plan4 up jekyll`, then open the Library tab against a migrated save. Expected: the sections, the Add form and the drawer per D7, and no console errors.
- [ ] **Step 5: Review, commit, PR.**
  - **Review:** a subagent reviews the Task 3 + 4 diff.
  - **Commit:** `feat(library): type-based Library tab (Unsorted, Audiobooks, Ebooks, Library books, Completed)`.
  - **Push** and open a PR with base `plan4-1-groundwork`, left unmerged. The body says:
    - what players see (D11);
    - that it is safe offline;
    - that nothing is removed;
    - that it needs ToS PR 1 merged first.

### Task 5: ToS — shared client, sync lock and `LibraryCatalogService` (ToS PR 3, part 1)

**Branch:** `git -C <tos-wt> checkout -b plan4-3-shelf-link plan4-2-book-types`.

**Files:**
- Create: `assets/js/services/supabaseClient.js`, `assets/js/services/syncLock.js`, `assets/js/services/LibraryCatalogService.js`, `tests/libraryCatalogService.test.js`, `tests/syncLock.test.js`
- Modify: `assets/js/auth/cloudAuth.js` (uses `getSupabaseClient` and `runExclusiveSync`; the local `syncInProgress` and its 100 ms polling loop are replaced)

**Interfaces — Produces:**
```js
export function getSupabaseClient() /* -> Promise<SupabaseClient|null>, memoized; null when not configured */
export const SYNC_LOCK_NAME = 'tos-cloud-sync';
export function runExclusiveSync(fn) /* -> Promise<T>; navigator.locks.request(SYNC_LOCK_NAME, fn) when available
                                       (cross-tab), else an in-tab promise queue; syncAuto, syncNow, applyTidy use it */
export function isSyncRunning() /* -> boolean */
export const LIBRARY_TIMEOUT_MS = 4000, LIBRARY_WRITE_TIMEOUT_MS = 8000,
             CATALOG_TTL_MS = 600000, RETRY_AFTER_MS = 60000;
export class LibraryCatalogService {
  constructor({ getClient = getSupabaseClient, now = Date.now, setTimer = setTimeout } = {})
  async getCatalog({ force = false } = {}) // never throws ->
    // { status: 'signed-out'|'no-household'|'unavailable'|'ready', userId, householdId,
    //   books: LibraryBook[], tagsAvailable: boolean, fetchedAt: number|null, reason?: string }
  peek()                                     // last result or null, synchronous
  subscribe(fn) /* -> unsubscribe; fn(result) after each completed load */
  async readBookTags(libraryBookId)          // -> string[]; throws LibraryUnavailableError
  async addTags(libraryBookId, householdId, tagIds)   // upsert, ignoreDuplicates; throws LibraryUnavailableError
  async removeTags(libraryBookId, tagIds)    // throws LibraryUnavailableError
  async fillSeries(libraryBookId, name)      // -> 'filled'|'kept'; throws LibraryUnavailableError
}
// LibraryBook = { id, title, authors: string[], coverUrl, pageCount, seriesName, seriesVolume,
//                 editionLabels: string[] /* distinct trimmed non-empty copies.edition_note */, tags: string[] }
export class LibraryUnavailableError extends Error { /* .reason: 'timeout'|'network'|'denied'|'error' */ }
export const libraryCatalog = new LibraryCatalogService();
```

- [ ] **Step 1: Write the failing tests** with a fake client: a chainable stub whose `schema('library').from(t)` records calls and resolves per table. First confirm that `schema` exists on 2.49.1 by reading the CDN build's type declaration (`https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.49.1/dist/module/SupabaseClient.d.ts`), and note the result in the commit body.
  - **No session:** gives `signed-out` with **zero** `from` calls.
  - **No membership row:** gives `no-household`.
  - **Two memberships:** the household query orders by `created_at` ascending with `limit(1)`.
  - **Ready:** `books` (`select` names `id, title, authors, cover_url, page_count, series_name, series_volume, copies(edition_note)`) and `book_tags` (`select book_id, tag_id`, `eq household_id`) map to `LibraryBook`, with `editionLabels` deduped and trimmed.
  - **Tags query fails:** gives `ready` with `tagsAvailable false` and empty `tags`.
  - **Unreachable (Review Focus 5, spec §6.7):**
    - a `books` promise that never resolves gives `unavailable` / `timeout` at 4000 ms (fake timers), and `getCatalog` resolves, never rejects;
    - a call within 60 s afterwards returns the cached `unavailable` with no new request; `force: true` retries.
  - **`42501` on the books read:** gives `no-household` and no retry before 60 s.
  - **TTL:** a second `getCatalog` within 10 min makes no request; after 10 min it does; `subscribe` fires once per load.
  - **Writes:**
    - `fillSeries` sends `update({ series_name })` with `.eq('id', id).is('series_name', null)`, and returns `'kept'` when 0 rows come back (`select('id')`);
    - `fillSeries('L', '  Saga  ')` sends `'Saga'`; a 250-character name is sent clipped to 200; a blank name makes no request;
    - a `23514` error returns `'kept'` and isn't retried on the next refresh.
    - `addTags` sends `upsert(rows, { onConflict: 'book_id,tag_id', ignoreDuplicates: true })`;
    - a write timeout at 8000 ms throws `LibraryUnavailableError('timeout')`.
  - **`syncLock`:** two `runExclusiveSync` calls run in order and never overlap; `isSyncRunning` is true only inside.
  - **Two tabs (I2):** install a fake `navigator.locks` that one shared object backs (a mutex keyed by name) and load the module twice with `jest.isolateModules`, standing for two tabs. Tab 1 holds the lock in a never-yet-resolved `applyTidy`-like fn. Tab 2 gets a `storage` event for `bookTidy`, which `cloudAuth` turns into `syncAuto`. Then:
    - tab 2's `upsert` isn't called until tab 1 releases;
    - when it runs, it builds its snapshot after the release, which the test verifies by having tab 1 write a marker before releasing.
  - **Fallback:** without `navigator.locks`, the in-tab queue is used and the existing tests pass.
  - **Paging (I7):**
    - the `book_tags` query orders by `book_id`, then `tag_id`, and `books` by `id`;
    - with 2,500 tag rows over three pages it returns them all;
    - if the second tag page errors, the result has `tagsAvailable false` and every book's `tags` empty, never a partial set.
  - **`cloudAuth`:** the existing `cloudSync`/`eventDrivenSync` tests still pass, and a manual sync started during an auto-sync waits for it.
- [ ] **Step 2: Run to verify failure.** `docker compose -p tos-plan4 run --rm dev npm test -- libraryCatalogService syncLock`. Expected: FAIL.
- [ ] **Step 3: Implement** per Interfaces and D1. Catalogue rows are read with `.range()` pages of 1000 until a page comes back empty, as the library app's `readAllPages` does, with the stable ordering in D1. `cloudAuth`'s auto and manual sync both go through `runExclusiveSync`. The `fillSeries` "never retried" rule is kept as an in-memory `Set` of library book ids per page.
- [ ] **Step 4: Verify.** The full suite. Expected: green.
- [ ] **Step 5: Commit** `feat(library): household library catalogue service with timeouts`.

### Task 6: ToS — matching ported from the library app (ToS PR 3, part 2)

**Files:**
- Create: `assets/js/utils/bookMatching.js`, `tests/bookMatching.test.js`

**Interfaces — Produces:**
```js
export const SIMILAR_WITH_AUTHORS = 0.5, SIMILAR_ANY_AUTHORS = 0.8, MAX_CANDIDATES = 3;
export function baseNormalize(s), titleKey(title), baseTitleKey(title), authorKey(name),
                authorsOverlap(a /* string[] */, b /* string[] */), trigramSimilarity(a, b),
                splitAuthorString(author /* string */) /* -> string[] */;
export function classifyLibraryMatch(tosBook /* {title, author} */, libraryBook /* {title, authors} */)
  // -> { reason: 'same_title'|'series_sibling'|'similar_title', score } | null
export function matchToLibrary(tosBook, libraryBooks)
  // -> { strong: LibraryBook[], weak: Array<{ book: LibraryBook, reason, score }> }  (D8)
```

- [ ] **Step 1: Write the failing tests:**
  - **Library vectors:** every case in the library's `src/lib/libib/match-keys.test.ts` and `src/lib/photo/similarity.test.ts`, copied with the same inputs and expected values (`titleKey`, `baseTitleKey`, `authorKey`, `authorsOverlap`, `trigramSimilarity`).
  - **Pinned thresholds:**
    - a pair constructed to score exactly 0.5 with overlapping authors is `similar_title`; one just below 0.5 is null;
    - with disjoint authors, 0.8 is `similar_title` and just below is null.
  - **Strong vs weak:**
    - `"The Salt Road (Anniversary Edition)"` / `"A. Writer"` against library `"Salt Road"` / `["A. Writer"]` is strong;
    - `"Salt Road: Book Two"` against `"Salt Road: Book One"` with the same author is weak `series_sibling`, never strong;
    - a ToS book without an author against a same-title library book is weak.
  - **The deliberate deviation (D8):**
    - `authorsOverlap([], [])` is still `true` (the copied vector);
    - but a ToS book with author `""` against a same-title library book with `authors: []` is weak `similar_title` (score 1), not strong.
  - **`splitAuthorString`:**
    - `"A. Writer & B. Other"` gives two names;
    - `"Writer, Jr."` gives `["Writer, Jr."]`;
    - `"A. Writer and B. Other"` gives two;
    - `"Writer, Ada"` gives `["Ada Writer"]`, and is a strong match for a library book by `"Ada Writer"`;
    - `"Writer, A. B."` gives `["A. B. Writer"]`;
    - `"Ada Writer, Ben Other"` gives two names.
  - **Ranking:** `weak` is sorted by score descending and capped at 3; two equal strong matches are both returned.
- [ ] **Step 2: Run to verify failure.** `npm test -- bookMatching`. Expected: FAIL.
- [ ] **Step 3: Implement** as a line-for-line port. Comments name the TypeScript source of each function.
- [ ] **Step 4: Verify.** The same command, then the full suite.
- [ ] **Step 5: Commit** `feat(library): title and author matching ported from the library app`.

### Task 7: ToS — shelf records, tag and series sync, Found on our shelf (ToS PR 3, part 3)

**Files:**
- Create: `assets/js/services/ShelfBookService.js`, `tests/shelfBookService.test.js`
- Modify: `assets/js/character-sheet.js` (start library sync after `loadState`), `stateAdapter.js` (if a helper is needed for the oldest-record lookup)

**Interfaces:**
- Consumes: Task 5's `libraryCatalog` and `LibraryBook`; Task 6's `matchToLibrary`; Task 3's `sharedTags`, `readerTags` and `updateBook`.
- Produces:

```js
export function mergeShelfTags({ local, base, library }) // pure -> { merged, toAdd, toRemove }  (D4)
export function ensureShelfRecord(stateAdapter, libraryBook) /* -> bookId */            // D6
export function findShelfRecord(stateAdapter, libraryBookId) /* -> Book|null (oldest) */
export async function syncShelfTags(stateAdapter, bookId, service = libraryCatalog) /* -> 'synced'|'pending' */
export async function refreshShelfRecords(stateAdapter, catalog, service = libraryCatalog) /* -> { changed: number } */
  // per shelf record whose library book is in catalog.books: copy metadata (D6), merge tags when
  // catalog.tagsAvailable and push diffs, fillSeries when in a ToS series; one updateBook per changed record only
export function findShelfOffers(stateAdapter, catalog) /* -> Array<{ bookId, libraryBook }> */   // D7
export async function linkPhysicalToShelf(stateAdapter, bookId, libraryBook, service = libraryCatalog) /* -> bookId */
export function dismissShelfOffer(stateAdapter, bookId, libraryBookId)
export function unlinkFromLibrary(stateAdapter, bookId)
export function isLibraryMissing(book, catalog) /* -> boolean: ready && tagsAvailable && no catalog book with that id */
export function startLibrarySync(stateAdapter, { onOffers }) // getCatalog after load; on visibilitychange when stale; on subscribe
```

- [ ] **Step 1: Write the failing tests.** Use an in-memory fake library: books, a tags `Set` per book, and switches to fail or time out. Use real `StateAdapter`s over in-memory state, with persistence mocked as in `stateAdapter.test.js`.
  - **`mergeShelfTags`:**
    - **local add** (base `[f]`, local `[f,c]`, library `[f]`): merged `[f,c]`, toAdd `[c]`;
    - **local remove** (base `[f,c]`, local `[f]`, library `[f,c]`): toRemove `[c]`;
    - **library add** (base `[f]`, local `[f]`, library `[f,e]`): merged `[f,e]`, no diffs;
    - **library remove** (base `[f,e]`, local `[f,e]`, library `[f]`): merged `[f]`;
    - **both, disjoint** (local adds `c`, library adds `e`): merged `[f,c,e]`, toAdd `[c]`;
    - **reader and derived ids in local** are excluded from every set.
  - **Two players (D12):** players A and B are two adapters on one fake library, each with a shelf record of library book L.
    - A adds `fantasy` and `re-read`: the library gets only `fantasy`.
    - B's refresh: B's record has `fantasy`, and no `re-read`.
    - B removes `fantasy`: the library loses it. A's refresh: A's record loses `fantasy` and keeps `re-read`.
  - **Offline edit:**
    - with the library timing out, A adds `cozy`: `syncShelfTags` returns `'pending'`, the record has `cozy`, and its `libraryTagsBase` is unchanged;
    - after `validateCharacterState` (a reload) and the library back up, `refreshShelfRecords` pushes `cozy`, and base becomes the merged set.
  - **Unreachable mid-session (§6.7):**
    - `refreshShelfRecords` with `status 'unavailable'` changes nothing and resolves;
    - `startLibrarySync` with a never-resolving catalogue doesn't delay `loadState`, which is awaited first and asserted complete.
  - **No-op refresh (Review Focus 2):** a second refresh with identical data calls `setStateKey` **zero** times and emits no `BOOKS_CHANGED`.
  - **Metadata:** a library title change updates the record. A null library `cover_url` keeps the ToS cover.
  - **Deleted library book (Review Focus 4):** the record is unchanged, `isLibraryMissing` is true, no tag push is made, and the record is never deleted.
  - **Left the household (Review Focus 5):** a catalogue `no-household` leaves every shelf record as it was, makes no write request, and a later refresh within 60 s makes no request.
  - **`ensureShelfRecord`:**
    - reuses the oldest record for L and doesn't create a second;
    - never reuses an `ebook` record with L's title (D6);
    - a new record has `type 'shelf'`, `libraryBookId`, the library's shared tags as both `tags` and base, and empty links.
  - **Series (§6.8):**
    - a shelf record in ToS series `"Saga"` whose library `seriesName` is null gets `fillSeries('L','Saga')`;
    - a library `seriesName 'Other Saga'` gives no write; a non-shelf book in a series gives no call.
  - **Found on our shelf (§6.9):**
    - a `physical` book with exactly one strong match gives one offer;
    - two strong matches give none;
    - a `shelfMatchDismissed` equal to that id gives none;
    - an `ebook` with the same title gives none;
    - `linkPhysicalToShelf` makes it `shelf` with the union of tags pushed, and keeps its `links`, `id` and `dateCompleted`.
  - **Rewards are history (§6.9):**
    - complete a quest linked to a shelf record tagged `fantasy` (through `BaseQuestHandler`, as `bookCompletionCascade.test.js` does) and record `rewards`;
    - then have the library add `epistolary` and remove `fantasy`, run `refreshShelfRecords`, and run `validateCharacterState`;
    - the completed quest's `rewards` are deep-equal to the recorded ones;
    - an **active** quest on another shelf record shows `auto-applied` for an `epistolary` item after the refresh.
  - **A book linked to two quests:** a shelf record with two quest links (the ability learned) keeps both links through refresh and merge, and `isSecondaryQuestForBook` gives the same answer before and after.
- [ ] **Step 2: Run to verify failure.** `npm test -- shelfBookService`. Expected: FAIL.
- [ ] **Step 3: Implement** per D4, D5, D6, D7 and Interfaces. `startLibrarySync` is called from `character-sheet.js` after state load, and only when `getSupabaseClient()` is non-null.
- [ ] **Step 4: Verify.** The full suite.
- [ ] **Step 5: Commit** `feat(library): shelf records with shared tags and series`.

### Task 8: ToS — the shared picker, Tags & series, and the offer UI (ToS PR 3, part 4)

**Files:**
- Create: `assets/js/utils/tagPicker.js` (moved out of `LibraryController._renderTagPicker` / `_readTagPicker`)
- Modify: `assets/js/utils/bookSelector.js`, `controllers/QuestController.js` (lines ~191, ~1738), `controllers/ExternalCurriculumController.js` (~384, ~400), `controllers/LibraryController.js` (Add-form search, offer line, drawer unlink, series save → `fillSeries`)
- Test: `tests/bookSelector.test.js`, `tests/questEditDrawer.test.js`, `tests/externalCurriculumController.test.js`, `tests/libraryController.test.js` (extend)

**Interfaces:**
- Consumes: Tasks 5–7.
- Produces:

```js
// tagPicker.js
export function renderTagPicker(container, selectedTags, applicableTags) // skips type-derived; marks reader "just you"
export function readTagPicker(container) /* -> string[] */
// createBookSelector(container, stateAdapter, options) - new options:
//   libraryCatalog?: LibraryCatalogService   (absent -> no shelf group, today's behaviour)
//   onlineSearch?: (query, author, signal) => Promise<Array<{title, author, cover, pageCount}>>
//   onBookChanged?: (bookId) => void          (after Tags & series saves)
//   showTagsAndSeries?: boolean (default true when libraryCatalog is given)
// Returned API unchanged: { render, setSelectedBookId, getSelectedBookId, destroy }.
```

Copy, exact:
- group headings: `On our shelf`, `Your books`, `Search online`;
- states: `Checking the household library…`, `On our shelf unavailable`, `Retry`;
- actions: `Search online for "{q}"`, `Add "{q}" without searching`;
- the type prompt: `What kind of book is this?`, with the four `BOOK_TYPE_LABELS`;
- the chip action: `Tags & series`;
- the special-edition toast: `This copy is labelled "{label}". Tag it Special / Illuminated Edition in Tags & series if that fits.`;
- the missing book: `No longer in the household library`;
- the offer: `Found on our shelf — link it?`, with `Link` and `Not this one`;
- the drawer action: `Unlink from the library`.

- [ ] **Step 1: Write the failing tests** (jsdom, with a fake `LibraryCatalogService` whose `peek`/`getCatalog` are scripted):
  - **Group order:** with a ready catalogue and a query, the groups appear in the order shelf, your books, search online. A shelf record of a ready library book appears only under `On our shelf`.
  - **One-step shelf link (§6.2):** picking a shelf result calls `ensureShelfRecord` once and `onSelect` with the returned id. Picking it again reuses the record, so `addBook` isn't called a second time.
  - **Unavailable:**
    - `unavailable` shows `On our shelf unavailable`, and the shelf record is listed under `Your books` and selectable;
    - `Retry` calls `getCatalog({ force: true })`;
    - the dropdown renders within one tick even while `getCatalog` is pending (`Checking…`).
  - **Signed out:** no shelf group, and `getCatalog` is never called when `libraryCatalog` is absent.
  - **Online search:**
    - `Search online for "x"` calls `onlineSearch` once; typing alone doesn't;
    - picking a result shows the type prompt;
    - `Ebook` calls `addBook` with `type 'ebook'` and the result's title, author and cover, then `onSelect`.
  - **Without searching:** `Add "x" without searching` with `Physical, not in the library yet` gives `type 'physical'`.
  - **Quota (unchanged rule):** a shelf result whose existing record already holds its quota is disabled with the existing `Linked to:` note. A shelf result with no record isn't disabled, and no record is created by opening the dropdown.
  - **Tags & series:**
    - on a selected shelf record it opens inline inside the container (it works with `appendTo: 'container'` inside the quest drawer);
    - checking `epistolary` and saving calls `updateBook`, `syncShelfTags`, and `onBookChanged(id)`;
    - in the quest edit drawer, `onBookChanged` re-renders bonus cards with `effectiveBookTags` (an `epistolary` item becomes `auto-applied`);
    - choosing an Archive series calls `addBookToSeries` and `fillSeries`.
  - **Special edition:** a shelf pick whose library book has `editionLabels ['Invented Box']` and no `special-edition` tag shows the toast once.
  - **Curriculum (§6.9):** the curriculum prompt selector receives `libraryCatalog`, and picking a shelf result calls `linkBookToPrompt` with the shelf record id.
  - **Library tab:**
    - the Add-form search lists `On our shelf` results with `Link it from a quest` and no add button;
    - a `physical` card with an offer shows the offer line; `Link` calls `linkPhysicalToShelf`, and `Not this one` calls `dismissShelfOffer`;
    - a shelf drawer's `Unlink from the library` calls `unlinkFromLibrary`;
    - a missing library book's card shows `No longer in the household library` (Review Focus 4), and the selector doesn't list it under `On our shelf`.
- [ ] **Step 2: Run to verify failure.** `npm test -- bookSelector questEditDrawer externalCurriculum libraryController`. Expected: FAIL.
- [ ] **Step 3: Implement** per D7 and Interfaces. Keep `escapeHtml` in `innerHTML` only, and never escape URLs (EXTENDING gotcha). Style with the existing `book-selector-*` classes plus a `book-selector-group-heading`.
- [ ] **Step 4: Verify.**
  - The full suite.
  - Jekyll against the local stack (Task 13's setup) with one household book: the quest picker shows it under `On our shelf`, linking works, and `Tags & series` round-trips a tag that the library's `book_tags` row shows (checked in Studio).
- [ ] **Step 5: Review, commit, PR.**
  - **Review:** a subagent reviews the Task 5–8 diff for blocking awaits on the library, tag paths that bypass `sharedTags`, and new writes on refresh.
  - **Commit:** `feat(quests): link a book from the household library straight from the quest`.
  - **Push** `plan4-3-shelf-link` and open a PR with base `plan4-2-book-types`, left unmerged. The body says that it needs the `db push`, that the library is optional (offline/signed-out behaviour), and what players see.

### Task 9: ToS — the tidy service and deliberate push (ToS PR 4, part 1)

**Branch:** `git -C <tos-wt> checkout -b plan4-4-tidy-review plan4-3-shelf-link`.

**Files:**
- Create: `assets/js/services/LibraryTidyService.js`, `tests/libraryTidyService.test.js`
- Modify: `assets/js/services/cloudSync.js` (`checkReadyForDeliberateChange`, `pushDeliberateChange`), `stateAdapter.js` (`applyBookTidy`), `tests/cloudSync.test.js`

**Interfaces — Produces:**
```js
export function isProtected(book, state) /* -> boolean (D9) */
export function planTidy(state, catalog /* CatalogResult|null */) /* -> TidyRow[] */
// TidyRow = { bookId, title, author, protected, candidates: Array<{ libraryBookId, title, authors, coverUrl, reason, score }>,
//             preselected: string|null }
// TidyDecision = { bookId, kind: 'link', libraryBookId } | { bookId, kind: 'type', type /* PICKABLE_TYPES */ }
//              | { bookId, kind: 'drop' }
export function summarizeTidy(state, decisions) /* -> { remove, shelf, typed, dropped, booksBefore, booksAfter } */
export const TIDY_BLOCK_REASONS = ['unsynced','offline','newer-schema','library','protected','storage'];
export async function applyTidy({ stateAdapter, decisions, catalog, service, cloud, confirm })
  // -> { status: 'applied'|'cancelled'|'blocked', reason?: one of TIDY_BLOCK_REASONS, pushed: boolean }
  // Rule (D10): 'blocked' and 'cancelled' write NOTHING (no types, no tidy state, no tags beyond step 3's unions).
  // Inside the lock, isProtected is recomputed from live state for every link/drop decision.
  // cloud = { checkReady(): Promise<{ ok, reason? }>, push({ reason, booksBefore, booksAfter }): Promise<boolean> } | null (signed out)
  // confirm(summary) -> Promise<boolean>  (Task 10 passes confirmDialog)
export function restoreRemovedBooks(stateAdapter, ids /* string[]|undefined = all */) /* -> Promise<number restored> */
export function mergeRemovedBooks(existing /* {id:Book} */, removed /* Book[] */) /* -> new map; never drops an id (D9) */
export function stripInlineCovers(book) /* -> copy with a data: cover set to null */
export function healTidyStatus(state) /* -> state with bookTidy.status 'pending' when any book is unsorted; same object if unchanged */
// stateAdapter.applyBookTidy(nextBooks, nextTidy) -> Promise<{ ok: true } | { ok: false, reason: 'storage' }>
//   1) safeSetJSON(bookTidy) must return true, else { ok:false } with books untouched
//   2) await setStateKey(BOOKS, nextBooks) (rejection -> { ok:false })   3) characterState + one BOOKS_CHANGED
// cloudSync:
export async function checkReadyForDeliberateChange(supabase)
  /* -> { ok: true } | { ok: false, reason: 'unsynced'|'offline'|'newer-schema' } (same strings as TIDY_BLOCK_REASONS) */
export async function pushDeliberateChange(supabase, { reason, booksBefore, booksAfter }) /* -> { action: 'push'|'manual_required' } */
```

- [ ] **Step 1: Write the failing tests:**
  - **`isProtected`:** true for each of: an active, completed or discarded quest by `bookId`; `links.questIds`; `grandfatheredQuestIds`; a curriculum prompt `bookId`; `curriculumPromptIds`; `dateCompleted`; membership of a series. False for a bare Unsorted book.
  - **`planTidy`:**
    - only `unsorted` books get rows (an audiobook with a shelf title gets none);
    - one strong match is preselected; two strong matches mean none preselected and both listed (duplicate matches);
    - a weak-only row has candidates and no preselection;
    - `catalog` null or not `ready` gives every row empty candidates (the simple version).
  - **`summarizeTidy`:** on a 52-book fixture with 45 removable links, 4 protected links and 3 typed decisions it gives `{ remove: 45, shelf: 4, typed: 3, booksBefore: 52, booksAfter: 7 }`.
  - **Apply, signed in and in sync:**
    - `confirm` is called once with that summary;
    - `service.addTags` runs **before** any state write (call order recorded);
    - removed records are in `bookTidy.removedBooks`, and the protected ones are `shelf` with merged tags and untouched `links`, `dateCompleted`, curriculum links and `series.bookIds`;
    - `cloud.push` is called once with `{ reason: 'library-tidy', booksBefore: 52, booksAfter: 7 }`;
    - **the write order:** `setBookTidy` before the books write.
  - **Auto-sync excluded:** during apply, a scheduled `runAutoSyncOnce` (simulated through `runExclusiveSync`) runs only after apply resolves.
  - **Precheck blocks removal:** `cloud.checkReady` → `{ ok:false, reason:'unsynced' }` gives `blocked 'unsynced'`, no write, no `addTags`.
  - **One blocked rule (I6):**
    - a decision list mixing types and removals, with `checkReady` → `offline`, gives `blocked 'offline'` and writes **nothing**, the type choices included;
    - type-only decisions never call `checkReady` and apply offline;
    - `checkReady` → `newer-schema` gives `blocked 'newer-schema'`.
  - **Protection recomputed inside the lock (I6):**
    - `planTidy` runs, then the book gets linked to an active quest, then `applyTidy` with a `link` decision for it;
    - the book becomes `shelf`, not removed, and `summarizeTidy` inside apply counts it under `shelf`;
    - a `drop` decision for it gives `blocked 'protected'` and writes nothing.
  - **Storage failure (C2):** with `safeSetJSON` returning false for `bookTidy` (a quota mock), `applyTidy` gives `blocked 'storage'`, `setStateKey(BOOKS, …)` is never called, `books` are unchanged, and no push is made.
  - **Covers stripped (C2):** a removed book with a `data:image/jpeg;base64,…` cover is stored in `removedBooks` with `cover: null`; an `https:` cover is kept.
  - **Books written before the push (I1):** a `setStateKey` mock that resolves after a delay; `cloud.push` is called only after it resolves. A `setStateKey` that rejects gives `blocked 'storage'` and no push.
  - **Merge by id (I4):**
    - apply removing X and Y, restore Y, then apply removing Z;
    - `removedBooks` holds X and Z (Y was restored), and X wasn't dropped by the second apply;
    - `mergeRemovedBooks({X}, [X'])` keeps one X, the newer one.
  - **Status heals (I3):** a state with `bookTidy.status 'done'` and one Unsorted book gives `healTidyStatus(state).bookTidy.status === 'pending'`. With no Unsorted books it returns the same object, so `loadState` writes nothing.
  - **Library down:** `addTags` rejecting gives `blocked 'library'`, and the save is deep-equal to before.
  - **Cancelled:** `confirm` resolving false gives `cancelled`, with nothing written or pushed.
  - **Drop:** a `drop` on a protected book gives `blocked 'protected'`.
  - **Signed out:** `cloud` null applies link-free decisions locally with no network.
  - **Duplicates:** two ToS books strong-matching L, one protected and one not: the unprotected one is removed, the protected one becomes shelf. Two protected ones both become shelf records with libraryBookId L.
  - **Interrupted (Review Focus 3):**
    - write `bookTidy` with `removedBooks` holding X, but leave `books` still holding X (simulating a kill between writes);
    - `planTidy` still lists X;
    - applying the same decision again leaves exactly one X in `removedBooks` and none in `books`;
    - `restoreRemovedBooks` then restores X once, and a second call restores 0.
  - **Self-heal overlap (D10):** with `books` holding X and `removedBooks` holding X, restore skips X.
  - **Older snapshot after the tidy:** after an applied tidy, `applySnapshot` of a v19 snapshot that still has the 45 books gives 45+ Unsorted books and `bookTidy.status 'pending'` (as migrated from that snapshot), with no crash, and `planTidy` lists them again.
  - **`cloudSync`:**
    - `checkReadyForDeliberateChange` is ok when the remote hash equals `lastSyncedHash`, and when there is no remote row and no `lastSyncedHash`;
    - it is `unsynced` when the remote changed since the last sync, `offline` when `getRemoteSave` throws a network error, and `newer-schema` for a newer remote version or a closed write gate;
    - `pushDeliberateChange` upserts and logs `push` with detail `library-tidy: books 52→7`; it returns `manual_required` and doesn't upsert when the remote changed in between.
- [ ] **Step 2: Run to verify failure.** `npm test -- libraryTidyService cloudSync`. Expected: FAIL.
- [ ] **Step 3: Implement** per D9, D10 and Interfaces. `applyTidy` runs entirely inside `runExclusiveSync`. `healTidyStatus` is called in `loadState` after validation, and in `applySnapshot` after migration.
- [ ] **Step 4: Verify.** The full suite.
- [ ] **Step 5: Commit** `feat(library): tidy review service with a deliberate, confirmed push`.

### Task 10: ToS — the review screen (ToS PR 4, part 2)

**Files:**
- Create: `assets/js/ui/confirmDialog.js`, `assets/js/controllers/LibraryTidyController.js`, `tests/confirmDialog.test.js`, `tests/libraryTidyController.test.js`
- Modify: `_includes/character-sheet/tabs/library.html` (`#library-tidy-panel` above the lists), the character-sheet header include (`#library-tidy-banner`; find the header with `grep -rln "auth-panel" _includes`), `assets/js/character-sheet.js` (register the controller), the Library stylesheet

**Interfaces:**
- Consumes: Task 9.
- Produces:
  - `confirmDialog({ title, body, confirmLabel, cancelLabel }) -> Promise<boolean>`: in-page; Escape, the backdrop and `cancelLabel` resolve false; nothing is focused-to-confirm by default.
  - `LibraryTidyController`, a `BaseController` subclass.
  - `TIDY_REMIND_AFTER_DAYS = 7`.

Screen (Dark Academia, `rpg-panel`, mirroring the Library add panel):
- **Panel header:** `Tidy your ToS library`. Subtext: `{n} books to sort. Books on our shelf with no quest, no completion and no series move to the household library; everything else keeps its history.`
- **One row per `TidyRow`:**
  - the cover and title/author;
  - **a preselected match:** `On our shelf: {title}` checked, plus the outcome line `Will be removed from ToS (stays in the library)` or `Will link to the library (keeps its quests)`;
  - **weak candidates:** `Is it one of these?`, with each candidate, `None of these`;
  - **unmatched, or `None of these`:** the four type buttons, `Find it in the library…` (a search over the catalogue, the hand link), and `Drop` (hidden when protected; tooltip `Can't drop a book with quest history`).
- **The simple version:** the note `Sign in and join your household to match books with the library.` (or `The household library is unavailable right now.`, with `Retry`), and type buttons only.
- **Footer:** `Apply {k} choices`, and `Later` (sets postponed). `Restore removed books ({m})` appears when `removedBooks` is non-empty.
- **Apply results:**
  - **blocked `unsynced`:** `Your cloud save changed on another device. Use Sync now first, then apply.`;
  - **blocked `offline`:** `You're offline. Nothing was changed; removals need a connection. Your choices are still here.`;
  - **blocked `newer-schema`:** `Tome of Secrets was updated. Reload this tab, then apply.`;
  - **blocked `library`:** `Couldn't reach the household library. Nothing was changed.`;
  - **blocked `protected`:** `{title} now has quest history, so it can't be dropped. Nothing was changed.`;
  - **blocked `storage`:** `This browser's storage is full, so nothing was changed. Free some space, or remove uploaded covers, and try again.`;
  - every blocked state keeps the choices on screen;
  - **applied:** `Done. {r} removed, {s} linked to the library, {t} typed.`, plus the push hint from D10.
- **The banner:** `Tidy your ToS library — {n} books to sort.`, with `Open` (switches to the Library tab and scrolls to the panel) and `Later`.

- [ ] **Step 1: Write the failing tests:**
  - **`confirmDialog`:** Escape resolves false; a backdrop click resolves false; the confirm button resolves true; `document.activeElement` isn't the confirm button on open; two dialogs never stack (the second waits).
  - **Panel visibility:** the panel shows while `status !== 'done'` and hides when done.
  - **Banner:**
    - shows on load when pending;
    - `Later` sets `postponed` + `postponedAt`;
    - with a fake clock it stays hidden at day 6 and shows again at day 7 (`TIDY_REMIND_AFTER_DAYS`);
    - there is no control that sets `done` without sorting.
  - **Rows:**
    - a preselected row renders checked and the matching outcome line;
    - choosing `None of these` reveals the type buttons;
    - `Drop` is absent on a protected row;
    - `Apply` passes exactly the chosen decisions to `applyTidy`, and `confirm` receives `summarizeTidy`'s numbers in the body copy (`Remove 45 books`, `52 to 7`).
  - **Signed out:** no candidate UI, type buttons only, and no `getCatalog` call.
  - **Restore:** `Restore removed books (45)` calls `restoreRemovedBooks()` and the panel returns to pending.
  - **Messages:** each `blocked` reason renders its sentence.
- [ ] **Step 2: Run to verify failure.** `npm test -- confirmDialog libraryTidyController`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Verify.**
  - The full suite and `npm run validate-data`.
  - Jekyll with a synthetic 52-book save, imported through the dev console from a fixture file under `tests/fixtures/` with invented titles.
  - Expected: the panel, the dialog numbers, a removal, a restore, and no console errors.
- [ ] **Step 5: Review, commit, PR.**
  - **Review:** a subagent reviews the Task 9–10 diff against D9, D10 and the lqt0 design (`git show origin/docs/lqt0-cloud-save-durability:docs/superpowers/specs/2026-08-30-lqt0-cloud-save-durability-design.md`).
  - **Commit:** `feat(library): tidy your ToS library review screen`.
  - **Push** and open a PR with base `plan4-3-shelf-link`, left unmerged. The body includes D10's lqt0 paragraph and the rollout's review steps.

### Task 11: Library — types, repo, ToS tags and filters

**Files:**
- Create: `src/lib/tos-tags.ts`, `src/lib/series.ts`, `src/lib/tos-tags.test.ts`, `src/lib/series.test.ts`
- Modify: `src/lib/types.ts`, `src/lib/library-repo.ts`, `src/lib/filter-books.ts`, `src/hooks/useCatalog.ts`, `src/lib/router.ts`, `vite.config.ts` (dev proxy), `.env.example`
- Test: `src/lib/library-repo.test.ts`, `src/lib/filter-books.test.ts`, `src/lib/router.test.ts` (extend)

**Interfaces — Produces:**
```ts
// types.ts: Book + seriesName: string | null; seriesVolume: number | null  (BOOK_COLUMNS series_name, series_volume;
//           BOOK_EDITABLE gains both; toBook maps them, absent -> null)
//           BookInput and normalizeBookInput do NOT gain them. Series are written only by the series picker's
//           updateBook patch, so createBook / libib insertBooks / photo confirm never send series_name or
//           series_volume (fromBookPatch skips undefined) and keep working before the db push.
// library-repo.ts
listBookTags(householdId: string): Promise<Map<string, string[]>>   // readAllPages; select book_id, tag_id; eq household_id;
                                                                    // order book_id, then tag_id; any page error rejects (no partial map)
addBookTag(bookId: string, householdId: string, tagId: string): Promise<void>   // upsert ignoreDuplicates
removeBookTag(bookId: string, tagId: string): Promise<void>
// useCatalog(): + tags: Map<string,string[]>; tagsError: string | null   (tags load separately; a failure never sets error)
// tos-tags.ts
interface TosTag { id: string; label: string; category: string; scope?: "reader"; derivedFromType?: string }
loadTosTags(opts?: { fetchImpl?: typeof fetch; url?: string; storage?: Storage }): Promise<{ tags: TosTag[]; stale: boolean }>
  // url default import.meta.env.VITE_TOS_BOOK_TAGS_URL || "/tome-of-secrets/assets/data/bookTags.json"; 4000 ms timeout;
  // success -> cache tpl_tos_book_tags; failure -> cached copy with stale true; none -> [] with stale true
isSharedTag(tag: TosTag): boolean     // !scope && !derivedFromType
groupTags(ids: string[], tags: TosTag[]): Array<{ category: string; label: string; tags: Array<{ id: string; label: string }> }>
  // ToS category order genre, content, provenance, agency, form; unknown ids under "Other" with label = id
// series.ts
seriesNames(books: Book[]): string[]          // editionLabels' rules: trim, case-insensitive groups, most-used spelling, sorted
canonicalSeries(typed: string, names: string[]): string | null   // <= 200 chars, else null
// filter-books.ts: opts + tags?: string[] (book must have all), series?: string | null (case-insensitive equality)
//   filterBooks gains a tagsByBook: Map<string,string[]> argument in opts
// router.ts: { name: "library"; series?: string }  <-> "#/series/<encoded>"
// vite.config.ts: server.proxy["/tome-of-secrets"] = { target: process.env.TOS_JEKYLL_URL ?? "http://host.docker.internal:4000", changeOrigin: true }
```

- [ ] **Step 1: Write the failing tests:**
  - **`toBook`:** maps `series_name` and `series_volume`; a row without them gives nulls; `fromBookPatch({ seriesName: "Saga" })` gives `{ series_name: "Saga" }`.
  - **Before the push:** `createBook` with a `BookInput` sends no `series_name` or `series_volume` key, and the libib `insertBooks` row mapping sends neither.
  - **`listBookTags`:**
    - groups rows by book;
    - orders by `book_id`, then `tag_id`;
    - a second-page error rejects.
    - `useCatalog` with `listBookTags` rejecting still returns books, with `tagsError` set, `error` null and an empty tag map (D11 rollback matrix).
  - **`addBookTag`:** sends `upsert({ book_id, household_id, tag_id }, { onConflict: "book_id,tag_id", ignoreDuplicates: true })`.
  - **`loadTosTags`:**
    - the default URL is `/tome-of-secrets/assets/data/bookTags.json`;
    - a success writes the cache;
    - a 500 returns the cached tags with `stale true`;
    - a timeout at 4000 ms (fake timers) behaves the same;
    - no cache at all gives `[]`;
    - a storage that throws is tolerated.
  - **Tag rules:**
    - `isSharedTag` is false for `{ scope: "reader" }` and `{ derivedFromType: "audiobook" }`;
    - `groupTags(["fantasy","zzz-unknown"], tags)` puts `zzz-unknown` under `Other` with label `zzz-unknown`.
  - **`seriesNames`:** `[" Saga", "saga", "Saga", "Other"]` gives `["Other", "Saga"]`; `canonicalSeries("SAGA", ["Saga"])` gives `"Saga"`; 201 characters gives null.
  - **`filterBooks`:**
    - `tags: ["epistolary","fantasy"]` keeps only books having both;
    - `series: "saga"` matches `Saga`;
    - the filters combine with owner and edition.
  - **Router:** `parseHash("#/series/Salt%20Road")` gives `{ name: "library", series: "Salt Road" }` and round-trips; `#/` still gives `{ name: "library" }`.
- [ ] **Step 2: Run to verify failure.** `docker compose run --rm app npm test -- src/lib src/hooks`. Expected: FAIL.
- [ ] **Step 3: Implement** per Interfaces, D4 and D5. `.env.example` gains `VITE_TOS_BOOK_TAGS_URL=` (blank means the default) and a comment on `TOS_JEKYLL_URL`.
- [ ] **Step 4: Verify.** `docker compose run --rm app npm test`, then `npx tsc -b`. Expected: green.
- [ ] **Step 5: Commit** `feat: ToS tags and series in the library data layer`.

### Task 12: Library — the Tome of Secrets section, series picker and filters

**Files:**
- Create: `src/components/book/TosTagsSection.tsx`, `src/components/series/SeriesPicker.tsx`, their `.test.tsx`
- Modify: `src/components/book/BookDetail.tsx`, `src/components/library/LibraryFilters.tsx`, `src/components/library/LibraryPage.tsx`, `src/App.tsx` (route), `README.md`

**Interfaces:**
- Consumes: Task 11.
- Produces:
  - `TosTagsSection({ bookId, householdId, tagIds, tosTags, stale, onChange })`;
  - `SeriesPicker({ value, volume, names, onChange(name: string | null, volume: number | null) })`, modelled on `EditionPicker`: a sheet with a filter field, `None`, the names, and `Add "{typed}"`; plus a `Volume` number input with step 0.5, min 0 and max 9999.5;
  - `LibraryFilters` gains `tagFilter: string[]`, `series: string | null`, `tosTags` and `seriesNames`.

Copy, exact:
- **Section heading:** `Tome of Secrets`.
- **Empty section:** `No Tome of Secrets tags yet.`
- **Stale tags:** `Tag names couldn't be loaded; showing ids.`
- **Unavailable tags:** `Tome of Secrets tags unavailable.` Shown when `tagsError` is set; the section is read-only.
- **Edit control:** `Edit tags` opens a checklist grouped by category, showing only `isSharedTag` tags. Existing non-shared ids are shown with the note `set in Tome of Secrets` and can't be toggled.
- **Series, on the book page:** `Series: {name}` (with `· Vol. {volume}` when set), or `Series: none`. The picker opens from it, and `Show the rest of this series` navigates to `#/series/<name>`.
- **Filters:** `All series` + names; `ToS tags` (a multi-select sheet with chips; `Clear`).
- **Save errors:** `Couldn't save the tag.` or `Couldn't save the series.` (via `role="alert"`), with the local state reverted.

- [ ] **Step 1: Write the failing tests** (Testing Library, with the repo mocked):
  - **Tags section:**
    - renders `Fantasy` under `Genre` for `["fantasy"]` given the tag list;
    - checking `Letters / Documents / Found Records` calls `addBookTag(bookId, householdId, "epistolary")`;
    - unchecking calls `removeBookTag`;
    - a rejected call shows `Couldn't save the tag.` and reverts;
    - `re-read` (reader) and `audio` (derived) aren't offered; an existing `re-read` row is shown with `set in Tome of Secrets`.
  - **Series:**
    - `SeriesPicker` typing `saga` with names `["Saga"]` picks `Saga` (no duplicate `Add`);
    - `Add "New Saga"` calls `onChange("New Saga", null)`;
    - volume `2.5` calls `onChange(name, 2.5)`;
    - `BookDetail` saving a series calls `updateBook(id, { seriesName, seriesVolume })` and marks `seriesName`/`seriesVolume` in `userEditedFields`.
  - **Navigation:** `Show the rest of this series` sets the hash `#/series/Saga`, and `LibraryPage` on that route has the series filter preset.
  - **Tag filter:** with `epistolary` and `fantasy` chosen it shows only books carrying both.
  - **Unavailable tags:** with `tagsError`, the book page shows `Tome of Secrets tags unavailable.` and the library list still renders.
- [ ] **Step 2: Run to verify failure.** `docker compose run --rm app npm test -- src/components`. Expected: FAIL.
- [ ] **Step 3: Implement.** README gets a `Tome of Secrets` section covering: the tags come from ToS and are shared per book; "just you" tags live only in ToS; series, and that ToS fills an empty series.
- [ ] **Step 4: Verify.** `docker compose run --rm app npm test`, `npm run lint`, `npm run build`. Expected: green.
- [ ] **Step 5: Review, commit, PR.**
  - **Review:** a whole-branch subagent review against the spec and D4/D5/D11.
  - **Commit:** `feat: Tome of Secrets tags, series and their filters`.
  - **Push** `tshardey/plan-4-tos-integration` and open a PR to `main`, left unmerged. The body says:
    - **the ToS PR 1 `db push` must land first**;
    - that the app degrades if it hasn't (D11);
    - that labels are read from ToS's `bookTags.json`.

### Task 13: Local walkthrough across both apps

**Setup (local only):**
- **ToS stack:** `npx supabase@2.122.1 db reset --workdir <tos-wt>` on `plan4-4-tidy-review`.
- **ToS site:** `docker compose -p tos-plan4 up jekyll`, with `_config.supabase.yml` on the local stack. If the magic-link redirect is refused, add `http://localhost:4000/tome-of-secrets/**` to `supabase/config.toml` `additional_redirect_urls` **locally only, without committing it**.
- **Library app:** `TOS_REPO_PATH=C:/Users/tierr/Github/tome-of-secrets-plan4 docker compose run --rm --service-ports app npm run dev -- --host`, with `.env.local` on the local stack.
- **Two users,** signed up through Mailpit (`http://127.0.0.1:54324`): Member A creates household "Test Home", and Member B joins with the invite code. The two apps are separate origins locally, so sign in to each.
- **Seed** about 10 library books with invented titles via the library app's `Add`. Give one a copy edition label, and one a series.

- [ ] **Step 1: Before the migration.** Check out `plan4-1-groundwork` in Jekyll and build a v19 save for Member A from the fixture in Task 10, with every case:
  - a book tagged `audio`;
  - a completed book;
  - a book linked to two quests;
  - a series book;
  - a curriculum-linked book;
  - an ebook-titled duplicate of a shelf title;
  - a book with two library matches.

  `Sync now`, and record the counts: books, completed per year, quests per list.
- [ ] **Step 2: Migrate.** Switch to `plan4-4-tidy-review` and reload. Expected:
  - the counts are unchanged;
  - the audio book is under Audiobooks;
  - the rest are Unsorted;
  - the banner shows;
  - the first auto-push succeeds with the same book count (check the `tos_sync_events` detail in Studio).
- [ ] **Step 3: Picker.** On a new quest, check:
  - `On our shelf` lists the household books;
  - linking one takes one tap, and `Tags & series` → `epistolary` appears on the library book page within a reload;
  - Member B tags `cozy` in the library app; Member A's chip shows `cozy` after a refresh;
  - the special-edition toast appears for the labelled copy.
- [ ] **Step 4: Library unreachable.** `npx supabase@2.122.1 stop --workdir <tos-wt>` mid-session. The picker shows `On our shelf unavailable` within about 4 s, online search and `Your books` still work, and a tag edit is kept. Start the stack again: after a refresh the tag is in `book_tags`.
- [ ] **Step 5: Review.** Open the tidy panel and check:
  - preselections match the strong cases;
  - the two-match book has no preselection;
  - the ebook duplicate isn't listed;
  - **Apply:** the dialog numbers are right, Escape cancels, and confirming removes the books;
  - the cloud row's book count drops by exactly the removed count, in one `library-tidy` event;
  - `Restore removed books` brings them back.

  Re-apply.
- [ ] **Step 6: Older snapshot.** In Studio, set Member A's `tos_saves.data` back to the Step 1 snapshot, then `Sync now` → keep cloud. Expected: the books are Unsorted again, the review is pending, and nothing crashes.
- [ ] **Step 7: Member B and signed-out.**
  - Member B runs a review on their own save: Member A's save is untouched.
  - Signed out (or in a private window): no shelf group, the simple review, and no request to `/rest/v1/` for the library schema (DevTools network tab).
- [ ] **Step 8: Rollback.** Check out `plan4-1-groundwork` in Jekyll and reload. Expected: books still listed (by status), the sync hint `This save was made by a newer Tome of Secrets…`, and no push. Check out `plan4-4-tidy-review` again: everything is back.
- [ ] **Step 9: Record.** Write the results, and anything that differed, into each PR body as a checklist. Fix bugs in follow-up commits on the owning branch, then re-run the affected steps.

---

## USER-APPROVED STEP: production rollout

**Agents don't run this without the user's explicit go-ahead at that moment.** Approval of this plan isn't approval of this step. The user runs it, or explicitly tells an agent to, in this order:

**The reload rule (D10), after every ToS deploy below:** wait for the GitHub Pages deploy to finish. Then, **on every device either player uses, reload or close every open ToS tab**, before the next ToS PR merges. A tab opened before ToS PR 1 deployed has no write gate. If it is still open when v20 arrives, it can overwrite the new save in the old shape.

1. Merge ToS PR 1 (`plan4-1-groundwork`). **Reload rule.**
2. **`db push`, from a fresh push worktree at the merged `main`.** Don't use `C:/Users/tierr/Github/tome-of-secrets-library-schema` (Global Constraints):
   ```
   git -C C:/Users/tierr/Github/tome-of-secrets fetch origin
   git -C C:/Users/tierr/Github/tome-of-secrets worktree add --detach C:/Users/tierr/Github/tome-of-secrets-plan4-push origin/main
   npx supabase@2.122.1 link --project-ref cdhorluhpuchzlnahzlt --workdir C:/Users/tierr/Github/tome-of-secrets-plan4-push
   ```
   - `npx supabase@2.122.1 db push --dry-run --workdir C:/Users/tierr/Github/tome-of-secrets-plan4-push`: confirm the only pending migration is `..._library-book-tags-series`.
   - Then run it without `--dry-run`.
   - **No function deploy.**
   - Afterwards: `git -C C:/Users/tierr/Github/tome-of-secrets worktree remove C:/Users/tierr/Github/tome-of-secrets-plan4-push`.
3. **Library PR.** Merge it (Pages deploys). Spot check: a book page shows `Tome of Secrets` and `Series: none`; tag and untag one book; set and clear a series.
4. **Before ToS PR 2,** on each player's main device:
   - press `Sync now`;
   - write down the book count, the completed-by-year counts and the active/completed quest counts.

   Then merge ToS PR 2. **Reload rule.** Then, on each device, confirm that the counts match, the audiobooks are typed, and the rest are Unsorted.
5. Merge ToS PR 3. **Reload rule.** Link one shelf book to a quest from the quest picker; tag it in ToS; see the tag in the library app.
6. **Merge ToS PR 4 (reload rule), then do the real review of the roughly 50 books** (Tierra first, then AJ on their own save):
   1. `Sync now` first, so the cloud equals this device.
   2. Open `Tidy your ToS library`.
   3. Go through every preselected match: open any whose library title or author looks off, and untick it.
   4. Resolve the suggestions and the unmatched books. The current Reading ebook and audiobooks become their types; library loans become `Library book`.
   5. **Apply.** Read the dialog's numbers: removed + linked + typed must add up to what you chose, and "from X to Y books" must match the book count written down in step 4 minus the removals.
   6. Confirm.
   7. Check, on the device you used:
      - `Last synced` updated;
      - the Completed list's years and counts are unchanged;
      - every active quest still shows its book;
      - the Archive series show the same progress.
   8. On a second device, or after a reload: the same.
   9. In the library app, check that the removed books' tags appear on their library books.
   10. If anything is wrong, use `Restore removed books`, or `Unlink from the library` on a single book, and report it.

## User checks after rollout

- A month's ritual: draw quests, then link three books from `On our shelf` without visiting the Library tab.
- Both players tag the same shelf book on different days. Each sees the other's tags; "just you" tags (Re-Read, New-to-You Author, …) stay personal.
- Airplane mode in ToS mid-session: the picker says `On our shelf unavailable` quickly, online search still works, and a tag edit shows up in the library later.
- An audiobook quest's rewards and bonus cards behave as with the old Audiobook tag.
- Completing a quest whose shelf book is later re-tagged in the library: the archived quest's rewards don't change.
- A book bought but not yet scanned, added as `Physical, not in the library yet`. Scan it into the library: ToS shows `Found on our shelf — link it?`.
- A ToS series with a shelf book: the library book shows that series name if it had none; a series typed in the library is never overwritten.
- Signed out on a spare browser: ToS works with types and the new Library tab, with no errors.

## Open questions for the user (all resolved)

All six were answered by the user on 2026-11-11. The plan builds exactly these answers.

1. **"Just you" tags (D3). Resolved: the seven reader tags stay per player, in ToS only.** They are `New-to-You Author` (`new-author`), `Author from a New-to-You Country` (`new-country`), `Re-Read` (`re-read`), `Picked Back Up` (`picked-back-up`), `On Your TBR Over a Year` (`long-tbr`), `Chosen by Someone Else` (`recommended`) and `Outside Your Usual Genres` (`genre-stretch`), each marked `"scope": "reader"` in `bookTags.json` and shown as `just you`. **`Borrowed Copy` (`borrowed`) is shared** like any other tag: it gets no `scope`. No other tag is reader-scoped.
2. **Two lists the spec doesn't name (D7). Resolved: the default.** `Unsorted`, which spec §6.9 calls "its own list" and which disappears once sorted, and `Not in the library yet`, for books typed "Physical, not in the library yet".
3. **Tagging a shelf book that's on an active quest (D7). Resolved: the default.** It happens from `Tags & series` on the quest's selected book, not from the Library tab.
4. **Postponing the tidy-up (D9). Resolved: the default.** The banner comes back after 7 days; the Library tab panel stays until it's done.
5. **Removed books stay restorable (D9). Resolved: the default.** In the save, from the tidy panel, indefinitely. Each tidy adds to the list by id, and only `Restore` takes books off it. Inline (uploaded) covers are dropped; web-link covers are kept.
6. **Online search in the quest picker is a button (D7). Resolved: the default,** not search-as-you-type.
