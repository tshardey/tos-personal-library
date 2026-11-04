# Personal Library — Plan 1: Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A signed-in household member can browse, search, and hand-edit the shared catalog of physical books on their phone, backed by a `library` schema in the Tome of Secrets Supabase project.

**Architecture:** The `library` schema (tables, RLS, household RPCs, pgTAP tests) is written as migrations in the **tome-of-secrets** repo, which owns all migrations for the shared project. The **tos-personal-library** repo is a Vite + React + TypeScript SPA that loads the household's whole catalog (hundreds of rows) and filters it client-side. Development runs in docker-compose; the local Supabase stack is started from the ToS checkout.

**Tech Stack:** Vite 6, React 19, TypeScript ~5.6, Tailwind 4, Vitest 4 + Testing Library + jsdom, ESLint 9, `@supabase/supabase-js` 2, `lucide-react`, Supabase CLI (npm devDependency), pgTAP via `supabase test db`, Docker Compose, GitHub Pages.

**Spec:** `docs/superpowers/specs/2026-11-03-personal-library-design.md`

**Plan series:** This is plan 1 of 4. Plan 2: libib CSV import. Plan 3: photo intake pipeline. Plan 4: ToS integration (library-first search, Physical TBR retirement). Location (stretch) folds into whichever plan is active when it's wanted. Plans 2–4 are written after this one lands.

## Global Constraints

- Reuse the ToS Supabase project; no new project. All library tables live in schema `library`.
- **ToS owns all migrations.** tos-personal-library contains no `supabase/migrations/`. ToS changes follow ToS `AGENTS.md`: Beads issue before work, feature branch only (never `main`), Jest/pgTAP green, subagent review, `bd export --no-memories -o .beads/issues.jsonl` staged with the work.
- Do ToS work in a **new worktree off `main`** (`git worktree add ../tome-of-secrets-library-schema -b library-schema main`); the main ToS checkout is on an unrelated branch with uncommitted files.
- Migrations reach production only when the maintainer merges and runs `supabase db push`. Agents never push to the remote database.
- Stack mirrors `C:\Users\tierr\Github\kinetic-campaigns` (copy its `eslint.config.js`, `tsconfig*.json`, `src/lib/supabase-config.ts` pattern, `.github/workflows/deploy.yml`).
- Vite `base: "/tos-personal-library/"`. Env vars `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY` in root `.env`; `.env.example` committed.
- App dev commands (dev server, test, lint, build) run through `docker compose`. No `.devcontainer/`. Supabase CLI commands may run on the host (CLI installed in PowerShell) if in-container proves impractical.
- Physical books only; no reading status fields anywhere.
- Online-only: no service worker.
- Any `localStorage` key the app writes is prefixed `tpl_` (shared origin with ToS). Supabase's default session key is left as-is so the session is shared with ToS.
- Every library table has RLS enabled; only household members can read or write their household's rows. Any ToS player can sign in, so "signed in" is never sufficient.

## Review Focus

1. **A ToS player who isn't in the household signs in** → sees the household setup screen, can read/write nothing of the household. *(pgTAP in Task 2; UI in Task 5.)*
2. **Signed in, no household yet** → setup screen (create or join), never a blank wall or a raw error. *(Task 5 component test.)*
3. **Wrong or stale invite code** → "That invite code didn't match a household." and the user stays on setup. *(pgTAP + component test.)*
4. **Book with no cover** → placeholder tile showing title and first author, same size as covers. *(Task 6 component test.)*
5. **Removing the last copy of a book** → asks "Remove this book from the library too?"; yes deletes the book, no keeps the book with zero copies. *(Task 7 component test.)*

---

### Task 1: ToS — baseline migration so the local stack boots

`supabase start` replays `supabase/migrations/` on an empty database. The first migration (`20260408015258_projections-foundation.sql`) `ALTER`s `public.tos_saves`, which was created by hand before the CLI was adopted and has no migration — so a fresh local stack fails.

**Files (tome-of-secrets worktree):**
- Create: `supabase/migrations/20260407000000_baseline-tos-saves.sql`
- Modify: `project-docs/SUPABASE-CLOUD-SAVE.md` (one paragraph: the baseline exists; remote must be marked applied)

