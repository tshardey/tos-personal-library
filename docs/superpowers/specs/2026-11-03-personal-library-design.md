# tos-personal-library — Design

**Date:** 2026-11-03
**Status:** Draft for review
**Related repos:** `tome-of-secrets` (consumer, owns the Supabase project and its migrations), `kinetic-campaigns` (reference for app structure)

## 1. Intent

A household catalog of the **physical books** Tierra and their partner own. It answers one question: *what physical books do we have?*

It exists because:

- **Picking the next read means walking the house.** There's no central bookshelf; books are spread across rooms. Tierra wants to browse what they own from their phone instead.
- **Getting books in is painful for anything without a barcode.** libib handles barcode scanning well, but book-box editions (e.g. Fae Crate), older books, and the partner's thrifted/older editions have no scannable ISBN.
- **They accidentally buy duplicates.** Both partners have bought books the household already owned. A fast "do we own this?" lookup fixes that.
- **Tome of Secrets (ToS) should source books from it.** Today ToS book selection searches OpenLibrary/Google Books, which is incomplete and requires retyping. Picking from the household library should fill in a quest/TBR book directly.

Success looks like: Tierra and their partner both browse and search one shared catalog on their Android phones; new barcode hauls arrive via a libib re-export; barcode-less books arrive via photos; ToS's book picker offers library books first.

## 2. Goals

1. **Shared household catalog.** One catalog for both partners, both signed in with their existing ToS accounts. Both can read, search, add and edit.
2. **Book vs. copy model.** One entry per book (work), with any number of physical copies. Example: *Poet Empress* — one Fae Crate copy and one bookstore copy.
3. **Copy owner tag.** Each copy is tagged as *Tierra's*, *partner's*, or *shared*. This replaces libib's two-collection approach.
4. **Browse view.** Cover wall showing cover, title, author; detail view adds synopsis and the list of copies. The displayed cover may be a stock cover — it does not need to match the owned edition.
5. **Quick "do we own this?" search** usable while standing in a bookstore.
6. **Repeatable libib CSV import.** libib stays the barcode scanner. Tierra exports the CSV and re-uploads it as often as they like; the import dedups and adds only what's new (new books and new copies).
7. **Photo intake pipeline.** Photograph a cover (optionally the title page), single or in batches. The pipeline identifies title/author, fetches metadata online, checks the catalog, and proposes either *add a copy to an existing book* or *create a new book*.
8. **ToS integration.** ToS's book search checks the household library first, then falls back to its existing OpenLibrary/Google Books search.

**Stretch goal:** where each copy is located in the home (room / shelf).

## 3. Non-goals

- **Reading status** (read, want-to-read, currently reading). ToS remains the place for reading history and gamification. The library does not track it, for anyone.
- **Ebooks and audiobooks.** Not "owned" for this purpose. ToS continues to handle them via its existing external search.
- **Replacing libib's barcode scanning.** libib remains the fast path for ISBN books.
- **A native Android app.** An installable web app (PWA) is the mobile experience.
- **Offline use.** Online-only for now, including the bookstore "do we own this?" check. No service worker catalog cache required.
- **Multi-household / public use.** It's for one household.

## 4. Anti-goals (would make this a failure even if it works)

- **A second paid Supabase project.** Costs money per project; must reuse ToS's project.
- **Duplicated "truth" about reading** between ToS and the library.
- **Duplicated "truth" about ownership.** ToS's existing "Physical TBR" shelf is replaced by the library (see §6.5), not kept alongside it.
- **Re-imports that clobber edits.** If a user fixes an owner tag, location, title, or cover in the library, a later libib re-import must not undo it.
- **Silent wrong matches.** The photo pipeline merging a book into the wrong existing entry (or creating a duplicate entry for a book already owned) without anyone noticing.
- **Repeating ToS's development path.** ToS grew from Markdown files into a clunky static site. This repo should start with a real app structure (see §6).

