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

## Covers

The cover finder looks for better covers for books with a missing or wrong one. **Nothing on a book changes until someone picks a cover and presses Apply.**

1. **Mark one book.** On a book's page, `Find a better cover` opens a small panel. Pick what's wrong (`Wrong language`, `Placeholder`, `Wrong book`, `Low quality`) and add a note if it helps, for example "this is the Spanish edition". `Add to batch` saves the mark for later. `Find now` searches for that book straight away (`Looking for covers…`). Marks are shared: either of you can see, change or remove them.
2. **Or search a whole filter.** The library's covers filter has `No cover` (no cover URL, even if a copy photo shows), `Marked for cover` and `Nothing found`. With `No cover` or `Marked for cover` chosen, a footer shows how many books would be searched and roughly what it costs, and `Find covers` searches all of them. Books already being searched, and books tried before with nothing found, are left out.
3. **Let it run.** The search runs in the app while either of you has it open, so a batch started on one phone and closed carries on when the other person opens the app. It looks on OpenLibrary and Google Books (when a key is set) across editions, keeps English editions, and has Claude check the candidate images. Nothing runs while nobody has the app open.
4. **Review.** `Covers to review (n)` appears in the header for both of you. The review list shows each book's current cover and up to four found covers, with the best match already picked. Change the pick, or choose `Current` to keep the cover you have, then press `Apply`. If a cover was changed by hand after the search, the row says `This cover was changed after the search.` and keeps the current one unless you pick another. If the other person already reviewed a book, Apply says so and changes nothing twice. A cover chosen here is never replaced by later automatic lookups.
5. **Nothing found.** A book with no good candidate says `Nothing good found.` once in the review list, then only under the `Nothing found` filter. Later batches skip it. `Try again` on that list or the book's page searches it again, and so does saving its mark with a new note.

**Budget.** Cover finding has its own budget of **$5 a month** (a UTC calendar month), counted before each check so it can't be overspent. It shares the Claude workspace's $10 monthly cap with photo intake, so the $5 limit leaves room for photos. The review page shows `This month: … used`. Near the limit the footer says how many of the books the budget still covers; at the limit `Find covers` and `Find now` are disabled and the rest wait for next month or a manual retry.

**If it stops,** a banner under the header says why: the budget is used up, cover finding isn't set up yet, or the Claude account refused the requests. All but the budget banner have `Try again`.

**Privacy.** OpenLibrary and Google Books get the title and author. Claude gets the title, authors, what you marked as wrong, your note and the candidate images. The chosen cover is stored as a link, like a hand-typed cover URL.