**Interfaces:**
- Produces: a local stack that boots with all existing migrations applied.

- [ ] **Step 1: Bead.** `bd list` (health check), then `bd create "Baseline tos_saves migration for local Supabase" -p 2`, `bd update <id> --status in_progress`.
- [ ] **Step 2: Reproduce the failure.** From the library repo's compose container (Task 3) or any env with the Supabase CLI and Docker: `npx supabase start --workdir <tos-worktree>`. Expected: fails applying `20260408015258` with `relation "public.tos_saves" does not exist`. (If Task 3 isn't done yet, do Task 3 first.)
- [ ] **Step 3: Write the baseline.** Copy the full idempotent `tos_saves` block from `project-docs/SUPABASE-CLOUD-SAVE.md` (table, `tos_set_updated_at`, trigger, RLS, all policies) verbatim into the new migration. Header comment: "Baseline for table created before CLI adoption. Remote already has it: run `supabase migration repair --status applied 20260407000000` before the next `db push`."
- [ ] **Step 4: Verify.** `npx supabase stop --no-backup --workdir <tos-worktree> && npx supabase start --workdir <tos-worktree>`. Expected: all migrations apply; `npx supabase migration list --local --workdir <tos-worktree>` shows four.
- [ ] **Step 5: Doc + commit.** Add the repair note to `SUPABASE-CLOUD-SAVE.md`. Commit `chore(<bead>): baseline tos_saves migration for local stack`. Leave the bead open until Task 2's review passes (they ship as one PR).

### Task 2: ToS — `library` schema, RLS, household RPCs, pgTAP tests

**Files (tome-of-secrets worktree):**
- Create: `supabase/migrations/20261103000000_library-schema.sql`
- Create: `supabase/tests/database/library_rls.test.sql`
- Modify: `supabase/config.toml` — `[api] schemas = ["public", "graphql_public", "library"]`; add `"http://127.0.0.1:5173/tos-personal-library/"` to `additional_redirect_urls`
- Modify: `project-docs/SUPABASE-CLOUD-SAVE.md` — "Library schema" section listing the two manual remote steps: add `library` to Dashboard → API → Exposed schemas; add the Pages URL `https://<user>.github.io/tos-personal-library/` to Auth → Redirect URLs.

**Interfaces — Produces (schema contract used by Tasks 4–7 and plans 2–4):**

```sql
library.households(id uuid pk default gen_random_uuid(), name text not null,
  invite_code text not null unique default encode(extensions.gen_random_bytes(6),'hex'),
  created_at timestamptz not null default now())
library.household_members(household_id uuid fk → households on delete cascade,
  user_id uuid fk → auth.users on delete cascade, display_name text not null,
  created_at timestamptz not null default now(), primary key (household_id, user_id))
library.books(id uuid pk default gen_random_uuid(), household_id uuid not null fk → households on delete cascade,
  title text not null, authors text[] not null default '{}', synopsis text, cover_url text,
  isbn13 text[] not null default '{}', isbn10 text[] not null default '{}',
  openlibrary_id text, google_books_id text, page_count int, publisher text, publish_date text,
  user_edited_fields text[] not null default '{}', created_at, updated_at)
library.copies(id uuid pk default gen_random_uuid(), book_id uuid not null fk → books on delete cascade,
  owner_user_id uuid null fk → auth.users on delete set null,   -- null = shared
  edition_note text, location text,
  origin text not null check (origin in ('libib','photo','manual')),
  libib_id text, photo_path text,
  user_edited_fields text[] not null default '{}', created_at, updated_at)
-- indexes: books(household_id); copies(book_id); copies(libib_id) where libib_id is not null
library.is_member(p_household uuid) returns boolean   -- security definer, stable, search_path=''
library.create_household(p_name text, p_display_name text) returns uuid   -- caller becomes member
library.join_household(p_invite_code text, p_display_name text) returns uuid
  -- raises exception with message 'invalid_invite_code' when no match; idempotent if already a member
```