## 5. Constraints and known facts

### libib CSV (from `library_20261103_234851.csv`)

Header:

```
id,item_type,title,creators,first_name,last_name,collection,ean_isbn13,upc_isbn10,description,publisher,publish_date,group,tags,notes,price,length,number_of_discs,number_of_players,age_group,ensemble,aspect_ratio,esrb,rating,review,review_date,status,began,completed,added,copies
```

Profile of the current export:

- 127 rows, all `item_type=book`, all `collection="Tierra's Books"`. **The partner's books are a second collection in the same libib account** (~80 books), exported separately or together and distinguished by `collection`. Same account, so libib `id`s are unique across both collections.
- **The partner's libib data is only ~20% of their books** (so roughly 400 total), and about 10% of what was scanned wasn't found. They won't scan the rest. **The photo pipeline is the main intake path for the partner — expect batches of tens to hundreds of photos**, not one-offs.
- `id` is a short libib-generated id (e.g. `oph5gd0an7`), unique per row — a stable key for re-imports.
- Every row has `ean_isbn13`; 17 rows have an empty `description`.
- `copies` is present (all `1` currently). A second copy scanned in libib may show up as `copies=2` on the same row rather than as a new row.
- `length` is page count. `added` is a date. `tags`, `notes`, `status`, `group` are empty today.
- Descriptions contain embedded quotes and commas; parse with a real CSV parser.

### Tome of Secrets (consumer)

- Supabase project is shared. ToS tables live in `public` with a `tos_` prefix (`tos_sync_events`, `tos_save_summary`, `tos_inventory`, `tos_quests`).
- ToS uses the Supabase CLI migration flow (`supabase/migrations/`, `supabase db push`); legacy `sql/` scripts predate it. **ToS owns all migrations for the shared project, including the `library` schema** (decided). The library repo contains no `supabase/migrations/`.
- ToS auth is Supabase Auth (email sign-in via `assets/js/auth/cloudAuth.js`). Both partners already have accounts.
- ToS book search is centralized in `assets/js/services/BookMetadataService.js` → `searchBooks(query, author, signal)`, returning a common `BookSearchResult` shape (title, authors[], coverUrl, pageCount, …) from OpenLibrary first, then Google Books. ToS is plain ES modules + Jest, no bundler.
- Both apps would be served from the same GitHub Pages origin (`<user>.github.io/tome-of-secrets` and `<user>.github.io/tos-personal-library`), so they share `localStorage` and therefore the Supabase session. Desirable (sign in once) but keys must not collide.

## 6. Decided approach

### 6.1 App (this repo)

- **Stack mirrors `kinetic-campaigns`:** Vite, React 19, TypeScript, Tailwind 4, Vitest + Testing Library, ESLint, `@supabase/supabase-js`, `lucide-react`. Config via `VITE_SUPABASE_URL` / `VITE_SUPABASE_PUBLISHABLE_KEY` in root `.env` (with `.env.example`).
- **Development environment:** runs in Docker via **docker-compose**, not a VS Code devcontainer (Tierra works in Orca now, not VS Code). `docker compose` brings up the Node toolchain for `npm run dev` / `npm test` / lint, with the Vite dev server reachable from the host and the Supabase CLI available. The local Supabase stack (`supabase start`) itself runs on Docker, so the compose setup needs access to the host Docker daemon (socket mount) or runs the Supabase services as compose services. Builder's choice which. Running the Supabase CLI on the host (Tierra has it installed in PowerShell) is an acceptable fallback if in-container is impractical.
- **Hosting:** GitHub Pages via an Actions workflow equivalent to `kinetic-campaigns/.github/workflows/deploy.yml`.
- **Installable PWA** for Android: manifest + icons so it can be added to the home screen. Camera capture via `<input type="file" accept="image/*" capture>` (plus multi-select from gallery for batches).
- **Screens:**
  - **Library** — cover wall, search box (title/author), owner filter (mine / his / shared / all).
  - **Book detail** — cover, title, authors, synopsis, copies list (owner, edition/source, location, how it arrived); edit book and copies; add/remove copy.
  - **Import** — upload libib CSV → preview diff → confirm.
  - **Photo inbox** — upload photos; see pending/processing/ready items; confirm or correct each proposal.
