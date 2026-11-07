# Personal Library — Plan 2: libib CSV Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A household member uploads a libib CSV after each bookstore haul, reviews a preview, and confirms. New books and copies arrive, nothing already recorded is duplicated, and hand edits and deletions survive every re-import.

**Architecture:** Everything runs in the browser in three stages: `parse` (file to rows), `plan` (a pure function of rows, catalog, ledger, owner mapping and review decisions) and `apply` (ordered, chunked writes through an injected store). One new ToS table, `library.libib_import_rows`, remembers which libib rows have been imported, so a deletion in the app isn't undone by the next upload. Writes aren't transactional. They are ordered so that re-running after any failure converges on the same result.

**Tech Stack:** Existing app stack (Vite, React 19, TypeScript, Tailwind 4, Vitest + Testing Library, `@supabase/supabase-js`), plus `papaparse`. ToS: Supabase CLI `npx supabase@2.122.1`, pgTAP.

**Spec:** `docs/superpowers/specs/2026-11-03-personal-library-design.md` (§5 libib CSV, §6.1 Import screen, §6.3)

**Plan series:** Plan 2 of 4. Plan 1 (foundation) is shipped. Plan 3 is the photo pipeline; plan 4 is ToS integration.

## Global Constraints

- **Git commits carry NO `Co-Authored-By` or other Claude/AI attribution trailer**, in both repos. This overrides any default attribution guidance.
- **No Beads.** Don't run `bd` or touch `.beads/`, in either repo, even though ToS `AGENTS.md` asks for it (see D13).
- **ToS owns all migrations.** This repo gets no `supabase/migrations/`. The only schema change is Task 1, on a ToS feature branch with pgTAP coverage.
- **Production database changes happen only in the user-approved step at the end of this plan.** Agents never run `db push`, never merge the ToS PR, and never point a tool at the production project.
- Supabase CLI is `npx supabase@2.122.1`, run **on the host**, not in the container, with `--workdir <ToS worktree>`. App commands (`npm test`, `lint`, `build`, `install`) run through `docker compose run --rm app ...`.
- Browser code uses only `VITE_SUPABASE_PUBLISHABLE_KEY`. No secret key in the client, ever.
- **The repo is public.** Never commit the real export or copy its rows, titles, ids or ISBNs into code, tests, fixtures, commits or PR text. Fixtures are synthetic. Never log CSV row contents; `console.error` gets the error object only.
- `localStorage` keys are prefixed `tpl_`.
- Reuse `diffPatch` from `src/lib/edited-fields.ts` and `normalizeBookInput` from `src/lib/normalize.ts`. Don't write parallel diff or normalisation logic.
- `user_edited_fields` holds camelCase TS keys such as `pageCount`. The importer reads it and never adds to it: imported values aren't user edits, so the importer doesn't call `markEdited`.
- Physical books only; no reading status. The CSV's `status`, `began`, `completed`, `rating` and `review` columns are ignored.

## What the real export contains

Profiled read-only from `library_20261103_234851.csv`, and rechecked against two exports made on 2026-11-06: a 131-row re-export of the user's collection and an 82-row export of the partner's collection. Counts only; no rows were copied here. Findings below are from the Nov 3 file unless they say otherwise.

| Property | Finding | Consequence |
|---|---|---|
| Size | 127 rows, 175 KB, about 1.4 KB per row | A 500-book household is under 1 MB |
| Encoding | UTF-8, no BOM, LF line endings, unquoted header | Also accept BOM, CRLF and windows-1252 (a re-save in Excel produces them) |
| Columns | The 31 in spec §5, all rows width 31 | Look up columns by name; tolerate extras and reordering |
| `collection` | All 127 are `Tierra's Books`. The partner's collection arrives as **its own file** with a different collection name and the same 31-column header; the two files share no id and no ISBN | libib exports each collection as a separate file, so `allIds` covers one collection at a time. The parser still accepts a file holding several |
| `item_type` / `copies` | All `book` / all `1`, in all three files | Neither other value has ever been observed; synthetic tests stay |
| `id` | 10-character alphanumeric, unique. **Stable across two exports 3 days apart:** all 127 Nov 3 ids reappear with the same ISBN, title and copies, plus 4 new rows | Dedupe on id is sound for the observed window (D1) |
| `ean_isbn13` | Present and checksum-valid on all 127; 107 are `978`, 20 are `979`. Also valid on every row of both Nov 6 files | No no-ISBN row has been observed, in the partner's file either; synthetic tests stay (D5) |
| `upc_isbn10` | 106 valid and agreeing with the ISBN-13; 20 blank (all the `979`s); **1 is an 11-digit non-ISBN value** | The column is really "UPC or ISBN-10", so validate it before storing |
| `creators` | 8 rows with commas; 4 with parenthesised roles (Translator, Illustrator); **one role contains a comma**; 1 row has only role-marked names; 2 single-name authors; both `J. K. Name` and `J K Name` initial styles. The partner's file has a value with a comma before a suffix like `Jr` | Comma split must respect parentheses and keep suffixes with their name (D7) |
| `first_name` / `last_name` | Broken by that comma (a `last_name` value is a role fragment ending in `)`) | **Never use these columns** |
| `title` | 14 with parentheses, **13 of them edition qualifiers** such as "Deluxe Limited Edition"; 18 with colons, 13 of those naming a book, volume or part; 30 leading articles; 9 apostrophes; 4 ampersands | Editions belong on the copy (D6). Series make pre-colon matching unsafe to auto-merge (D5) |
| `description` | 17 empty, 25 with `"`, 17 with embedded newlines, up to 3,724 characters | Needs a real CSV parser |
| `length` / `publish_date` / `publisher` | 9 / 1 / 2 blank; dates are `YYYY-MM-DD` | Blank becomes null |
| `group`, `tags`, `notes`, `price`, others | Empty on every row | Ignored |
| Duplicates | No repeated ISBN, no repeated normalized title + creators, no repeated pre-colon title + creators | The multi-copy paths have no real example yet, so synthetic tests pin them |

## Decisions

Where this refines the spec, the spec's §6.3 ladder still applies and the reason is given. The spec isn't edited.

**D1. Dedupe identity is the libib `id`, recorded on the copy and in a ledger.** A row is known if its id is in the ledger or on a live copy. `seen = max(ledger.copiesSeen, live copies with that id)`, and the row needs `copies - seen` more copies (never negative). Taking the max means a lost ledger write can't cause a duplicate. Ids were stable across two real exports 3 days apart (127 of 127). That is a short window, so D3's rotated-id protection stays: it costs little, and it limits the damage if ids ever change.

**D2. A small ledger table is required; this is the one schema change.** A deleted book or copy leaves no trace today, so its row would look brand new and come back on every upload, which is the spec's §4 anti-goal. Alternatives rejected: `localStorage` tombstones (per device; the partner's phone wouldn't know), soft-delete columns (every reader, including ToS in plan 4, must filter), and listing resurrected rows for un-ticking at each import (the question never goes away). `library.libib_import_rows` survives book and copy deletes because it has no FK to them, needs no change to delete UI, and stays out of every read path.

**D3. "Already recorded" versus "genuine second copy" when an unseen id's ISBN matches a book.** The data can tell these apart only partly, so:

| Same-owner copies on the matched book | Reading | Behavior |
|---|---|---|
| None | Household owns it again under another owner | Add copy, no question |
| Any libib copy whose id is **absent from this file** | **Ambiguous:** id changed or item rescanned, or the old item was removed in libib and a second one bought | Review `rescan`, default **link** to that copy (same physical copy; no new copy) |
| Otherwise, any photo or manual copy (no libib id) | **Ambiguous:** the same book entered twice, or a real second copy | Review `existing_copy`, default **add copy** (spec §6.3's stated behavior) |
| Otherwise, all are libib copies whose ids are **also in this file** | Two live libib items | Add copy, no question |

**Precedence for a mixed book is the table's order, top to bottom:** absent-id libib copy first, then photo or manual copy, then all in-file ids. Copies already consumed by a link in this run don't count.

The rotated-id default is link because a mass id change would otherwise duplicate the whole library, while a missed copy takes one tap to add. Decisions take effect through the ledger, so a row is never asked about twice. Known wrong default: collections do export separately, so if both map to Shared (or to one member), a same-ISBN row in the second file reads as a rescan and defaults to link. It appears in review, where "add copy" corrects it.

**D4. Repeat imports only fill empty book fields; they never replace values.** Spec §6.3 allows "skip, or update non-edited fields". Replacement fails in practice: two rows for one book (one per collection) with different descriptions would flip the value on every import, and later photo or manual values would be overwritten by libib. Fill-only converges: a second run writes nothing. Exception: `isbn13` and `isbn10` union in new values unless edited, so the next row with that ISBN matches directly. Trade-off: a metadata correction made in libib after import doesn't propagate; the user edits it in the app. **Existing copies are never patched at all**, so `ownerUserId`, `editionNote` and `location` can't be clobbered, whether or not they are in `user_edited_fields`. Changing the collection mapping doesn't re-tag existing copies.

**D5. No-ISBN and differing-ISBN rows match on title and author, through review, never silently.** Applies when no ISBN matched, including a row with an ISBN that isn't in the catalog: a paperback and hardback are one book (Goal 2), and the spec's preview already reserves "possible matches to review". The one exception is adoption, below.
- **Adoption (no review):** a book with **no copies** and the same `titleKey` and overlapping authors takes the row as a copy, overriding a retained `new_book` decision. Without this, a retry after "Separate book" inserted the book but failed on copies would insert a second book, and an interrupted plain new-book row would raise a question on retry. A book whose copies were all deleted by hand is adopted too. That's acceptable because the row is genuinely unseen and the book has no competing copy. The added copy still shows in the preview's counts. **Adoption respects reservations:** a retried file must not hand a row another row's book, so a copyless book is first reserved for the row it belongs to (Task 4).
- **Strong:** same `titleKey` and overlapping `authorKey`s. Default **add copy**.
- **Weak:** same `baseTitleKey` (text before the first `:` or ` - `) and overlapping authors, not strong. Default **new book**. Colon titles are often series entries ("Series: Book 2"), so these must not merge by default.
- **Authors must overlap.** A shared title alone never matches, except when both sides have no authors at all (needed so adoption converges after a failure; see Task 5).
- **An empty key never matches anything.** A title or author made only of punctuation normalises to `""`, which must not equal another `""`.
- **No fuzzy matching.** Plan 3 owns that. A near-miss becomes a visible separate book, which is recoverable.
- **False merges** are caught by choosing "Separate book" in review. After the fact, deleting the copy and adding the book by hand sticks, because the ledger keeps the row from returning. Automatic merge or split tools are out of scope.

**D6. A trailing parenthetical containing the word "edition" moves from the title to the new copy's `editionNote`.** 13 of 127 real titles have one, and it is the spec's Goal 2 example: one book, a deluxe copy and a bookstore copy. Other parentheticals stay in the title. Matching strips the qualifier from catalog titles too.

**D7. `authors` comes from `creators` only, split on commas outside parentheses.** Role-marked names are dropped when an unmarked name remains; if all are role-marked, keep them all with the role removed. Book search looks for authors, and a translator isn't one. **A comma-separated token that is only a suffix joins the preceding name instead of becoming an author:** `Jr`, `Sr`, `II`, `III`, `IV`, `PhD`, `MD`, case-insensitive, compared with periods removed (so `Jr.` and `Ph.D.` count). The join keeps the text as written (`Wren Halloway, Jr.`) and happens before role handling. A suffix with no preceding name stays a name. `BookForm` uses the same rule for its comma-separated authors field; otherwise saving a book unchanged would split `Wren Halloway, Jr` in two and mark `authors` as edited, which would then block fill-only updates.

**D8. Owner mapping is chosen per collection at import time and has three choices: a member, Shared, or Skip this collection.** Prefill from a `tpl_libib_owner_map` saved choice if that member still exists, otherwise from a single member whose display name is a whole word of the collection name, ignoring possessive `'s`. Otherwise it's unset, and Confirm stays disabled until every collection has a choice. Skip exists because the partner may not have joined the household yet; skipped rows write nothing and arrive on a later upload. A partner collection whose name doesn't match gets asked about, never guessed.

**D9. Removals are permanent but visible.** A row with ledger history, no live copies and no rise in `copies` is listed as "Removed here earlier, staying removed", with an unticked "Import again" per row. This is the only undo for an accidental delete. If `copies` rises in libib, the difference is added even after a delete, because that is a new purchase. A row whose `copies` falls, or a row missing from the file, deletes nothing (spec §6.3).

**D10. Partial failure relies on ordering and convergence, not a transaction.** Write order: books, links, copies, patches, ledger **last**. Links go before copies because a `link` row with `copies > 1` also adds copies: written the other way round, a failure between them makes the row look known and it never links, leaving a duplicate. A failure before the ledger leaves copies whose `libib_id` prevents duplicates; a failure after a book insert leaves a copyless book that the next run adopts (D5) and fills. A failure at the ledger stage leaves pending ledger entries, and the preview must still offer a way to write them (Task 6), because rows without a ledger entry lose their protection against D2's resurrection. A transactional RPC was rejected: it would put the whole plan format and fill rules into plpgsql for a benefit a two-person household doesn't need. Accepted narrow gaps: two devices importing at the same moment can create duplicate books, since there is no lock; a book deleted after a ledger-stage failure but before any re-upload comes back as new; and a row whose `copies` rises while it has hand-deleted copies (ledger above live) adds one extra deletable copy if the run fails before the ledger, because nothing records the intent earlier. That last gap needs `copies >= 2`, which has never been observed.

**D11. The plan is recomputed against a fresh catalog at Confirm.** If the summary differs from what the user saw, nothing is written and the updated preview returns. Book patches also compare `updated_at`, so an edit landing in the remaining milliseconds wins, and the patch is skipped and reported.

**D12. Covers come from OpenLibrary, as a separate fill-only step after import.** The CSV has no cover column, so an import alone would give a wall of placeholders. Checked with OpenLibrary's documented example ISBN: `api/books?jscmd=details` allows any origin and returns `details.covers` as ids, which can include `-1`; that record had no `description`. **Lookup is automatic, and only after Confirm:** the done screen starts it after an import that wrote anything, with visible progress and a short line saying it is looking up covers on OpenLibrary. `ledger_only` counts as writing: a finished retry is the first chance to look up the books from the interrupted run. The import is already complete and is shown as complete, so a lookup failure never reads as an import failure and offers a retry. `Find missing covers` stays on the pick screen for retries and for books missed earlier. Nothing is looked up before Confirm. **Google Books is left out of this plan:** the anonymous request returned HTTP 429, and spec §6.3 says "may". Nothing else depends on Task 7.

**D13. Repo process.** ToS `AGENTS.md` mandates Beads and the spec §6.5 repeats it; the user has decided against Beads for this work, and the user's decision wins. The ToS base is `origin/main`: the local ToS `main` predates the library migration, and the main checkout is on an unrelated branch.

## Review Focus

Each has a test in the named task.

1. **The catalog read fails or is truncated.** A failed `listBooks`, or the 1000-row PostgREST cap, must not read as "those books don't exist" and duplicate them. *(Task 5 paging, Task 6 failure.)*
2. **Every libib id changes between exports.** No mass duplication: all rows land in review, defaulting to link. *(Task 4.)*
3. **File opened and re-saved in Excel.** Windows-1252 accents, CRLF, and ISBNs like `9.78E+12` give a visible warning, and the row isn't matched on a garbage ISBN. *(Task 2.)*
4. **Partner hasn't joined yet, or the collection name matches nobody.** Confirm stays disabled until a choice is made; Skip writes nothing and a later upload imports those rows. *(Tasks 3, 4, 6.)*
5. **Phone sleeps or the session expires mid-write.** At every failure point, re-running reaches the same final state as an uninterrupted run, and the screen still offers the write that finishes it. *(Task 5, Task 6.)*

---

### Task 1: ToS — import ledger table and pgTAP coverage

**Files (new ToS worktree):**
- Create: `supabase/migrations/20261106000000_library-libib-import-rows.sql`
- Create: `supabase/tests/database/library_libib_ledger.test.sql`

Set up the worktree off `origin/main`, never the main checkout: `git -C C:/Users/tierr/Github/tome-of-secrets fetch origin`, then `git -C C:/Users/tierr/Github/tome-of-secrets worktree add C:/Users/tierr/Github/tome-of-secrets-libib-ledger -b libib-import-ledger origin/main`. Below, `<tos-wt>` means that worktree path. Stop any local stack running from another ToS worktree before `start`.

**Interfaces — Produces:**

```sql
library.libib_import_rows(
  household_id uuid not null references library.households (id) on delete cascade,
  libib_id     text not null check (libib_id <> ''),
  copies_seen  int  not null check (copies_seen >= 1),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  primary key (household_id, libib_id)
)
```

Deliberately no FK to books or copies, so rows outlive them. Add the `library.set_updated_at()` trigger. RLS on, with `select`, `insert` and `update` policies `to authenticated` using `library.is_member(household_id)`. `revoke all ... from public, anon`, then `grant select, insert, update ... to authenticated`. **No delete grant.** Column comment: highest copy count the importer has accounted for; lets deleted books and copies stay deleted across re-imports. Idempotent, like `20261103000000_library-schema.sql`.

- [ ] **Step 1: Write the failing pgTAP test**, following the setup style of `library_rls.test.sql` (two `auth.users`, `set local role authenticated`, `request.jwt.claims`, a `test_vals` scratch table). One assertion each:
  - A (member) upserts `('lb1', 2)` via `insert ... on conflict (household_id, libib_id) do update`: `lives_ok`, and a second upsert to 3 leaves one row with `copies_seen = 3`.
  - B (non-member) selects: `is_empty`. B inserts with A's household: `throws_ok` with `42501`. B updates A's row: 0 rows changed.
  - `anon` selects: `throws_ok`, permission denied.
  - A deletes from the ledger: `throws_ok`, permission denied.
  - A inserts `copies_seen = 0`: `throws_ok` with `23514`. A inserts `libib_id = ''`: `throws_ok` with `23514`.
  - After B creates their own household, B inserts the same `libib_id = 'lb1'` there: `lives_ok` (the key is per household).
  - A inserts a book and a copy with `libib_id = 'lb1'`, then deletes the book: the ledger row still exists.
- [ ] **Step 2: Run it to verify it fails.** On the host: `npx supabase@2.122.1 start --workdir <tos-wt>`, then `npx supabase@2.122.1 test db --workdir <tos-wt>`. Expected: FAIL, `library.libib_import_rows` doesn't exist.
- [ ] **Step 3: Write the migration** per the contract.
- [ ] **Step 4: Verify.** `npx supabase@2.122.1 db reset --workdir <tos-wt>`, then `test db` again. Expected: both `library_rls.test.sql` and the new file pass. Then `cd tests && npm ci && npm test` in the worktree: Jest green.
- [ ] **Step 5: Review, commit, PR.** Subagent review of the diff (RLS holes, grants, idempotency). Commit `feat(library): libib import ledger table`. Push `libib-import-ledger` and open a PR against `main`. **Leave it unmerged and don't run `db push`.** The PR body says production needs the user-approved step, and that no dashboard change is needed because `library` is already exposed.

### Task 2: CSV parsing and ISBN validation

**Files:**
- Modify: `package.json` (`docker compose run --rm app npm install papaparse` and `npm install -D @types/papaparse`), `.gitignore` (add `library_*.csv`)
- Create: `src/lib/libib/isbn.ts`, `src/lib/libib/parse.ts`, `src/lib/libib/fixtures.ts`
- Modify: `src/lib/normalize.ts` (`joinNameSuffixes`, `splitAuthors`), `src/components/book/BookForm.tsx` (authors field uses `splitAuthors`; ISBN fields keep `splitList`)
- Test: `src/lib/libib/isbn.test.ts`, `src/lib/libib/parse.test.ts`, `src/lib/normalize.test.ts`

**Interfaces — Produces:**

```ts
// isbn.ts: each returns the cleaned value, or null when invalid
normalizeIsbn13(raw: string): string | null   // strips spaces and hyphens; 13 digits, 978/979, valid checksum
normalizeIsbn10(raw: string): string | null   // strips; 9 digits + digit or X (uppercased), valid checksum
isbn10To13(isbn10: string): string
canonicalIsbns(b: { isbn13: string[]; isbn10: string[] }): Set<string>  // isbn13 plus isbn10To13(isbn10)

// normalize.ts (D7)
joinNameSuffixes(tokens: string[]): string[]   // a suffix-only token joins the previous token with ", "
splitAuthors(s: string): string[]              // joinNameSuffixes(splitList(s))

// parse.ts
interface LibibRow {
  libibId: string;
  rowNumber: number;            // 1-based data row, not a physical line
  collection: string;           // "" when blank
  book: BookInput;              // passed through normalizeBookInput; coverUrl null
  editionNote: string | null;   // D6
  copies: number;
}
type SkipReason = "missing_id" | "missing_title" | "wrong_column_count" | "not_a_book";
interface SkippedRow { rowNumber: number; title: string | null; reason: SkipReason }
type RowWarning = "invalid_isbn" | "unreadable_copies" | "duplicate_id";
interface ParsedFile {
  rows: LibibRow[];
  skipped: SkippedRow[];
  warnings: { rowNumber: number; title: string; warning: RowWarning }[];
  spreadsheetDamage: boolean;   // an ISBN looked like 9.78E+12
  collections: string[];        // distinct, file order
  allIds: Set<string>;          // every id in the file, including non-book and skipped-collection rows
}
class LibibFileError extends Error {
  code: "not_text" | "not_libib" | "empty" | "malformed" | "too_large" | "too_many_rows";
  missingColumns: string[];
}
readLibibFile(file: File): Promise<ParsedFile>  // size limit, decode, parse
decodeLibibBytes(bytes: Uint8Array): string     // fatal UTF-8, else windows-1252; NUL byte or PK header throws not_text
parseLibibCsv(text: string): ParsedFile

// fixtures.ts: synthetic only, not imported by app code
libibCsv(rows: Partial<Record<string, string>>[]): string   // full 31-column header, RFC 4180 quoting, defaults
```

Rules: `MAX_FILE_BYTES = 10 * 1024 * 1024`, `MAX_ROWS = 10_000`. Required columns: `id, item_type, title, creators, collection, ean_isbn13, upc_isbn10, description, publisher, publish_date, length, copies`. Papa options: `header: false`, `delimiter: ","`, `skipEmptyLines: "greedy"`; strip a BOM first, and treat any Papa `Quotes` error as `malformed`, because an unclosed quote swallows the rest of the file. Later rows with a repeated id are dropped, keeping the first row's fields and the highest `copies`, with a `duplicate_id` warning. `copies`: blank becomes 1 with no warning; anything other than an integer from 1 to 50 becomes 1 with `unreadable_copies`. `length`: a positive integer, otherwise null. An ISBN-10 with no ISBN-13 also stores the derived ISBN-13. Authors per D7, edition per D6 (`/\s*\(([^)]*\bedition\b[^)]*)\)\s*$/i`). Ignore `first_name`, `last_name`, `added`, `group`, `tags` and `notes`.

- [ ] **Step 1: Write the failing tests.**
  - `isbn.test.ts`: `normalizeIsbn13("978-0-00-000000-2")` gives `"9780000000002"`; `"9790000000001"` valid; `"9780000000003"` (bad checksum) null; `"9.78E+12"` null; `""` null. `normalizeIsbn10("000000006x")` gives `"000000006X"`; `"12345678901"` (11 digits) null. `isbn10To13("000000006X")` gives `"9780000000064"`. `canonicalIsbns({ isbn13: ["9780000000002"], isbn10: ["000000006X"] })` has both ISBN-13s.
  - `parse.test.ts`, shapes from the real export with invented data:
    - A description containing `""quoted""`, commas and a newline round-trips, and the row count stays right.
    - Reordered columns and an extra column parse; BOM and CRLF parse.
    - `creators: "Wren Halloway, Ada Lund (Translator), Ben Ito (Translator)"` gives `["Wren Halloway"]`.
    - `creators: "Cass Mori (Illustrator, Created by)"` gives `["Cass Mori"]`, not a role fragment.
    - `creators: "Wren Halloway, Ada Lund"` gives both. A one-word creator such as `"Vale"` stays whole.
    - **Suffixes (D7):** `"Wren Halloway, Jr"` gives `["Wren Halloway, Jr"]`; `"Wren Halloway, Jr., Ada Lund"` gives `["Wren Halloway, Jr.", "Ada Lund"]`; `"Ada Lund, Wren Halloway, iii"` gives `["Ada Lund", "Wren Halloway, iii"]`. Each of `Jr`, `Sr`, `II`, `III`, `IV`, `PhD`, `MD`, in upper and lower case, with and without a period, joins. `"Wren Halloway, Jr, Ph.D."` gives one name. A name that merely contains a suffix stays separate: `"Wren Halloway, Ivy Mdala"` gives two. A leading suffix stays a name: `"Jr, Ada Lund"` gives two. A suffix follows its role-marked name: `"Wren Halloway, Ada Lund (Translator), Jr"` gives `["Wren Halloway"]`.
    - `normalize.test.ts`: `splitAuthors("Wren Halloway, Jr., Ada Lund")` gives both names; `splitAuthors("")` gives `[]`; `splitList` itself is unchanged.
    - `title: "The Glass Orchard (Deluxe Limited Edition)"` gives title `"The Glass Orchard"` and `editionNote: "Deluxe Limited Edition"`. `"The Glass Orchard (Original)"` keeps its title with a null note.
    - The 11-digit `upc_isbn10` drops silently with the valid ISBN-13 kept and no warning. A blank ISBN-13 with a valid ISBN-10 stores both.
    - Bad-checksum `ean_isbn13` gives `isbn13: []` with an `invalid_isbn` warning.
    - **RF3:** `ean_isbn13: "9.78E+12"` sets `spreadsheetDamage: true`, `isbn13: []`. `decodeLibibBytes` on windows-1252 bytes for `é` returns `é`.
    - `copies`: `"2"` gives 2; `""` gives 1 with no warning; `"0"`, `"abc"`, `"51"` give 1 with `unreadable_copies`.
    - `item_type: "movie"` is skipped as `not_a_book`, and its id is in `allIds`. Blank id gives `missing_id`, blank title gives `missing_title`, a short row gives `wrong_column_count`; each skip keeps its `rowNumber`, and good rows still parse.
    - Duplicate id with `copies` 1 and 3 gives one row with `copies: 3` and a `duplicate_id` warning.
    - File errors: no `collection` column gives `not_libib` with `missingColumns: ["collection"]`; a Goodreads-shaped header gives `not_libib`; header only gives `empty`; empty string gives `empty`; an unclosed quote gives `malformed`; bytes starting `PK` give `not_text`; `new File` over 10 MB gives `too_large` without decoding; 10,001 data rows give `too_many_rows`, and exactly 10,000 parse.
- [ ] **Step 2: Run to verify failure.** `docker compose run --rm app npm test -- src/lib/libib`. Expected: FAIL, modules missing.
- [ ] **Step 3: Implement** per Interfaces.
- [ ] **Step 4: Verify.** Same command. Expected: PASS.
- [ ] **Step 5: Commit.** `feat: parse libib CSV exports`.

### Task 3: Match keys, fill-only patch, owner mapping

**Files:**
- Create: `src/lib/libib/match-keys.ts`, `src/lib/libib/fill-patch.ts`, `src/lib/libib/owner-map.ts`
- Test: `src/lib/libib/match-keys.test.ts`, `src/lib/libib/fill-patch.test.ts`, `src/lib/libib/owner-map.test.ts`

**Interfaces — Produces:**

```ts
titleKey(title: string): string       // see rules
baseTitleKey(title: string): string   // titleKey of the text before the first ":" or " - "
authorKey(name: string): string
authorsOverlap(a: string[], b: string[]): boolean   // true when both arrays are empty, or any non-empty authorKey is shared

fillPatch(book: Book, incoming: BookInput): { changed: string[]; patch: Partial<BookInput> }

type OwnerChoice = string /* member userId */ | "shared" | "skip";
type CollectionMapping = Record<string, OwnerChoice | undefined>;
suggestOwners(collections: string[], members: HouseholdMember[], saved: CollectionMapping): CollectionMapping
loadSavedMapping(householdId: string): CollectionMapping   // tpl_libib_owner_map; try/catch, {} on failure
saveMapping(householdId: string, mapping: CollectionMapping): void
ownerUserIdFor(choice: OwnerChoice): string | null   // "shared" gives null
```

Rules. `titleKey`: strip the D6 edition parenthetical, NFD and strip marks (`/\p{M}/gu`), lowercase, delete apostrophes (straight and curly), `&` becomes `and`, everything else outside `[\p{L}\p{N}]` becomes a space (`/[^\p{L}\p{N}]+/gu`; an ASCII class would reduce Cyrillic or CJK titles to an empty key), collapse, drop one leading `the`, `a` or `an`. `authorKey`: same base normalisation, then join runs of single-letter tokens (counted in code points) so `J. K. Vale`, `J K Vale` and `JK Vale` all give `jk vale`. **An empty key never matches anything:** callers skip title matching on an empty `titleKey` or `baseTitleKey`, and `authorsOverlap` ignores empty author keys. Stripping marks also merges a few non-Latin spellings, such as voiced kana. That only widens match candidates, which is acceptable. `suggestOwners` compares display names and collection names with the same base normalisation, and an empty display-name key suggests nobody. `fillPatch`: `before` is `normalizeBookInput` of the book's fields; `after` starts as `before`; for each key in `authors, synopsis, coverUrl, isbn13, isbn10, pageCount, publisher, publishDate` not in `book.userEditedFields`, arrays `isbn13` and `isbn10` take the order-preserving union, and every other key takes `incoming` only if `before` is null or an empty array. Return `diffPatch(before, after, keys)`. `title` is never in the key list.

- [ ] **Step 1: Write the failing tests.**
  - `match-keys.test.ts`: `titleKey("The Glass Orchard (Deluxe Limited Edition)") === titleKey("glass orchard")`; `"Moon's Tide"` equals `"Moon’s Tide"`; `"Salt & Ember"` equals `"Salt and Ember"`; `"Poète"` equals `"Poete"`; `"The Glass Orchard (Original)"` doesn't equal `"The Glass Orchard"`. `baseTitleKey("Ember Road: Book 2") === baseTitleKey("Ember Road: Book 3")`. `authorKey` equal for the three initial styles. `authorsOverlap(["A B"],["C D","a b"])` true; `(["A B"],[])` false; `([],[])` true.
  - `match-keys.test.ts`, non-Latin and empty keys: `titleKey("Стеклянный сад")` is non-empty and equals `titleKey("СТЕКЛЯННЫЙ САД")`, and differs from `titleKey("Соляная дорога")`. `titleKey("硝子の果樹園")` is non-empty and differs from `titleKey("塩の道")`. `authorKey("波多野 蓮")` is non-empty. `titleKey("!!!")` and `baseTitleKey(": Book 2")` are `""`. `authorsOverlap(["!!!"],["!!!"])` and `(["!!!"],[])` are false.
  - `fill-patch.test.ts`:
    - Empty `synopsis` filled and `changed` is `["synopsis"]`.
    - Non-empty `publisher` differing from incoming: no change.
    - Null `pageCount` with `userEditedFields: ["pageCount"]`: **not filled** (user cleared it).
    - `isbn13: ["9780000000002"]` plus incoming `["9780000000019"]`: union, existing first. Same with `"isbn13"` edited: untouched. Same ISBN incoming: no change, empty patch.
    - Patch never contains `title`, even with incoming different. Untidy stored `"  Publisher "` with no real change: empty patch.
    - Applying the returned patch and calling again gives an empty patch.
  - `owner-map.test.ts`: `"Tierra's Books"` with member `Tierra` suggests their id; a collection matching no member, or two members, is undefined (**RF4**); a saved mapping wins, unless the saved userId isn't a member any more, when name matching applies; saved `"skip"` and `"shared"` are honored; a throwing `localStorage` gives `{}`, no crash; the key starts with `tpl_`.
- [ ] **Step 2: Run to verify failure.** `docker compose run --rm app npm test -- src/lib/libib`. Expected: FAIL for the new modules.
- [ ] **Step 3: Implement** per Interfaces.
- [ ] **Step 4: Verify.** Same command. Expected: PASS.
- [ ] **Step 5: Commit.** `feat: libib match keys, fill-only patch, owner mapping`.

### Task 4: Import planner

**Files:**
- Create: `src/lib/libib/plan.ts`
- Test: `src/lib/libib/plan.test.ts`

**Interfaces:**
- Consumes: `LibibRow`, `ParsedFile`, `canonicalIsbns` (Task 2); `titleKey`, `baseTitleKey`, `authorsOverlap`, `fillPatch`, `CollectionMapping`, `ownerUserIdFor` (Task 3).
- Produces:

```ts
type BookRef = { kind: "existing"; bookId: string } | { kind: "pending"; libibId: string };
type ReviewDecision =
  | { action: "link"; copyId: string }
  | { action: "add_copy"; book: BookRef }
  | { action: "new_book" };
type ReviewReason = "rescan" | "existing_copy" | "same_title" | "similar_title" | "several_isbn_matches";
interface ReviewItem {
  libibId: string; rowNumber: number; title: string; authors: string[];
  reason: ReviewReason; options: ReviewDecision[]; chosen: ReviewDecision;
}
interface PlannedCopy { book: BookRef; ownerUserId: string | null; editionNote: string | null; libibId: string }
interface ImportSummary {
  newBooks: number; newCopies: number;  // newCopies excludes the first copy of each new book
  filled: number; unchanged: number; review: number; removed: number; skippedCollection: number;
}
interface ImportPlan {
  newBooks: { libibId: string; input: BookInput }[];
  newCopies: PlannedCopy[];
  links: { copyId: string; libibId: string }[];
  bookPatches: { bookId: string; expectedUpdatedAt: string; title: string; patch: Partial<BookInput> }[];
  ledger: { libibId: string; copiesSeen: number }[];
  review: ReviewItem[];
  removed: { libibId: string; title: string }[];
  summary: ImportSummary;
}
interface PlanInput {
  file: ParsedFile; catalog: BookWithCopies[]; ledger: Map<string, number>;
  mapping: CollectionMapping;   // every collection in file has a choice; caller enforces
  decisions: Map<string, ReviewDecision>;
  restore: Set<string>;         // libibIds ticked "Import again"
}
buildImportPlan(input: PlanInput): ImportPlan   // pure and deterministic
sameSummary(a: ImportSummary, b: ImportSummary): boolean
type PlanState = "writes" | "ledger_only" | "removed_only" | "nothing";
planState(plan: ImportPlan): PlanState
```

`planState`: `writes` when any of `newBooks`, `newCopies`, `links` or `bookPatches` is non-empty; otherwise `ledger_only` when `ledger` is non-empty (`removed` may be too); otherwise `removed_only` when `removed` is non-empty; otherwise `nothing`. So **`nothing` means every write list is empty, ledger included, and `removed` is empty.**

**Algorithm.** Process rows in file order against a working catalog that includes pending new books, pending fills and consumed link targets. Rows whose collection maps to `"skip"` only bump `skippedCollection`. Let `live` be copies with this `libibId`, `seen = max(ledger, live.length)`.

| Row state | Outcome |
|---|---|
| `live >= 1`, `copies <= seen` | Fill the live copy's book. Bucket: `filled` if patched, else `unchanged` |
| `live >= 1`, `copies > seen` | Add `copies - seen` copies to that book; also fill |
| `live = 0`, `seen > 0`, `copies > seen` | Run the ladder for `copies - seen` copies |
| `live = 0`, `seen > 0`, in `restore` | Run the ladder for `copies` copies |
| `live = 0`, `seen > 0`, otherwise | `removed` |
| `seen = 0` | Run the ladder for `copies` copies |

**Ladder.** Each `chosen` is `decisions.get(libibId)` if it is still among `options`, otherwise the default. A retained `add_copy` pointing at `{ kind: "pending", libibId: X }` means the book now holding X's copy, because on a retry X's book may already exist; it resolves to that `{ kind: "existing" }` option.
1. ISBN: books sharing any `canonicalIsbns` value. More than one: review `several_isbn_matches`, one `add_copy` option per book, default the oldest `createdAt`. Exactly one: apply the D3 table, in its stated precedence, using `file.allIds`; review `rescan` (default link to the first absent-id copy) or `existing_copy` (default add copy), each offering `link` and `add_copy`.
2. Adoption (D5): a book with no live or planned copies, a non-empty matching `titleKey` and `authorsOverlap`. Add the copy with no review, ignoring any retained decision including `new_book`. With several, take the oldest `createdAt`, then lowest id. **Reservations:** before the main loop, for each ladder row in file order, reserve one still-unreserved copyless book with a non-empty matching `titleKey` and overlapping authors for that row if its canonical ISBNs match that book, or if it retains a `new_book` decision (ISBN matches first, then `new_book` rows, each taking the oldest, then lowest id). Adoption skips a book reserved for another row. Without this, rows inserted in one batch can tie and an earlier row takes a book inserted for a later one.
3. Strong candidates (D5): review `same_title`, an `add_copy` per candidate plus `new_book`, default first candidate. Pending books count as candidates, via `{ kind: "pending" }`.
4. Weak candidates: review `similar_title`, same options, default `new_book`.
5. Otherwise a new book.

Steps 3 and 4 and adoption skip empty keys (Task 3).

`link` uses one copy and adds `count - 1` more. A linked copy is consumed, so a second row can't link to it. `add_copy` also applies `fillPatch` (or merges into the pending input). Patches collapse to one per book. A ledger entry is emitted when `max(seen, copies)` differs from the stored value, or the row was processed by the ladder. It is not emitted for `removed` rows or skipped collections. A ledger-only heal counts as `unchanged`.

- [ ] **Step 1: Write the failing tests.** Build rows through `parseLibibCsv(libibCsv([...]))`; catalog by small `book()` and `copy()` factories local to the test. Each `it` pins one line:
  - *Fresh:* one row gives `newBooks: 1, newCopies: 0`, one planned copy with `libibId`, ledger `copiesSeen: 1`. `copies: "2"` gives one new book, `newCopies: 1`, two planned copies with the same id, ledger 2.
  - *Unchanged:* the row's id on a live copy and in the ledger, all fields present: every write list empty, `unchanged: 1`.
  - *Dedup, ledger healing:* live copy with the id, no ledger entry: no copy, ledger entry `1`, `unchanged: 1`.
  - *One book, many copies:* same ISBN in both collections, fresh: one new book, two copies with different owners and ids (`newBooks: 1, newCopies: 1`). Same ISBN, same collection, different ids, both in file: one book, two copies, no review.
  - *Across uploads:* catalog has the book with owner A's copy from id X. A file with only id Y (owner B): adds a copy, no review. *Same-file row X also present, owner A, new id Y owner A:* adds a copy, no review.
  - *`copies` count:* known row 1 to 2 adds exactly 1. 2 to 1 adds and removes nothing, ledger stays 2.
  - *Ambiguity, rescan (**RF2**):* every row's id differs from the catalog's, ISBNs and owners match, old ids absent from file: every row in `review` with reason `rescan`, chosen `link`; `newCopies: 0, newBooks: 0`, and `links` has one entry per row. Choosing `add_copy` via `decisions` adds a copy instead.
  - *Link consumed:* two new rows, same ISBN and owner, one absent-id copy: first links, second has no resolvable target and adds a copy.
  - *Ambiguity, photo or manual:* same-owner `origin: "photo"` copy, ISBN match: review `existing_copy`, chosen `add_copy` (`newCopies: 1`). Choosing `link` sets the copy's `libibId` and adds nothing. Different-owner photo copy: add, no review.
  - *Mixed book (D3 precedence):* same-owner copies are one absent-id libib copy, one photo copy and one in-file libib copy: review `rescan`, chosen links the absent-id copy. Without the absent-id copy: review `existing_copy`, chosen `add_copy`.
  - *Adoption:* unseen no-ISBN row, catalog book with zero copies, same title and author: no review, `newBooks: 0`, one planned copy on it. Same with a retained `new_book` decision: still adopted, no second book. Copyless book with a different ISBN: adopted, ISBN unioned. A book whose copies were all deleted by hand: adopted, same path. Two such rows and two such books: one copy on each. Not adopted: a book that has a copy (retained `new_book` is honored and creates a book), a copyless book with a different author, a copyless book with only a `baseTitleKey` match (review `similar_title`).
  - *Retained pending decision:* second row retains `add_copy` to `{ kind: "pending", libibId: first }`, and the first row's book now exists copyless: the first adopts it, the second adds to that same book rather than falling back to a default.
  - *Empty keys:* a row titled `"!!!"` and a catalog book titled `"!!!"`, same author, with or without copies: new book, no review, no adoption. Non-Latin title with the same author: strong match, review `same_title`.
  - *No ISBN (catalog books here and in the next three items have at least one copy):* same title and author as a catalog book: review `same_title`, chosen add copy. `new_book` honored. Different author, same title: new book, no review. No authors versus a book with authors: new book, no review. No authors versus a book with no authors and the same title: review `same_title`.
  - *Differing ISBN:* row ISBN unmatched, strong title match: review `same_title`; add copy also unions the ISBN into the patch. *Edition qualifier:* `"The Glass Orchard (Deluxe Limited Edition)"` versus catalog `"The Glass Orchard"`, same author: strong, and the planned copy has `editionNote: "Deluxe Limited Edition"`.
  - *False-merge guard:* `"Ember Road: Book 2"` versus catalog `"Ember Road: Book 3"`, same author: review `similar_title`, chosen `new_book`, `newBooks: 1`.
  - *In-file no-ISBN pair:* two new rows, same title and author, no ISBN: first is a new book; second reviews with `{ kind: "pending", libibId: first }`, chosen add copy.
  - *Hand edits:* known row with catalog `pageCount: 300`, `userEditedFields: ["pageCount"]`, CSV 416: no patch. Catalog `pageCount: null`, edited: no patch. Catalog `publisher: null`, not edited: patch `{ publisher }` only, `filled: 1`, and `expectedUpdatedAt` is the book's. Hand-edited title: row still known by id, no new book, title not in patch. The plan type has no copy-update list, so a test asserts the owner and location of a known copy are absent from all outputs.
  - *Deletes:* ledger 1, no live copy (copy or whole book deleted), `copies: 1`: `removed: 1`, every write list empty. In `restore`: ISBN-matches a kept book or creates a new one; ledger stays valid. Ledger 2, live 1, `copies: 2`: `unchanged`, no resurrect. Ledger 1, no live copy, `copies: 2`: adds 1, creating the book if it's gone. Book deleted, row Y from the other collection never imported: new book.
  - *Missing rows:* catalog book with a libib id absent from the file, no related row: untouched.
  - *Mapping (**RF4**):* `"skip"`: row writes nothing, no ledger entry, `skippedCollection: 1`; rerun mapped to a member imports it. `"shared"` gives `ownerUserId: null`. Known row with mapping changed: no change to anything.
  - *Fill convergence:* two rows for one book with differing synopsis and an empty catalog field: first in file order wins, one patch. Stale decision (option no longer valid) falls back to default.
  - *`planState`:* all lists empty gives `nothing`. Only `ledger` non-empty gives `ledger_only`, also when `removed` is non-empty. Only `removed` non-empty gives `removed_only`. Any of the four other write lists gives `writes`. Ticking `restore` on a `removed_only` row gives `writes`.
- [ ] **Step 2: Run to verify failure.** `docker compose run --rm app npm test -- src/lib/libib/plan`. Expected: FAIL.
- [ ] **Step 3: Implement** per Algorithm.
- [ ] **Step 4: Verify.** Same command. Expected: PASS.
- [ ] **Step 5: Commit.** `feat: libib import planner`.

### Task 5: Repo writes, paged reads, ordered apply

**Files:**
- Create: `src/lib/libib/apply.ts`, `src/lib/libib/fake-store.ts` (test helper, not imported by app code)
- Modify: `src/lib/library-repo.ts` (paging, new functions)
- Test: `src/lib/libib/apply.test.ts`, `src/lib/library-repo.test.ts`

**Interfaces:**
- Consumes: `ImportPlan`, `BookRef`, `buildImportPlan` (Task 4); `fromBookPatch`, `toBook` (`types.ts`).
- Produces:

```ts
// library-repo.ts
listLibibLedger(householdId: string): Promise<Map<string, number>>   // paged
// listBooks keeps its signature, now paged (.range, page size 1000, order title then id; stops only on an empty page, so a lower Max Rows setting cannot truncate it)
libibStore: ImportStore

// apply.ts
interface ImportStore {
  insertBooks(rows: { id: string; householdId: string; input: BookInput }[]): Promise<void>;
  insertCopies(rows: { bookId: string; ownerUserId: string | null; editionNote: string | null; libibId: string }[]): Promise<void>; // origin 'libib'
  linkCopy(copyId: string, libibId: string): Promise<void>;       // updates libib_id only
  patchBook(bookId: string, expectedUpdatedAt: string, patch: Partial<BookInput>): Promise<boolean>; // false if row changed
  upsertLedger(householdId: string, rows: { libibId: string; copiesSeen: number }[]): Promise<void>;
}
type ImportStage = "books" | "links" | "copies" | "patches" | "ledger";
class ImportWriteError extends Error { stage: ImportStage; cause: unknown }
interface ApplyResult { patchesSkipped: string[] /* titles */ }
applyImportPlan(plan: ImportPlan, householdId: string, store: ImportStore, opts: {
  newId(): string; onProgress?(done: number, total: number): void;
}): Promise<ApplyResult>
```

Order: books, links, copies, patches, ledger. `CHUNK_SIZE = 200` for inserts and ledger upsert, except that a chunk boundary never splits one `libibId`'s copies, so a row's copies land in one request (a chunk may exceed 200 by up to one row's copies). Links and patches run sequentially. Pending `BookRef`s resolve through a map of `libibId` to generated id. `patchBook` is `.update(fromBookPatch(patch)).eq("id", id).eq("updated_at", expected).select("id")`; empty result returns `false`. It **never sends `user_edited_fields`**. `upsertLedger` uses `onConflict: "household_id,libib_id"`. `insertBooks` adds `id` and `household_id` around `fromBookPatch(input)`. Don't change the existing `addCopy`, which stays `origin: "manual"`.

- [ ] **Step 1: Write the failing tests.** `fake-store.ts` is an in-memory catalog and ledger implementing `ImportStore`, with `failAt(stage, callIndex)` to throw, `snapshot()` returning sorted books and copies with generated ids removed, `listBooks()`, `ledger()`, `deleteBook(id)` and `deleteCopy(id)` for rebuilding plans and for Task 6's tests, and an increasing `createdAt` on each inserted book.
  - *Order:* calls recorded are books before links before copies before patches before ledger; a 450-row plan produces 3 book chunks. `onProgress` reaches `total`. Pending refs resolve to the generated book id.
  - *Idempotent (the headline requirement):* import a mixed file, rebuild the plan from the store's state with the same file: every write list empty, `newBooks: 0, newCopies: 0, review: 0`, and `unchanged` equals the row count. A third run is identical. Covers ISBN, no-ISBN, multi-copy and two-collection rows.
  - *Convergence (**RF5**):* for each stage and call index in a mixed file (including a no-ISBN row and a no-author row), run with `failAt`, expect `ImportWriteError` with that stage, rebuild the plan and rerun, then assert `snapshot()` (sorted, so insert order is irrelevant) equals an uninterrupted run's with the same decisions. Run the whole loop twice: once with default decisions, and once **retaining non-default decisions** across the retry, as "Run it again" does: `new_book` on `same_title` rows (no-ISBN and differing-ISBN), `add_copy` on a `rescan` row, `link` on an `existing_copy` row, and `add_copy` to a pending book from an in-file pair. Then assert a further rebuild has `planState` `nothing`.
  - *Convergence, named shapes:* each runs through the same failure loop and must match the uninterrupted run. A `link` row with `copies: 2`. Same-title no-ISBN rows Y and X against a catalog book with a copy, where Y adds to that book and X retains `new_book`. The same with X on a differing ISBN. A fresh catalog where no-ISBN row A is a plain new book and ISBN row B retains `new_book`, under both orderings of generated ids. A `restore` row with ledger 2, no live copy and `copies: 2`, and a test that its two copies land in one `insertCopies` call even at a chunk boundary.
  - *Accepted gap (D10), pinned as such:* ledger 2, live 1, `copies: 3`, failing before the ledger: the retry ends with one extra copy, then `nothing`. The test names the gap so a future fix updates it.
  - *Ledger last:* failing at `copies` leaves no ledger entries.
  - *Delete then re-import:* import, delete a book and a copy in the store, rebuild: `removed: 2`, no writes.
  - *Patch race:* `patchBook` returning false adds the title to `patchesSkipped`, doesn't throw, and the import continues.
  - *Edits survive:* after import, set `pageCount` and add it to `userEditedFields` in the store, re-import with a different CSV value: value unchanged; `userEditedFields` unchanged.
  - `library-repo.test.ts`, mocking `@/lib/supabase` in the style of `household-repo.test.ts` (**RF1**): `listBooks` with first page of 1000 and second of 3 returns 1003 and requests `range(0, 999)` then `range(1000, 1999)`; a full last page then an empty page terminates; an error on page 2 **rejects** rather than returning a partial list. `insertCopies` sends `origin: "libib"` and `libib_id`. `patchBook` sends no `user_edited_fields`, and returns `false` on an empty result. `listLibibLedger` maps rows to a `Map`.
- [ ] **Step 2: Run to verify failure.** `docker compose run --rm app npm test -- src/lib/libib/apply src/lib/library-repo`. Expected: FAIL.
- [ ] **Step 3: Implement** per Interfaces; remove the `listBooks` "page this query" comment.
- [ ] **Step 4: Verify.** `docker compose run --rm app npm test`. Expected: all PASS, including existing suites.
- [ ] **Step 5: Commit.** `feat: ordered, re-runnable libib import writes`.

### Task 6: Import screen

**Files:**
- Create: `src/components/import/ImportPage.tsx`, `src/components/import/ImportPreview.tsx`, `src/components/import/ReviewList.tsx`
- Modify: `src/lib/router.ts` (`{ name: "import" }`, `#/import`), `src/lib/router.test.ts`, `src/App.tsx` (route; header link "Import"), `src/components/library/LibraryPage.tsx` (empty state: "Import from libib" link beside "Add a book")
- Test: `src/components/import/ImportPage.test.tsx`

**Interfaces:**
- Consumes: `readLibibFile`, `LibibFileError` (Task 2); `suggestOwners`, `loadSavedMapping`, `saveMapping` (Task 3); `buildImportPlan`, `sameSummary`, `planState` (Task 4); `applyImportPlan`, `libibStore`, `listBooks`, `listLibibLedger`, and `fake-store.ts` in tests (Task 5); `useHousehold`.
- Produces: `<ImportPage />`, a state machine: `pick`, `loading`, `preview`, `writing`, `done` or `failed`.

Flow: pick a file (`<input type="file" accept=".csv,text/csv">`; validate by content, because Android reports CSV under varying MIME types), then `readLibibFile`, then fetch `listBooks` and `listLibibLedger`, then the preview. **Nothing is written before Confirm.** Preview shows owner selects per collection (member names, Shared, Skip this collection) and the summary line, then lists: new books (title, author), review items (radios per option, default preselected), removed rows (unticked "Import again"), skipped rows (row number, title, reason) and warnings. Mapping, decisions and restore changes rebuild the plan live. On Confirm: `saveMapping`, re-fetch catalog and ledger, rebuild; if `!sameSummary`, return to preview with the notice; otherwise apply with `crypto.randomUUID`, showing progress, and disable the button while writing. On `done`: counts, any skipped patch titles, link back to the library. On `failed`: the message and "Run it again", which re-enters `loading` with the parsed file, mapping, review decisions and restore ticks still in memory.

Exact copy:
- Summary (singular where the count is 1): `{newBooks} new books, {newCopies} extra copies, {unchanged} unchanged, {review} to review`, followed when non-zero by `, {filled} with details to fill` and `, {removed} removed earlier`.
- `not_libib`: `This doesn't look like a libib export. Missing column: {first}.`
- `not_text`: `This isn't a CSV file. In libib, use Export, then upload the .csv it gives you.`
- `empty`: `This file has no books in it.`
- `malformed`: `This file looks damaged, so nothing was imported. Try exporting it from libib again.`
- `too_large`: `This file is too big to be a libib export (over 10 MB).` `too_many_rows`: `This file has more than 10,000 rows, which is too many to import at once.`
- Catalog or ledger load failure: `Couldn't read the library, so nothing was imported.`
- Spreadsheet: `Some ISBNs look damaged, which usually means the file was opened in Excel. Export it from libib again and upload that file directly.`
- Unmapped: Confirm disabled, with `Choose an owner for {collection}.` A blank collection shows as `(no collection)`.
- `planState` decides the preview's action:
  - `writes`: summary and `Import` button.
  - `ledger_only`: summary, `These books are all here, but an earlier import didn't finish recording them.` and a `Finish the earlier import` button, which runs the same Confirm flow. Without this the ledger would never be written, and a later delete would come back as new.
  - `removed_only`: summary and the removed list, no action button, and no "already in the library" text, because that would be false for these rows. Ticking a row makes the state `writes`, so `Import` appears.
  - `nothing`: `Everything in this file is already in the library.` and no button. If `summary.skippedCollection` or `file.skipped` is non-zero, that sentence would be false too, so show `Nothing to import from this file.` with the summary and skipped list instead.
- Changed: `The library changed while you were reviewing. Check the updated summary, then confirm again.`
- Failed: `The import stopped partway. Everything saved so far is kept, and running it again adds only what's missing.`

- [ ] **Step 1: Write the failing tests** (mock `library-repo`, with its reads and `libibStore` delegating to the Task 5 fake store so state persists across uploads; mock `useHousehold`; `new File([libibCsv(...)])`).
  - `router.test.ts`: `parseHash("#/import")` gives `{ name: "import" }`; `routeToHash` round-trips.
  - Upload of two new rows shows `2 new books, 0 extra copies, 0 unchanged, 0 to review`, and **no store write has been called**. Confirm calls `insertBooks`, `insertCopies` and `upsertLedger`, then shows the done state.
  - Each file error from the copy list renders its text and writes nothing.
  - **RF1:** `listBooks` rejecting shows `Couldn't read the library, so nothing was imported.` with no plan and no writes. The ledger rejecting (migration not applied yet) gives the same result.
  - **RF4:** collection `Partner Shelf` with no matching member: Confirm disabled with the prompt; choosing `Skip this collection` enables it, and those rows aren't written. `Tierra's Books` is preselected to member `Tierra`.
  - Review: a `same_title` row shows radios with the default checked; choosing `Separate book` changes the summary to one more new book; Confirm applies that choice.
  - Removed only: the row appears with an unticked box, the summary shows, `Everything in this file is already in the library.` is absent and there is no `Import` button. Ticking changes the summary and `Import` appears; untick and it goes again.
  - Re-upload where all rows are known and the ledger is complete: `Everything in this file is already in the library.`, no action button. All rows in a collection mapped to Skip: `Nothing to import from this file.`, not that sentence.
  - **RF5, lost ledger write:** the fake store has `failAt("ledger", 0)`. Confirm shows the failed text. `Run it again` shows `Finish the earlier import`, with `Everything in this file is already in the library.` absent. Clicking it writes the ledger and shows the done state. Then delete a book in the store and re-upload: the row is listed as removed, `newBooks` stays 0, and no book is inserted.
  - Confirm when the re-fetched catalog differs: the changed notice, and no writes.
  - **RF3:** a damaged ISBN shows the spreadsheet warning.
  - Failure: a store rejection shows the failed text; `Run it again` re-fetches and shows the refreshed preview. Double-clicking Confirm applies once.
- [ ] **Step 2: Run to verify failure.** `docker compose run --rm app npm test -- src/components/import src/lib/router`. Expected: FAIL.
- [ ] **Step 3: Implement.** Phone-first, matching existing Tailwind and form styling. Long lists scroll within the page; no virtualisation.
- [ ] **Step 4: Verify.** Same command, then `docker compose run --rm app npm test`. Expected: PASS.
- [ ] **Step 5: Commit.** `feat: libib import screen with preview`.

### Task 7: Fill missing covers from OpenLibrary

Nothing else depends on this task (D12). Task 6's tests must keep passing with `fetch` stubbed in their setup, since the done screen now starts a lookup.

**Files:**
- Create: `src/lib/libib/enrich.ts`
- Modify: `src/components/import/ImportPage.tsx` (auto-start on `done`, pick-screen button)
- Test: `src/lib/libib/enrich.test.ts`, `src/components/import/ImportPage.test.tsx`

**Interfaces:**
- Consumes: `fillPatch` (Task 3), `ImportStore.patchBook` (Task 5), `canonicalIsbns` (Task 2).
- Produces: `enrichMissing(books: BookWithCopies[], store: Pick<ImportStore, "patchBook">, opts: { fetchImpl: typeof fetch; onProgress?(done: number, total: number): void }): Promise<{ looked: number; filled: number; failed: boolean }>`

Candidates: books with a canonical ISBN and null `coverUrl` or null `synopsis`, where the empty field isn't in `userEditedFields`. Request, sequentially, `https://openlibrary.org/api/books?bibkeys=ISBN:<a>,ISBN:<b>&format=json&jscmd=details`, at most 40 ISBNs per request. Cover URL: first positive id in `details.covers`, as `https://covers.openlibrary.org/b/id/<id>-L.jpg`. ID URLs avoid the per-IP limit OpenLibrary documents for ISBN-keyed cover URLs (from memory; confirm in their docs while implementing). Synopsis: `details.description`, which is a string or `{ value }`. Build each patch with `fillPatch`. Network failure stops the run with `failed: true`; it is never an import failure.

UI behavior (D12):
- On entering `done` after an applied plan (`writes` or `ledger_only`), once per apply: re-read `listBooks`, then run `enrichMissing` over every candidate in the household. The import result stays on screen throughout. `failed`, `pick` and `preview` never start it, and neither does the `nothing` or `removed_only` preview, which never reaches apply. A failed `listBooks` here counts as a lookup failure, not an import failure.
- `pick` keeps a `Find missing covers` button with a line explaining that it looks up ISBNs on OpenLibrary. It uses the same run and the same status lines below.

Exact copy:
- While running, under the Task 6 done state: `Looking up covers on OpenLibrary. {done} of {total} books.`
- Finished: `Found details for {filled} of {looked} books.`
- Nothing to look up: no line.
- Failure, non-fatal: `Your import is complete, but the OpenLibrary lookup didn't finish.` and a `Try again` button that re-reads the books and looks up only what is still missing. On `pick` the first half reads `The OpenLibrary lookup didn't finish.`

- [ ] **Step 1: Write the failing tests** (stub `fetchImpl`; use synthetic ISBNs).
  - `covers: [-1, 123]` gives `https://covers.openlibrary.org/b/id/123-L.jpg`; only `-1` gives no patch.
  - `description` as string and as `{ value }` both fill; absent leaves synopsis alone.
  - `userEditedFields: ["coverUrl"]` with a null cover: never patched. An existing cover: never replaced. No ISBN: not requested.
  - 90 candidates produce 3 requests.
  - A rejected fetch on request 2 returns `failed: true` and keeps patches from request 1. A `patchBook` returning false isn't counted as filled.
  - An ISBN missing from the response is skipped.
  - `ImportPage.test.tsx` (stub global `fetch`):
    - *Auto-start after writes:* no `fetch` during upload or preview. Confirm, and `fetch` is called once per chunk with the import's ISBNs, the done state shows the progress line while the stubbed fetch is pending, then `Found details for {filled} of {looked} books.` A `ledger_only` finish starts it too.
    - *No start when nothing was written:* a re-upload reaching the `nothing` state, and a `removed_only` preview: `fetch` never called. A failed apply: the failed text shows and `fetch` is not called; `Run it again` to done then starts it.
    - *Failure is non-fatal:* a rejected `fetch` keeps the done state and its counts, shows `Your import is complete, but the OpenLibrary lookup didn't finish.`, never shows the Task 6 failed text, and `Try again` succeeds and fills the book. `listBooks` rejecting on the refresh gives the same result.
    - *Pick screen:* `Find missing covers` runs a lookup with no file chosen.
- [ ] **Step 2: Run to verify failure.** `docker compose run --rm app npm test -- src/lib/libib/enrich src/components/import`. Expected: FAIL.
- [ ] **Step 3: Implement** per Interfaces and UI behavior.
- [ ] **Step 4: Verify.** Same command. Expected: PASS.
- [ ] **Step 5: Commit.** `feat: fill missing covers from OpenLibrary`.

### Task 8: Local end-to-end check, docs, branch wrap-up

**Files:**
- Modify: `README.md` (Import section: export from libib, upload, what re-upload does, deletes stay deleted)

- [ ] **Step 1: Prepare the local stack.** On the host, with the Task 1 worktree: `npx supabase@2.122.1 start --workdir C:/Users/tierr/Github/tome-of-secrets-libib-ledger`, then `db reset`. Point `.env` at local values from `status`; `docker compose up app`. Generate a synthetic CSV with `libibCsv`, or by hand, in a scratch location outside the repo. Include two collections, a same-ISBN pair across them, `copies=2`, a no-ISBN row and an edition-qualified title.
- [ ] **Step 2: Walk the flow against local Supabase** and record each observed result:
  1. Upload: preview counts match; check the database is unchanged in Studio. Confirm: wall and copies are correct, `origin` shows libib.
  2. Re-upload the same file: `Everything in this file is already in the library.`; row counts in `books`, `copies` and `libib_import_rows` unchanged.
  3. Edit a page count, change a copy's owner, delete one copy and one whole book, re-upload: edits intact, deletions listed as removed and not restored; `user_edited_fields` holds `pageCount`.
  4. Edit the file to `copies=2` on a known row and add a new row: exactly one extra copy and one new book.
  5. Throttle or go offline in DevTools during Confirm: the failed message appears; back online, `Run it again` finishes with no duplicates. This also exercises the `updated_at` filter on real PostgREST timestamps; if the filter never matches, fix it here (all patches would report as skipped).
  6. On a 390 px viewport, the preview, review radios and owner selects are usable.
- [ ] **Step 2b: Real files, local stack only.** Confirm `.env` points at `127.0.0.1` first. Read the user's real exports from `C:/Users/tierr/Downloads` without copying them anywhere in the repo. Upload the Nov 3 file, then the Nov 6 re-export, then the partner's file. Expected: 127 new books; then 4 new with 127 unchanged; then the partner's file, whose collection needs an owner choice unless a member name matches. Re-upload each: nothing to do. Record counts only, including review items and how many covers OpenLibrary found of how many books; sending these ISBNs to OpenLibrary is user-approved for this check. Then `db reset` so no real rows linger.
- [ ] **Step 3: Full gates.** `docker compose run --rm app npm test`, `npm run lint` and `npm run build`. Expected: all green.
- [ ] **Step 4: Privacy check.** `git diff --name-only origin/main...HEAD` lists no `.csv`, and fixtures contain only invented titles.
- [ ] **Step 5: README, review, commit, PR.** Write the README section. Whole-branch subagent review against the spec and this plan. Commit `docs: libib import usage`. Push the branch and open a PR to `main`, leaving it unmerged. The PR body says **the ToS `libib-import-ledger` PR and the user-approved step must land first**; without the table, the Import screen shows `Couldn't read the library, so nothing was imported.` and writes nothing.

---

## USER-APPROVED STEP: production rollout

**Agents don't run this without the user's explicit go-ahead in that moment.** Approval of this plan isn't approval of this step. The user runs it or explicitly tells an agent to, in this order:

1. Merge the ToS `libib-import-ledger` PR.
2. Push from the Supabase-linked worktree, `C:/Users/tierr/Github/tome-of-secrets-library-schema`. The Task 1 worktree isn't linked, and the main checkout is on an unrelated branch. The linked worktree sits on a detached HEAD, so update it first: `git -C C:/Users/tierr/Github/tome-of-secrets-library-schema fetch origin`, then `git -C C:/Users/tierr/Github/tome-of-secrets-library-schema checkout --detach origin/main`. Run `npx supabase@2.122.1 db push --dry-run --workdir C:/Users/tierr/Github/tome-of-secrets-library-schema` and confirm the only pending migration is `20261106000000_library-libib-import-rows`. Then run the same command without `--dry-run`.
3. Merge the library PR; the Pages deploy runs.
4. Upload the real export. The preview writes nothing, so read it first. Expected: about one new book per row (hand-added books appear in review instead), and owner preselected for `Tierra's Books`.
5. **Re-upload the same file without confirming.** Expected: `Everything in this file is already in the library.` Ids held across exports 3 days apart (D1). If a later export ever shows `rescan` rows, don't confirm those defaults blindly, and report it.
6. Upload the partner's collection file once they've joined the household. Until then, choose Skip for it. Same-book rows then become second copies.

## Open questions

None block execution. For the user to weigh in review:

1. **libib behaviors never observed:** `copies > 1` and no-ISBN rows, in any of the three real files. Both are handled and pinned by synthetic tests. Id stability is observed over only 3 days (D1).