`updated_at` maintained by a `library.set_updated_at()` trigger on books and copies. RLS: households/household_members `select` where `is_member(...)`; no direct insert/update/delete (RPCs only, `security definer`). books: select/insert/update/delete where `is_member(household_id)`. copies: same, via `exists (select 1 from library.books b where b.id = book_id and library.is_member(b.household_id))`. Grants: `usage` on schema and DML on books/copies, `select` on households/household_members, `execute` on the three functions — to `authenticated` only; revoke from `anon`/`public`.

- [ ] **Step 1: Bead.** `bd create "library schema, RLS, household RPCs" -p 1`; `bd dep add <this> <task1-bead>`; set in_progress.
- [ ] **Step 2: Write the failing pgTAP test** `library_rls.test.sql`. Create two auth users (A, B) by inserting into `auth.users`; impersonate with `set local role authenticated; set local request.jwt.claims = '{"sub":"<uuid>"}';`. Assertions (one pgTAP assertion per bullet clause; set `plan(n)` to match):
  - A `create_household('Home','Tierra')` returns a uuid; A appears in `household_members`.
  - A inserts a book and a copy (`origin='manual'`) → succeed.
  - B selects from `library.books` → 0 rows (`is_empty`).
  - B inserts a book with A's `household_id` → `throws_ok` (RLS violation, SQLSTATE `42501`).
  - B updates A's book → 0 rows affected.
  - B `join_household('nope','B')` → `throws_ok(..., 'invalid_invite_code')`.
  - B `join_household(<A's invite_code>,'Partner')` → succeeds; B now selects 1 book and 1 copy.
  - B calling `join_household` again with the same code → no error, still one membership row.
  - `anon` role selecting `library.books` → `throws_ok` (permission denied).
- [ ] **Step 3: Run it to verify it fails.** `npx supabase test db --workdir <tos-worktree>`. Expected: FAIL — schema `library` does not exist.
- [ ] **Step 4: Write the migration** per the contract above. Idempotent (`create ... if not exists`, `create or replace`, `drop policy if exists`). Functions `security definer set search_path = ''` with fully-qualified names.
- [ ] **Step 5: Verify.** `npx supabase db reset --workdir <tos-worktree> && npx supabase test db --workdir <tos-worktree>`. Expected: `library_rls.test.sql .. ok`, all assertions passing.
- [ ] **Step 6: ToS gates.** `cd tests && npm test` (Jest) green. Subagent pre-commit review of the diff (correctness, RLS holes, idempotency). Fix findings.
- [ ] **Step 7: Commit, close, PR.** Commit `feat(<bead>): library schema with RLS and household RPCs`; close both beads with reasons; `bd export --no-memories -o .beads/issues.jsonl`, stage it; push `library-schema`; open PR against `main` describing the two manual dashboard steps and the `migration repair` command. Leave unmerged.

### Task 3: Library repo scaffold, docker-compose, CI deploy

**Files (tos-personal-library):**
- Create: `package.json` (scripts: `dev` = `vite --host 0.0.0.0`, `build`, `lint`, `test` = `vitest run`, `db:start` = `supabase start --workdir $TOS_REPO_DIR`, `db:stop`, `db:reset`, `db:test`), `vite.config.ts` (base, `@` alias, vitest `environment: "jsdom"`, `setupFiles: ["src/test/setup.ts"]`), `tsconfig*.json`, `eslint.config.js`, `index.html`, `src/main.tsx`, `src/App.tsx`, `src/index.css` (Tailwind import), `src/test/setup.ts` (jest-dom), `src/App.test.tsx`
- Create: `Dockerfile` (node:20-bookworm + Docker CLI), `docker-compose.yml`, `.env.example`, `.gitignore` (node_modules, dist, .env), `.github/workflows/deploy.yml`, `README.md`
- `git init` on branch `main` with the existing `docs/` as the first commit, then work on branch `foundation`.

**docker-compose contract:** service `app`: builds `Dockerfile`; mounts repo at `/app`, sibling ToS worktree at `/tos` (host path from `TOS_REPO_PATH`, default `../tome-of-secrets`), and `/var/run/docker.sock`; env `TOS_REPO_DIR=/tos`; publishes `5173`; anonymous volume for `/app/node_modules`.