- **Auth:** Supabase Auth with the same accounts as ToS. Only household members see anything.

### 6.2 Data — `library` schema in the ToS Supabase project

Conceptual model (exact columns left to the builder, but these concepts must exist):

- **household** — one row for this household. **household_member** links `auth.users` to a household with a display name used for owner tags.
- **book** (the work): household_id, title, authors, synopsis, cover_url, ISBNs (13/10, possibly several), external ids (OpenLibrary/Google), page count, publisher, publish date.
- **copy** (physical item): book_id, owner (a household member, or *shared*), edition/source note (e.g. "Fae Crate", "thrifted", "bookstore"), location (stretch; free text is fine to start), origin (`libib` / `photo` / `manual`), libib_id (nullable), photo reference (nullable), timestamps.
- **intake item** (photo pipeline queue): household_id, uploader, storage paths of photos, status (`pending` / `processing` / `ready` / `failed` / `confirmed` / `discarded`), extracted fields, proposed match, error.
- **Edited-field tracking** sufficient to honor "re-imports never clobber edits" (e.g. a per-row `user_edited` set of field names, or separate import-sourced vs. user-overridden values — builder's choice).
- **RLS on every table:** a user can read/write rows only for households they belong to.
- **Storage:** a private bucket for intake photos, scoped by household.
- **Exposure:** the `library` schema must be exposed to the Data API (PostgREST) so both apps can query it, *or* ToS reads through a view/RPC in `public` — builder's choice; ToS integration must work with the publishable key + user session.

### 6.3 libib import

- Runs in the browser: parse CSV, compute a diff against the catalog, **show a preview** ("N new books, M new copies, K unchanged, J possible matches to review"), then write on confirm.
- **Matching order:** libib `id` already imported → known copy (skip, or update non-edited fields). Otherwise ISBN-13 matches an existing book (e.g. one that came in via photo) → add a copy to that book. Otherwise → new book + copy.
- **Copies:** if a known libib row's `copies` count is higher than the number of copies linked to that libib id, add the difference as new copies.
- **Owner:** derived from the libib `collection` (e.g. "Tierra's Books" → Tierra), with a mapping chosen at import time.
- **Never overwrite user-edited fields.** Missing descriptions/covers may be backfilled from OpenLibrary/Google.
- Removal of a row from libib does **not** delete anything in the library (libib is an intake source, not the source of truth).

### 6.4 Photo pipeline

- Client uploads 1–2 photos per book (cover required, title page optional) to the private bucket and creates an intake item. Batch upload creates many items.
- A **Supabase Edge Function** processes intake items:
  1. Send image(s) to **Claude Haiku (`claude-haiku-5-5`)** with vision, asking for structured output: title, authors, edition/publisher clues (e.g. "Fae Crate exclusive", sprayed edges), confidence.
  2. Look up metadata by title + author on OpenLibrary, then Google Books (same priority as ToS) for synopsis, ISBNs, stock cover, page count.
  3. Match against the household catalog (ISBN, then normalized title + author with fuzzy matching) and record a proposal: *new copy of book X* or *new book*.
- **The user confirms each proposal in the inbox** with one tap, or corrects it (pick a different existing book, edit fields, set owner/edition/location). *(Builder/Claude's call, not stated by Tierra: chosen because a silent wrong match is an anti-goal; Tierra's ask was that the pipeline checks for an existing entry and adds a copy rather than a new book, which the proposal does.)*
- Anthropic API key stored as an Edge Function secret, never in the client.
- Expected cost: well under a cent per book with Haiku.

### 6.5 Tome of Secrets integration (changes in the ToS repo)

- Add a library search source (e.g. `searchLibrary`) that queries the signed-in user's household books and returns `BookSearchResult`-shaped results, carrying the library book id.
- **Library results are always shown first, and external results still appear below them** (not "external only when the library is empty"), so a user reading the ebook/audiobook of a book owned in print can still pick external metadata. Library results are visually marked "in our library." *(Claude's call.)*
- **The library replaces ToS's "Physical TBR" shelf** (decided by Tierra). Today a ToS book has `shelfCategory: 'general' | 'physical-tbr'` (validated in `dataValidator.js`, migrated in `dataMigrator.js`, set in `stateAdapter.js`, edited in `LibraryController.js`, and set to `physical-tbr` by `shoppingRenderer.js` when a purchase is linked). It is not referenced by any game rules in `assets/data/` or the rules Markdown. Replacement:
  - ToS books gain an optional link to a library book id (set when picked from library results). The "Physical TBR" badge becomes an "in our library" badge derived from that link; the shelf radio/select in the add/edit book forms is removed.
  - `shelfCategory` is retired through ToS's normal save schema versioning (new version + migration). Existing `physical-tbr` books are kept as books; after migration ToS offers a one-time list of them to match to library books (or leave unlinked). Nothing is auto-created in the library from ToS. *(Claude's call on the mechanics.)*
  - The shopping screen (`shoppingRenderer.js`, which also calls `searchBooks`) shows library results first too, so "already owned" is visible before logging a purchase. A purchased book that isn't in the library is just a normal ToS book; it enters the library through libib or photo intake, not from ToS. *(Claude's call.)*
