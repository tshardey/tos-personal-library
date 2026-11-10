# Tome of Secrets ↔ library integration — design

Date: 2026-11-10. **Replaces §6.5 of `2026-11-03-personal-library-design.md`.** Calls marked *(Claude's call)* were not stated by Tierra and can be overruled; everything else is Tierra's decision from the 2026-11-10 conversation.

## 1. Intent

Tome of Secrets (ToS) has drifted into being a second library app. A book that is already on the household shelf, and so already in the library app, gets added to ToS's "Your Library" tab a second time just so it can be linked to a quest. Tierra wants ToS to go back to being the game:

- **The library app owns what the household has**: physical books, both members' copies.
- **ToS owns what each player reads for quests, and when.** StoryGraph stays Tierra's full reading tracker; ToS doesn't need to track everything (StoryGraph has no public API, so no connection there).

Tierra's monthly ritual drives the design: sit at the computer, roll/draw the month's quests, browse the library app for books that fit, then **link a book to a quest directly from the quest** in ToS, without importing it into ToS's Library tab first.

About 80% of Tierra's quest books come from the shelf. The rest are her own Kindle and Audible purchases (personal, not shareable with AJ, so they don't belong in the household library) and occasional public-library loans. AJ sometimes plays ToS with his own character.

## 2. Goals

1. From a quest, link a book from the household library in a couple of taps: library results first, no re-typing, no import step.
2. Keep online search for everything that is not on the shelf: ebooks, audiobooks, library loans, and the occasional physical book not yet in the library app.
3. ToS's Library tab shows only what is useful there: an Add form with a book type, **Completed** (by year, as today), **Audiobooks**, **Ebooks**, **Library books**. The **Reading** and **Other** sections and the **Physical TBR** badge/choice go away. The Archived Quests tab is unchanged.
4. **Shared Tome of Secrets tags on library books.** Tagging a book in ToS writes the tags to the library book, so when the other player reads it the tags are already there. Tags are per book, not per person; either member can add or remove them. The library app shows them in a "Tome of Secrets" section on the book page and can filter by them.
5. A one-time, reviewable migration of each player's existing ToS books.
6. Both household members' ToS saves work the same way; signed-out or household-less players see today's behaviour.

## 3. Non-goals

