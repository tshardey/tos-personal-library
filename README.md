# Our Library

Household physical-book catalog (Vite + React + TypeScript + Tailwind 4 + Vitest). It uses the `library` schema of the Tome of Secrets Supabase project. Design: `docs/superpowers/specs/2026-11-03-personal-library-design.md`.

## Setup

```bash
cp .env.example .env
```

Edit `.env`:

- `TOS_REPO_PATH` - host path of the Tome of Secrets checkout (or worktree) that owns `supabase/` migrations. It is mounted at `/tos` in the container.
- `VITE_SUPABASE_URL` / `VITE_SUPABASE_PUBLISHABLE_KEY` - local values from `supabase status`.
- `VITE_GOOGLE_BOOKS_API_KEY` - optional; leave blank to skip Google Books (see Deploy).

## First-time install

`node_modules` lives in a named Docker volume (`node_modules`), so Linux deps never clash with Windows. A fresh clone has an empty volume, so install before anything else:

```bash
docker compose run --rm app npm install
```

Re-run it whenever `package.json` or `package-lock.json` changes.

## Daily commands (Docker Compose)

```bash
docker compose up app                       # http://localhost:5173/tos-personal-library/
docker compose run --rm app npm test
docker compose run --rm app npm run lint
docker compose run --rm app npm run build
```

## Local database (Supabase)

The Supabase CLI is pinned (`supabase` devDependency `2.122.1`; 3.x rejects the ToS `config.toml` `[inbucket]` section).

**Host is the supported path for database commands.** The container shares the host Docker daemon through the mounted socket, so the CLI's bind mounts (`/tos/...`) refer to paths the daemon cannot see, and it connects to `127.0.0.1` inside the container. Findings:

- `npm run db:start` in the container works only to report an already-running stack; a fresh start there is unreliable.
- `db:reset` in the container needs `--db-url` and then leaves the DB in a state where pgTAP fails (`not_authenticated`), so do not use it.
- `db:test` in the container finds no tests (the daemon mounts an empty `/tos`).

Run these from the host instead (PowerShell or Git Bash), from this repo:

```bash
npx supabase@2.122.1 start    --workdir ../tome-of-secrets
npx supabase@2.122.1 db reset --workdir ../tome-of-secrets
npx supabase@2.122.1 test db  --workdir ../tome-of-secrets
npx supabase@2.122.1 status   --workdir ../tome-of-secrets   # keys for .env
npx supabase@2.122.1 stop     --workdir ../tome-of-secrets
```

Use your `TOS_REPO_PATH` value for `--workdir`. The `npm run db:*` scripts read `TOS_REPO_DIR` (`/tos` in the container) and also work on the host if you set `TOS_REPO_DIR` to the ToS path.

## Import from libib

The Import screen needs the `library.libib_import_rows` table from the Tome of Secrets `libib-import-ledger` migration. Without it the screen shows `Couldn't read the library, so nothing was imported.` and writes nothing.

1. **Export from libib.** libib exports each collection as its own CSV. Upload the file as it comes: opening and re-saving it in Excel can damage ISBNs, and the preview warns when it sees that.
2. **Upload it** under Import. The preview writes nothing. It shows the counts, the new books, anything to review and any rows it skipped.
3. **Choose an owner for each collection:** a household member, Shared, or Skip this collection. An owner is preselected when a member's name is a whole word of the collection name, or when you chose one for that collection before. Import stays disabled until every collection has a choice. Skipped rows write nothing and arrive on a later upload, which suits a partner who hasn't joined yet.
4. **Settle the review items.** A row that may match a book you already have is listed with a suggested choice: the same copy, another copy, or a separate book.
5. **Confirm.** Missing covers and descriptions are then looked up on OpenLibrary, which receives the ISBNs, and then on Google Books for books OpenLibrary didn't fill, when a Google Books key is set. A lookup failure doesn't affect the import. `Find missing covers` on the Import screen tries again.

**Uploading again is safe.** Rows are recognised by their libib id, so a repeat upload adds only new rows and any rise in `copies`. A file with nothing new says `Everything in this file is already in the library.` Repeat uploads only fill empty book fields. They never replace a value, change a field you edited, or touch an existing copy, so changing an owner choice doesn't re-tag copies already imported.

**Deletes stay deleted.** A book or copy you delete here doesn't come back on the next upload, and deleting a row in libib deletes nothing here. A row whose copies are all gone is listed under `Removed here earlier, staying removed`, with an `Import again` tick box to undo it. If `copies` rises in libib, the extra copies are added even after a delete.

**If an import stops partway,** what was saved stays. `Run it again` adds only what's missing, without duplicates.

## Deploy (GitHub Pages)

Pushes to `main` run `.github/workflows/deploy.yml`. Add these repository secrets (Settings > Secrets and variables > Actions):

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`
- `VITE_GOOGLE_BOOKS_API_KEY` (optional): a Google Books API key for covers and descriptions OpenLibrary lacks. It ships in the client bundle and appears in request URLs, so treat it as public and restrict it by HTTP referrer to `https://tshardey.github.io/tos-personal-library/*` (and `http://localhost:5173/*` for dev), and to the Books API. Unset skips Google Books.

and set Pages source to "GitHub Actions".

Production prerequisites (one-time, on the shared Supabase project):

1. The Tome of Secrets `library-schema` PR is merged.
2. Mark the baseline applied, then push migrations: `supabase migration repair --status applied 20260407000000`, then `supabase db push`.
3. Dashboard > Project Settings > API > Exposed schemas: add `library`.
4. Dashboard > Authentication > URL Configuration > Redirect URLs: add `https://<user>.github.io/tos-personal-library/`.
5. The two Supabase Actions secrets above are set.

## Install on Android

Open the deployed site in Chrome, then menu (three dots) > "Add to Home screen" / "Install app". The app is online-only (no service worker), so it needs a connection to load.