- Signed-out or no-household users see today's behavior unchanged.
- ToS migrations add the `library` schema, tables, RLS, bucket, and grants (§6.2). ToS follows its own AGENTS.md process (Beads, tests, subagent review) for these changes.
- **How schema changes reach production** *(Claude's call)*: library migrations are written in a ToS feature branch and developed/tested against a **local Supabase** (`supabase start` in the dev container, Docker), including RLS tests. They reach the live project only after the maintainer merges and runs `supabase db push`. The library app points at the local stack until then. Plan phases so each schema step lands as its own small ToS PR.

## 7. Left to the builder

- Exact table/column names, types, indexes, and how ISBN arrays and edited-field tracking are represented.
- Fuzzy-matching approach (e.g. `pg_trgm` vs. client-side) and thresholds.
- How the Edge Function is triggered (client invokes after upload vs. DB webhook / queue) and retry behavior.
- Whether the Edge Function source lives in this repo or ToS (deploying functions doesn't touch migration history, so either works).
- Visual design. No existing look is required; it should feel good on a phone first. A bookish feel that nods to ToS's dark-academia theme is welcome but not required.
- How the household and its two members are first created (a seed migration in ToS is fine for a two-person household).
- Prefixing any `localStorage` keys the app writes so they don't collide with ToS on the shared origin.
- The library app's URL must be added to Supabase Auth's allowed redirect URLs (ToS signs in with an emailed link, `signInWithOtp` + `emailRedirectTo`). Both apps use supabase-js's default session key on the same origin, so the session is shared.
- Batch-friendly photo intake UX (multi-select, progress, confirming many proposals quickly) — needed for the partner's ~300 unscanned books.
- **Future idea, not in scope:** identifying several books from one photo of a shelf of spines, which would suit the partner's backlog even better.
- Phasing. Suggested order: schema + auth + browse → libib import → photo pipeline → ToS integration → location (stretch).
- **Phasing update (2026-11-10):** after the photo pipeline came barcode scanning and an edition picker (`2026-11-10-barcode-scanner-and-editions-design.md`), then ToS integration (Plan 4) and an agent cover finder (Plan 5, see that document §8).