- Ebooks and audiobooks in the household library. The library stays physical.
- ToS tracking reading outside quests, or syncing with StoryGraph.
- Creating household library entries from ToS. Physical books enter the library through libib import, photos or scanning.
- Linking a quest from inside the library app (Tierra links from the quest). *(Claude's call: a small read-only "Linked to a quest" hint on the library book page is out of scope too; revisit later.)*
- Per-person tags.

## 4. Anti-goals

- Losing quest history, rewards, or completed-by-year history during the migration.
- Game rules changing behaviour: rewards that trigger on book tags must keep firing exactly as before. (No effect on `main` references `audio` today, but future content may, so type `audiobook` must count as that tag.)
- The player doing more work than today for the common case.
- ToS breaking or slowing down when the library is unreachable (offline, Supabase down, signed out).
- A silent wrong match between a ToS book and a library book during migration.

## 5. Constraints and known facts (ToS `origin/main`, 2026-11-10)

- ToS state is one JSON blob per user in `public.tos_saves`, synced by `services/cloudSync.js`. ToS client code doesn't touch the `library` schema yet.
- A ToS book (`dataValidator.js` `validateBook`, `stateAdapter.js` `addBook`) has: `id` (local uuid), `title`, `author` (one string), `cover`, `pageCount`, `status` (`reading|completed|other`), `shelfCategory` (`general|physical-tbr`), `dateAdded`, `dateCompleted`, `links {questIds, curriculumPromptIds, grandfatheredQuestIds?}`, `tags[]`. No ISBN, format or source. The validator rebuilds books field by field, so new fields need validator, adapter and a `SCHEMA_VERSION` bump (currently 19) with a migration.
- Quests link books both ways: `quest.bookId` and `book.links.questIds` (`utils/questLinkRules.js`: max 2 quests per book, the second needing an ability; one-book-one-quest matched on normalised title+author). Rewards merge quest tags with the linked book's tags (`RewardCalculator.js` ~286); `classifyBonusCardState` uses the linked book's tags and page count. `markBookComplete` completes linked quests and curriculum prompts.
- Tags are ids from `assets/data/bookTags.json` (48 tags; categories genre, content, form, provenance, agency), including `audio` ("Audiobook", form) and `special-edition`. `utils/applicableTagIds.js` limits the picker to tags some effect uses. No effect references `audio` today, so the picker already hides it. The side-quest expansion merged in ToS PR #130 and is on `main`; it mentions audiobooks only in prompt text. **This work builds on ToS `main` as it is (schema 19 → 20).**
- Book search is `searchBooks` in `services/BookMetadataService.js` (OpenLibrary, then Google Books), called from the Library add form and edit drawer.
- The Library tab markup is `_includes/character-sheet/tabs/library.html` (Reading / Completed / Other). `LibraryController.renderBooks()` returns early unless all three containers exist, so removing markup needs care.
- Library schema: `library.books` (household-scoped: `title`, `authors text[]`, `isbn13[]`, `isbn10[]`, `cover_url`, `synopsis`, `page_count`, …) and `library.copies` (owner, edition_note, copy_note, origin `libib|photo|manual|scan`), with RLS to household members. Both apps share one origin (`tshardey.github.io`) and the same Supabase session.
- Tierra's ToS library today: 5 Reading (1 ebook, 2 audiobooks, 2 physical), about 45 Other, and the Physical TBR mark on over half of all books. Completed books exist too (shown by year).
- ToS process: migrations live in ToS, are developed against a local stack with pgTAP tests, and reach production only through a user-approved `db push`. ToS code changes go on feature branches with a subagent review; no Beads.

## 6. Decided approach

### 6.1 Book types in ToS

- Every ToS book gets a **type**: `shelf` (a household library book), `audiobook`, `ebook`, or `library-loan`. *(Claude's call on the names and on one field: a loaned audiobook is filed as Audiobook; Tierra's loans today are physical.)*
- A `shelf` book carries a `libraryBookId` pointing at `library.books.id`. It is a lightweight record ToS creates behind the scenes when a shelf book is linked to a quest, so quests, rewards, completion and completed-by-year keep working unchanged. **It never appears in the Audiobooks / Ebooks / Library books lists**, only in Completed once done. *(Claude's call: this keeps every existing quest/reward code path intact instead of teaching each one about library ids.)* Title, author, cover and page count are copied from the library book when linked and refreshed when the library is reachable.
- **Audiobook replaces the manual "Audiobook" tag.** A book of type `audiobook` counts as having the `audio` tag wherever tags are evaluated (rewards, bonus cards, applicable-tag picker), and the picker no longer offers `audio` as a manual tag. Existing books tagged `audio` become type `audiobook` in the migration. Any current or future effect on `audio` sees audiobooks exactly as if tagged.
- `status` stays internally as completed/not completed. The Reading and Other sections, the status choice in the Add form and edit drawer, and `shelfCategory` (Physical TBR) are removed through a schema version bump and migration. A book in progress is simply one linked to an active quest.

### 6.2 Linking a book from a quest

- Wherever a quest picks a book today (new quest, quest edit, quest import, completion), the picker shows **"On our shelf"** results from the household library first, then the player's existing ToS books, then **online search** results.
- Choosing a shelf result links it in one step: ToS reuses the `shelf` record for that `libraryBookId` if one exists, otherwise creates it. No visit to the Library tab.
- Choosing an online result (or typing one in) asks for its type: Audiobook, Ebook, Library book, or **Physical, not in the library yet**. The last one is a plain ToS book that ToS offers to link once that book appears in the household library (§6.9). *(Claude's call: covers the bookstore purchase not scanned yet and the borrowed physical book.)*
- The existing link rules stay: max 2 quests per book, the second needing the ability; one-book-one-quest by title and author.

### 6.3 ToS Library tab

- **Add a book:** cleaned up around the type choice. The type picker comes first, then search/manual entry. Adding a shelf book from here is not needed (link it from the quest), but the search shows "On our shelf" results so a player who looks here isn't confused. *(Claude's call.)*
- **Completed**, grouped by year as today, includes shelf books completed for quests.
- **Audiobooks**, **Ebooks**, **Library books**: one list each, newest first, showing whether each is linked to an active quest or completed.
- Removed: Reading, Other, the Physical TBR badge and its add/edit controls.
- The Archived Quests tab is unchanged.

### 6.4 Shared Tome of Secrets tags

- A new household-scoped table in the library schema holds tags per library book (book id + ToS tag id), readable and writable by household members under RLS, with pgTAP tests. Tags are per book, not per person; either member may add or remove one.
- **For shelf books, the library is the source of truth for tags.** ToS keeps a copy on its `shelf` record so rewards can be calculated offline and so a save works without the library. Tagging in ToS writes through to the library; opening or linking a shelf book refreshes ToS's copy. When the library is unreachable, ToS edits its copy and pushes the change on the next successful sync. *(Claude's call on mechanics; conflict rule: last write wins per tag, which is fine for two people.)*
- Type-derived tags (`audio`) are never written to the library, since they describe a reading, not the book. *(Claude's call.)* `special-edition` is a normal shared tag; linking a shelf book whose copy has an edition label suggests it.
- **Library app:** the book page gets a "Tome of Secrets" section listing the tags by their ToS labels, grouped by category, editable there too. The library filter gains a tag filter (e.g. "Epistolary" + "Fantasy"). The library app reads tag labels and categories from ToS's published `bookTags.json` on the same origin rather than copying the list. *(Claude's call; builder may cache it.)*

### 6.5 One-time migration ("Tidy your ToS library")

Runs per player, once, after the schema version bump, as a review screen (it can be postponed but not skipped forever *(Claude's call)*):

- ToS matches each of the player's books against the household library: ISBN is not stored in ToS today, so matching is by normalised title + author, reusing the library app's similarity approach; strong matches are pre-selected, weaker ones suggested, none applied silently.
- **Matched, but not linked to any quest, not completed, and in no series** (most of Tierra's roughly 45 "Other" books): **removed from ToS** (decided by Tierra). They live in the library app; their tags are first merged into the library's shared tags.
- **Matched, otherwise:** become `shelf` books linked to that library book. Their tags are merged into the library's shared tags (union). Quest links, completion dates and curriculum links are untouched.
- **Unmatched:** the player chooses Audiobook, Ebook, Library book, Physical not in the library yet, link to a library book by hand, or drop. Books tagged `audio` default to Audiobook. Dropping is not offered for a book linked to a quest (active or archived) or completed. *(Claude's call: protects history.)*
- `shelfCategory` is retired regardless of the choice; "it's on our shelf" now comes from the link.
- Signed-out or household-less players get a simpler version: type each book, no matching.

### 6.6 Shopping screen

Removed. ToS `main` no longer has a shopping page (the dollar economy, schema 18, retired `shoppingLog`), and nothing on `main` sets Physical TBR from a purchase. Nothing to change.

### 6.7 Two players, offline, signed out

- AJ's ToS save is separate (his own `tos_saves` row); shelf links and shared tags work the same for him, and the tags are shared through the library.
- Library lookups in ToS must time out quickly and degrade to "On our shelf unavailable" plus online search. Nothing in ToS blocks on the library.
- Signed-out or no household: no shelf results, no shared tags; types and the cleaned-up Library tab still apply.

### 6.8 Series in the library app (requested by Tierra)

- Each library book gets an optional **series**: an editable dropdown of series names, built from the names the household has already used, like the edition picker, with "Add 'X'". *(Claude's call: plus an optional volume number, for sorting.)* It is separate from the Tome of Secrets tags.
- It is editable on the library book page, and filterable in the library ("show the rest of this series").
- **ToS can fill it.** When a `shelf` book is added to a ToS series (The Archive), ToS writes that series name to the library book if the library book has none. ToS never overwrites a series someone has set in the library. *(Claude's call.)* ToS's own series structure (`series.bookIds`) stays ToS's source of truth for series progress in the game.
- ToS series progress: with Reading gone, "in progress" means linked to an active quest. Removed books (§6.5) were never in a series, so no series loses a member.

### 6.9 Builder-check answers *(Claude's calls)*

- **Every book picker gets shelf results.** `createBookSelector` is shared by the quest picker and the external-curriculum picker (`ExternalCurriculumController`). The "On our shelf" results go inside the shared selector, so curriculum prompts get them too.
- **"Physical, not in the library yet" is never linked silently.** When such a book matches a library book (checked whenever ToS loads the household library), the book shows "Found on our shelf — link it?" and links only on a tap. (§6.2 points here.)
- **The save works before the review runs.** The schema migration runs synchronously on load, with no network. It sets each book's type deterministically:
  - books tagged `audio` become Audiobook;
  - every other book becomes **Unsorted**, a temporary type shown as its own list in the Library tab until the review sorts it.

  Unsorted books can still be linked to quests and completed as normal. The review (§6.5) turns Unsorted books into real types and shelf links.
- **Shared tags follow the library live for active quests.** A completed quest's rewards were already paid when it completed, so later tag edits never change history. An active quest's reward preview and bonus-card state use the current shared tags.
- **Matching code is ported to ToS's vanilla JS,** not shared from the library app's TypeScript (`src/lib/photo/similarity.ts`). ToS's tests pin the same thresholds.

## 7. Left to the builder

- Exact ToS field names, the schema version number, and migration code, following ToS's migration and validator patterns.
- How ToS queries the library (direct `library` schema queries with the user session vs. a small RPC), caching, and timeouts.
- The tag table's shape, RLS policies and pgTAP coverage; whether the library app gets a small RPC for tag filters.
- Matching thresholds for the migration, reusing the library app's similarity code or ToS's normalisation.
- Visual design in ToS (Dark Academia, matching nearby screens) and in the library app.
- Splitting this into ToS PRs (schema; ToS data model + migration; quest picker; Library tab; shared tags) and library PRs (tags section + filter).

## 8. Roadmap after this

- **Plan 5: agent cover finder** (see `2026-11-10-barcode-scanner-and-editions-design.md` §8).
- **Stretch: prompt-based book suggestions.** Paste a quest prompt ("a book told through letters or found documents") and an agent reads the indexed descriptions of books on the shelf and suggests a few that fit, possibly using the shared ToS tags as a first filter. Its own design later.
- Location (stretch, original design).
