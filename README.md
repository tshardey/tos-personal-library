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
docker compose run --rm app sh -c "npm run build && npm run check:bundle"   # no zxing in the entry chunk
```

**End-to-end walkthrough (Playwright).** It runs only against the local stack, with `supabase functions serve` running and `LIBRARY_INTAKE_FAKE_VISION=1` in its env file (no Anthropic key). Pass the local publishable key from `supabase status`:

```bash
E2E_SUPABASE_PUBLISHABLE_KEY=<local publishable key> docker compose run --rm e2e npx playwright test
```

It signs up throwaway users on the local stack, fakes the camera, and generates its barcode images and photos at run time.

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

## Photos

The Inbox turns photos of book covers into catalog entries. Nothing is written to the library until a person taps Confirm.

1. **Choose an owner** (a household member or Shared). It is remembered on the device and can be changed on any card.
2. **Add photos.** Batch mode: `Choose photos` takes many cover photos at once, one book per photo, and uploads them one at a time. Keep the page open until uploads finish; the screen is held awake meanwhile. Single mode: `Take a photo` for the cover, then `Add title page` for an optional second photo, or `Done`. Title pages are single mode only, so a batch never pairs one book's title page with another's cover.
3. **Wait for the cards.** Each photo is read and looked up online (OpenLibrary, then Google Books if a key is set). A lookup that doesn't match the photo's title and author is ignored.
4. **Review each card.** Confirm adds one book. A card that matches a book already in the library proposes `Add a copy` or `Already recorded` (preselected when the same owner already has a copy, for example from libib); a near match or series sibling is never the default, so it becomes a visible separate book rather than a silent merge. `Already recorded` writes nothing and removes the photo.
5. **Bulk confirm.** `Add N new books` appears when some cards are safe to add together: each is read with high confidence, has a title, matches nothing in the library and has no twin in the same batch. It only creates new books. It never adds copies, links, or discards. The sheet lists every title first, and any card that stops qualifying during the run is skipped and left for review.

**Limits.** 500 photo reads per household per day, and 3 tries per photo. A photo that can't be read after 3 tries asks for the title to be typed. Photos that are too small or not JPEG-readable (HEIC) are refused with a message; set the camera to JPEG ("Most compatible").

**Privacy.** The photo bucket is private and only household members can read it. Photos are resized in the browser to 1280 px and re-encoded, which drops EXIF including location. On Confirm the cover is kept as that copy's photo (shown when the book has no stock cover) and the title page is deleted. On discard both are deleted. Photos uploaded but never turned into a card are removed after 24 hours.

**Requires** the Tome of Secrets `library-photo-intake` migration and `library-intake` Edge Function. Without them the page says `Couldn't reach the photo inbox.`

## Scan

`Scan` in the header opens the barcode scanner for working through a shelf. A scan only adds a card to the Inbox. Nothing is written to the library until someone confirms it there.

1. **Set up the session.** Pick the owner and the `Edition for this session` (for example a box or club name) before you start. Both apply to every scan and photo in the session until you change them, and the edition can still be changed per card in the Inbox. A session survives a reload: reopening Scan shows its list with `Started {time}`, and `New session` starts a fresh one.
2. **Tap `Start scanning` once.** The back camera starts and keeps reading, so there is no tap per book. Hold each book's barcode inside the white band. The camera stops when you switch apps, lock the phone, or leave it untouched for 2 minutes (`Resume camera` starts it again).
3. **Listen for the beeps.** One high beep (and a short buzz on Android) means the book was added to the list. Two low beeps mean look at the screen: the book is already in the library or waiting in the Inbox from another session, or you scanned it again. The border also flashes green or amber, which is the only cue when the phone is on silent (iPhone has no vibration). `Sound on` turns the beeps off and is remembered.
4. **Second copies.** A barcode held in view counts once. Scanning the same book again after a few seconds asks `Add another copy?`, and each row also has `Add another copy`.
5. **When a barcode won't read**, or the book has none, use `Take a photo`. A row that says `Not found online.` has its own `Take a photo`, and the photo replaces that row and keeps the scanned ISBN. A barcode that isn't an ISBN (a shop sticker or a mass-market UPC) says `That barcode isn't an ISBN.` and suggests a photo.
6. **`Type ISBN`** takes an ISBN-13 or ISBN-10 by hand. It also works when camera access is off.
7. **Done** opens the Inbox, where each scan is a card to review: bulk confirm (`Add N new books`) for clear new books, or one card at a time. Two scans of the same book in a session are never bulk-added.

**Offline.** Scans are saved on the phone first and upload when the network is back (`Saved on this phone. It will upload when you're back online.`). Don't clear site data until they have uploaded. Book lookups (OpenLibrary, then Google Books if a key is set) wait and retry by themselves when they are rate limited or offline (`Online lookup paused. It will retry.`).

**Privacy and cost.** Scanning reads EAN-13 ISBNs on the phone; the barcode reader is downloaded the first time the camera starts and is served from this site. Only the ISBN is sent, to OpenLibrary and Google Books. Scans never call Claude and don't count toward the daily photo limit. The camera needs HTTPS, so it works on the deployed site, not on the LAN dev server.

**Requires** the Tome of Secrets `library-scan-intake` migration.

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