**Requires** the Tome of Secrets `library-cover-finder` migration and `library-covers` Edge Function. Without the migration the cover filters, the panel and the badge don't show, and the rest of the app works as before. Without the function, searches wait and the banner says `Cover finding isn't set up yet.`

## Unhauling and copy flags

Each copy on a book's page has three toggles next to its notes: `Deluxe`, `Signed` and `Unhaul`. One tap sets each one, and the same tap undoes it (`Undo unhaul` on an unhauled copy). None of them changes the edition note, the copy note or the copy's origin, and a later libib import never undoes them.

**Unhaul** a copy you traded in or gave away, instead of deleting it, so the library remembers you once had it.

- A book is unhauled when every one of its copies is. A book with one copy left on the shelf stays in the list, and its page says, for example, `1 on the shelf · 1 unhauled`. A book with no copies at all stays in the list too.
- **Hidden:** unhauled books leave the main list and the cover wall, the book count, the `Date added` counts, the `No cover` filter and cover batches, and Tome of Secrets' `On our shelf`, its book picker and its tidy review.
- **Still shown:** typing in the search box finds unhauled books, marked `Unhauled`, so a search in a bookshop shows you had a title and let it go. The `Unhauled` filter lists every book with an unhauled copy. Their book pages still open, with the unhauled copies marked and dimmed. Scanning one says `We had this and unhauled it`, and you can still add a re-bought copy. A Tome of Secrets quest that already uses the book keeps it, with an `Unhauled` mark.

**Deluxe and Signed** show as badges on the book in the list whenever a copy still on the shelf has them. In Tome of Secrets, picking a book with a Deluxe copy suggests the Special / Illuminated Edition tag, even when the edition note is empty.

**Filters and the count.** Above the list, a count such as `42 books` follows the search and every filter.

- `Deluxe`, `Signed` and `Unhauled` filter the list. Each filter checks a book's copies on its own, so an owner with `Deluxe` also matches a book where that person owns one copy and a different copy is deluxe.
- `Date added` lists each day copies were added, newest first, with the number of copies (for example `Nov 12 · 23`), in your own time zone.
- `Published` takes a from and to year; either end can be left blank. It reads the year from the book's publish date, so a book with no year in it is left out while the filter is on.

The list keeps its place, search and filters when you open a book and go back. A reload clears them.

**Requires** the Tome of Secrets `library-copy-flags` migration.

## Edition labels

A copy's edition label (its edition note, for example `Lantern Box` or `Harbor Press`) says where that edition is from. Deluxe and Signed are separate toggles, so a label doesn't need them.

**Tidying labels.** `Edition labels` in the account menu lists every label in the household with its number of copies. Spellings that differ only by case are listed apart so one can be merged into the other. `Rename` changes the label on every copy that has exactly that label (ignoring surrounding spaces):

- A new name that matches another label, ignoring case and surrounding spaces, **merges** into it, keeping that label's spelling. The screen shows how many copies the merged label will have.
- A blank name clears the label from those copies.
- Nothing is written until you confirm, and the confirmation names how many copies will change.

Each changed copy is marked as hand-edited, so a later libib import doesn't undo it. Nothing else on the copy changes. A library `Edition` filter on the old label moves to the new one. Open Inbox items and a scan session's edition keep their own label until they are confirmed or changed.

**Avoiding new duplicates.** Wherever an edition is chosen (a book's copies, Add book, Scan, the Inbox cards, batch uploads and bulk confirm), the picker suggests the household's labels as you type, and a typed label that differs from one of them only by case or surrounding spaces uses the existing spelling.

## Mass edit

`Select` above the library's cover wall turns each book into a tickbox. `Select all` adds every book the current search and filters show, and ticks stay while you scroll or change the search, so a selection can be built up from several searches. The bar at the bottom shows `n selected`, `Clear`, `Done` (leaves select mode) and `Edit`.

`Edit` opens a sheet where every field starts as `No change`:

- **Copy fields:** edition label (the same picker as elsewhere; `None` clears it), `Deluxe`, `Signed`, `Unhauled` (`Unhauled` or `On the shelf`), owner (a household member or `Shared`) and location. A typed label or location that differs from an existing one only by case or surrounding spaces uses the existing spelling.
- **Series:** set or clear the series name on every selected book. Volumes stay as they are.
- **Copies:** every copy of the selected books is listed under its book with a tickbox. Copy changes apply only to ticked copies; copies already unhauled start unticked.

`Save` asks to confirm with the counts, for example `This will change 14 copies and 3 books' series.` Only values that actually change are written and counted. There is no undo. Each changed field is marked as hand-edited, so a later libib import doesn't undo it. If some writes fail, the rest are kept, the sheet lists the books and copies that didn't change, and `Try again` retries just those.

The sheet also has a `Library tags` row with `Add tags` and `Remove tags`. A tag removed this way counts as removed by hand (see below).

## Tags and Ask

**What the tagger writes.** A Claude tagging pass (the `library-tagger` Edge Function in Tome of Secrets) reads one book at a time: its title, authors, series, description and cover. It writes:

- **ToS tags** (genre and the like), the same tags the book page's `Tome of Secrets` section shows and ToS uses for "On our shelf";
- **library tags** from the household's own list (mood, setting, protagonist, cover colours and motifs, and more), shown in the book page's `Library tags` section;
- a short **book card** (a summary and a one-line cover description) that Ask reads later.

It only adds tags. **A tag removed by hand never comes back:** removing a tag in this app or in ToS records it, and later passes skip it on that book. Adding it back by hand clears the record. Cover tags follow the cover: when a book gets a new cover, the tags the tagger gave the old cover are replaced, and cover tags added by hand stay.

**When books get tagged.** A new book, or a book whose description or cover changes, is queued automatically. The queue is worked through whenever either of you has the app open (the cover finder works the same way); closing the app just pauses it. On the book page, `Edit tags` changes the library tags and `Retag this book` queues the book again. To retag many books (for example after new tags are added), select them, choose `Edit`, and press `Retag selected`: it shows the estimated cost and what is left of the month's budget, and nothing is spent until you press `Confirm`.

**Tag suggestions** (account menu, under `Edition labels`):

- `This month: …` shows what tagging and Ask have used this month.
- **Tag all books** lists the books that have never been tagged, with the count and an estimated cost. `Try 10 first` tags just ten, to check the results before `Tag all books` does the rest. Progress reads `Tagged {done} of {total}.` and carries on in whichever of your apps is open.
- **Check for new tags** re-reads tagged books against tags added since they were tagged, using their book cards (cheaper than a full pass).
- **Suggestions** are new tags the tagger proposes, each with the books it would fit. `Approve` (after a last edit of the label and category) adds it to the list and to those books; `Dismiss` drops it. `Add a tag` adds one by hand.

**Filtering.** `Library tags` beside `ToS tags` on the library filters by library tags. As with ToS tags, a book must have every chosen tag. Both filters are free: they read tags already written.

**Ask ✨.** Type a reading prompt in the search box (for example, a reading-challenge prompt) and press `Ask ✨` instead of searching. Ask reads the shelf the filters show **as if the search box were empty**: the typed text is the prompt, not a title search, and unhauled books are left out unless the `Unhauled` filter is on. It answers with a short ranked list, each book with a confidence and a reason, in place of the cover wall. Opening a book and coming back keeps the answer without asking again; changing the search or a filter clears it. Narrow the filters when a shelf is too big to ask about at once.

**Budgets.** Each household has a monthly budget per feature: **tagging $5 in its first month (the full pass), then $2 a month; Ask $2 a month**. Both sit inside the shared $10 a month Claude workspace cap that the cover finder also uses. When a budget is used up, the button says so (`This month's tagging budget is used up.`, `This month's Ask budget is used up.`), a running tagging pass stops with a banner, and the rest carries on next month. Nothing is spent on filters, on browsing tags, or when a feature isn't set up yet.

**Before the database and functions are deployed** the app hides every tagging and Ask control and everything else works as before. If the database is updated but the functions aren't deployed yet, tagging stops with `Tagging isn't set up yet.` and Ask shows `Ask isn't set up yet.`, and nothing is billed.

## Tome of Secrets

The book page has a Tome of Secrets section with the book's tags, grouped by category. The labels come from ToS's published `bookTags.json` (the app keeps the last good copy if the fetch fails; with no copy, tags show as raw ids). Tags are shared per book: everyone in the household sees the same ones, and the library list can filter by them.

Tags that are "just you" (such as re-reads) and tags ToS works out from a book's type live only in ToS. The library shows them read-only as "set in Tome of Secrets" and never offers them for editing.

Books also have a series name and volume, set from the book page; "Show the rest of this series" and the library's series filter list the others. When a ToS shelf record is in a series, ToS fills the book's series name if it is still empty. It never overwrites a series or a volume you set.

If the database changes for tags and series haven't been applied yet, the book list still loads; the tags section reads "Tome of Secrets tags unavailable." and saving a series fails with an error.

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