**Known pitfall to resolve here, not later:** with a socket-mounted daemon, the Supabase CLI inside the container starts its containers on the host, so it must reach Postgres/Kong via `host.docker.internal` rather than `127.0.0.1`. Make `db:start`, `db:reset`, `db:test` work from the container (try `network_mode: host` first if the host's Docker supports it; otherwise `extra_hosts: ["host.docker.internal:host-gateway"]` plus whatever CLI flags/env are needed). The browser keeps using `http://127.0.0.1:54321`. Timebox this. The user has the Supabase CLI installed on the Windows host (PowerShell), and **running `supabase start` / `db reset` / `test db` on the host against the ToS worktree is an accepted fallback** — the app, tests, lint and build still run in compose. Document whichever path is used in the README.

- [ ] **Step 1: Failing smoke test** `src/App.test.tsx`: renders `<App />`, `expect(screen.getByRole('heading', { name: 'Our Library' })).toBeInTheDocument()`.
- [ ] **Step 2:** `docker compose run --rm app npm test` → FAIL (App missing heading).
- [ ] **Step 3:** Scaffold per the file list; `App` renders `<h1>Our Library</h1>`.
- [ ] **Step 4: Verify.** `docker compose run --rm app npm test` PASS; `docker compose run --rm app npm run lint` clean; `docker compose run --rm app npm run build` succeeds; `docker compose up app` → `http://localhost:5173/tos-personal-library/` loads from the host; `docker compose run --rm app npm run db:start` boots the local stack (after Task 1).
- [ ] **Step 5: README** — setup (`cp .env.example .env`, `TOS_REPO_PATH`), `docker compose up app`, test/lint/db commands, the two GitHub secrets for deploy.
- [ ] **Step 6: Review + commit.** Subagent review of the diff. Commit `chore: scaffold app, docker-compose dev env, pages deploy`.

### Task 4: Supabase client, types, and sign-in

**Files:**
- Create: `src/lib/supabase-config.ts` (copy kinetic's, unchanged API: `getSupabaseClientEnv()`, `isSupabaseConfigured()`), `src/lib/supabase.ts`, `src/lib/types.ts`, `src/contexts/AuthContext.tsx`, `src/components/auth/SignIn.tsx`
- Test: `src/lib/supabase-config.test.ts`, `src/components/auth/SignIn.test.tsx`

**Interfaces — Produces:**
- `supabase` — `createClient(url, key, { db: { schema: 'library' } })`
- `types.ts`: `Book`, `Copy`, `HouseholdMember`, `Household` mirroring Task 2 columns in camelCase, plus `BookWithCopies = Book & { copies: Copy[] }`. Row mappers `toBook(row)`, `toCopy(row)`, `fromBookPatch(patch)`.
- `useAuth(): { user: User | null; loading: boolean; signInWithEmail(email: string): Promise<void>; signOut(): Promise<void> }`
- `signInWithEmail` calls `supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: window.location.origin + import.meta.env.BASE_URL } })`.

- [ ] **Step 1: Failing tests.** `supabase-config.test.ts`: `isSupabaseConfigured()` false when key is `'public-anon-placeholder'` or empty, true when both set (use `vi.stubEnv`). `SignIn.test.tsx` (mock `useAuth`): submitting `a@b.co` calls `signInWithEmail('a@b.co')` and shows "Check your email for a sign-in link."; when `!isSupabaseConfigured()` shows "Supabase isn't configured" and disables the button.
- [ ] **Step 2:** `docker compose run --rm app npm test -- src/lib src/components/auth` → FAIL.
- [ ] **Step 3:** Implement per Interfaces. `App` shows `SignIn` when `!user`, otherwise the signed-in shell (header with email + sign out).
- [ ] **Step 4:** Tests PASS. Manual: with local stack, sign in via Inbucket/Mailpit (`http://127.0.0.1:54324`), land signed in.
- [ ] **Step 5: Commit** `feat: supabase client and email sign-in`.

### Task 5: Household context and setup screen

**Files:**
- Create: `src/lib/household-repo.ts`, `src/contexts/HouseholdContext.tsx`, `src/components/household/HouseholdSetup.tsx`, `src/components/household/InviteCode.tsx`
- Test: `src/components/household/HouseholdSetup.test.tsx`

**Interfaces:**
- Consumes: `supabase`, `useAuth`, `library.create_household`, `library.join_household`.
- Produces:
  - `getMyHousehold(): Promise<{ household: Household; members: HouseholdMember[] } | null>`
  - `createHousehold(name: string, displayName: string): Promise<string>`
  - `joinHousehold(inviteCode: string, displayName: string): Promise<string>` — throws `Error('invalid_invite_code')` when the RPC raises it.
  - `useHousehold(): { household: Household | null; members: HouseholdMember[]; loading: boolean; refresh(): Promise<void> }`

- [ ] **Step 1: Failing test** (mock repo). Create form: name "Home", your name "Tierra" → `createHousehold('Home','Tierra')` then `refresh()`. Join form: rejecting with `invalid_invite_code` shows "That invite code didn't match a household." and stays on setup. Review Focus 1–3.
- [ ] **Step 2:** run → FAIL.
- [ ] **Step 3:** Implement. App flow: signed in + `household === null` → `HouseholdSetup`; otherwise library. `InviteCode` (in a settings/menu area) shows the code with a copy button so the partner can join.
- [ ] **Step 4:** PASS; manual: user A creates, user B joins with A's code, both see the same (empty) library.
- [ ] **Step 5: Commit** `feat: household create/join`.

### Task 6: Catalog loading, search/filter, cover wall

**Files:**
- Create: `src/lib/library-repo.ts`, `src/lib/filter-books.ts`, `src/hooks/useCatalog.ts`, `src/components/library/CoverWall.tsx`, `src/components/library/BookCard.tsx`, `src/components/library/LibraryFilters.tsx`, `src/lib/router.ts`
- Test: `src/lib/filter-books.test.ts`, `src/components/library/BookCard.test.tsx`

**Interfaces:**
- Produces:
  - `listBooks(householdId: string): Promise<BookWithCopies[]>` — one `select('*, copies(*)')`, ordered by title.
  - `type OwnerFilter = 'all' | 'shared' | string /* member userId */`
  - `filterBooks(books: BookWithCopies[], opts: { query: string; owner: OwnerFilter }): BookWithCopies[]`
  - `useCatalog(): { books: BookWithCopies[]; loading: boolean; error: string | null; reload(): Promise<void> }`
  - `router.ts`: `useRoute(): Route` and `navigate(route: Route)` with `type Route = { name: 'library' } | { name: 'book'; id: string } | { name: 'add' }`, hash URLs `#/`, `#/book/<id>`, `#/add`.

`filterBooks` rules: query matches case-insensitively and accent-insensitively (`normalize('NFD')` + strip combining marks) against title and every author, as a substring; empty query matches all. Owner `'shared'` keeps books with ≥1 copy where `ownerUserId === null`; a userId keeps books with ≥1 copy owned by that user; `'all'` keeps everything, including books with zero copies.

- [ ] **Step 1: Failing tests.** `filter-books.test.ts`: `"brom"` matches title "Slewfoot" with authors `["Brom"]`; `"lee"` matches authors `["Fonda Lee"]`; `"poete"` matches "Poète Empress"; multi-author book matches on its second author; owner filter cases above; empty query returns input order unchanged. `BookCard.test.tsx`: with `coverUrl: null` renders a placeholder containing title and first author (Review Focus 4); with a cover renders `<img alt="<title> cover">`.
- [ ] **Step 2:** run → FAIL.
- [ ] **Step 3:** Implement. Phone-first grid (2 columns on phones, more on wider screens), search box and owner chips ("All", "Shared", one per member display name) in a sticky header. Empty catalog shows "No books yet" with an "Add a book" button to `#/add`.
- [ ] **Step 4:** PASS; manual on a phone-width viewport with a few books inserted via Studio (`http://127.0.0.1:54323`).
- [ ] **Step 5: Commit** `feat: cover wall with search and owner filter`.

### Task 7: Book detail, copies, manual add, edit tracking

**Files:**
- Create: `src/lib/edited-fields.ts`, `src/components/book/BookDetail.tsx`, `src/components/book/BookForm.tsx`, `src/components/book/CopyList.tsx`, `src/components/book/CopyForm.tsx`, `src/components/book/AddBook.tsx`
- Modify: `src/lib/library-repo.ts`
- Test: `src/lib/edited-fields.test.ts`, `src/components/book/CopyList.test.tsx`

**Interfaces:**
- Produces (plan 2's importer depends on `editedFields` semantics):
  - `changedFields<T>(before: T, after: T, keys: (keyof T)[]): string[]` — keys whose values differ (arrays compared element-wise).
  - `markEdited(existing: string[], changed: string[]): string[]` — sorted union, no duplicates.
  - repo: `createBook(householdId: string, input: BookInput, firstCopy: CopyInput): Promise<BookWithCopies>` (origin `'manual'`); `updateBook(id: string, patch: Partial<BookInput>, editedFields: string[]): Promise<void>`; `deleteBook(id: string)`; `addCopy(bookId: string, input: CopyInput): Promise<Copy>`; `updateCopy(id: string, patch: Partial<CopyInput>, editedFields: string[]): Promise<void>`; `deleteCopy(id: string)`.
  - `BookInput = { title; authors; synopsis; coverUrl; isbn13; isbn10; pageCount; publisher; publishDate }`; `CopyInput = { ownerUserId: string | null; editionNote: string | null; location: string | null }`.
  - Edit forms send `user_edited_fields = markEdited(row.userEditedFields, changedFields(before, after, editableKeys))`. Manual creation does **not** mark fields edited.

- [ ] **Step 1: Failing tests.** `edited-fields.test.ts`: `changedFields({title:'A',authors:['x']},{title:'B',authors:['x']},['title','authors'])` → `['title']`; arrays `['x']` vs `['x','y']` differ; `markEdited(['title'],['authors','title'])` → `['authors','title']`. `CopyList.test.tsx`: owner labels render as member display name or "Shared"; deleting a copy when 2 exist calls `deleteCopy` without prompting; deleting the only copy shows "Remove this book from the library too?" — confirm calls `deleteBook`, cancel calls `deleteCopy` only (Review Focus 5).
- [ ] **Step 2:** run → FAIL.
- [ ] **Step 3:** Implement. `BookDetail` at `#/book/<id>`: cover (or placeholder), title, authors, synopsis, copies list (owner, edition note, location, origin), edit book, add/edit/delete copy, delete book (confirm). `AddBook` at `#/add`: title + authors required, owner defaults to the signed-in user. Mutations call `reload()` on the catalog.
- [ ] **Step 4:** PASS; manual: add, edit, add second copy owned by partner, filter by partner, delete last copy flow.
- [ ] **Step 5: Commit** `feat: book detail, copies, manual add with edit tracking`.

### Task 8: Installable PWA and branch wrap-up

**Files:**
- Create: `public/manifest.webmanifest` (`name: "Our Library"`, `short_name: "Library"`, `start_url` and `scope` `/tos-personal-library/`, `display: "standalone"`), `public/icons/icon-192.png`, `public/icons/icon-512.png`, `public/icons/maskable-512.png`
- Modify: `index.html` (manifest link, `theme-color`, apple-touch-icon), `README.md`

- [ ] **Step 1:** Add manifest, icons (simple generated book glyph is fine), and links.
- [ ] **Step 2: Verify.** `docker compose run --rm app npm run build`; `dist/manifest.webmanifest` present with correct `start_url`; Lighthouse/Chrome DevTools "Application → Manifest" shows no errors on `npm run preview`.
- [ ] **Step 3: Full gates.** `npm test`, `npm run lint`, `npm run build` green in compose. Whole-branch subagent review against the spec and this plan. Fix findings.
- [ ] **Step 4: Commit and push.** Commit `feat: installable web app manifest`. Create the GitHub repo `tos-personal-library` (ask the user first — it's outward-facing), push `main` (docs only) and `foundation`, open PR `foundation → main`, leave unmerged. Note in the PR that production use waits on the ToS `library-schema` PR merge, the `migration repair` + `db push`, the two dashboard steps, and the repo's two Actions secrets.
