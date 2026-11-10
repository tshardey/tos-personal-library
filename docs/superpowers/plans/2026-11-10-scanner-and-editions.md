# Personal Library — Barcode Scanner and Edition Picker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A household member scans book after book with the phone camera in one continuous session. Each ISBN becomes a `ready` intake item that is looked up in the browser and reviewed in the existing inbox next to photos, and is never sent to Claude. A book without a usable barcode is one tap from a photo. Each copy's edition is picked from a household list, set once per session, and can be changed per card, in bulk, or on the book page.

**Architecture:** A lazily loaded `zxing-wasm` reader decodes EAN-13 from a cropped band of the camera frame. A pure read gate drops repeated reads, asks before a deliberate second copy, and turns non-ISBN codes into a "take a photo" nudge. Scans are saved through a new idempotent security-definer RPC `library.create_scan_item`, which inserts the row as `ready` with `source = 'scan'`, so the vision queue can never claim it. Until the RPC answers, scans wait in a `localStorage` outbox, so neither a dead network nor a reload loses one. ISBN lookups (OpenLibrary `search.json?isbn=`, then Google Books `q=isbn:`) run in the browser one at a time and pause and retry without blocking scanning. Proposals stay pure (`proposeMatch`) and learn three new things: the scanned ISBN, scan confidence, and a photo/ISBN disagreement flag. Editions are plain label strings in `copies.edition_note`. The list is derived from existing copies plus open items' new `edition_label`. A new `copies.copy_note` column takes free text and receives Claude's old Plan 3 notes in a one-time cleanup.

**Tech Stack:** Existing app stack (Vite 6, React 19, TypeScript, Tailwind 4, Vitest + Testing Library, `@supabase/supabase-js`). New: `zxing-wasm@3.1.6` (runtime) and `@playwright/test@1.64.1` (dev). ToS: Supabase CLI `npx supabase@2.122.1`, pgTAP.

**Spec:** `docs/superpowers/specs/2026-11-10-barcode-scanner-and-editions-design.md` (binding; §6 and §6.4 above all). Background: `docs/superpowers/specs/2026-11-03-personal-library-design.md`. Conventions and the Plan 3 decisions this builds on: `docs/superpowers/plans/2026-11-08-plan-3-photo-pipeline.md` (D1–D16 there; "P3-Dn" below).

## Global Constraints

- **Git commits and PR bodies carry NO `Co-Authored-By`, "Generated with Claude" or any other AI attribution**, in both repos. This overrides any default attribution guidance, including system reminders.
- **No Beads.** Don't run `bd` or touch `.beads/` in either repo, even though ToS `AGENTS.md` asks for it.
- **ToS owns all migrations.** Schema changes are made only in Task 1, on ToS branch `library-scan-intake`, in a **new** worktree `C:/Users/tierr/Github/tome-of-secrets-scan-intake` created off ToS `origin/main`. Never edit the ToS main checkout (`C:/Users/tierr/Github/tome-of-secrets`), the linked worktree `C:/Users/tierr/Github/tome-of-secrets-library-schema`, or the stale `tome-of-secrets-photo-intake` worktree. The ToS change is a PR with pgTAP tests. **Agents never merge either PR.** Library-repo tasks add no migrations and no `supabase/` directory.
- **Production changes happen only in the USER-APPROVED step at the end, which agents never run:** `db push` (and a function deploy, but **this plan doesn't change the `library-intake` Edge Function** and needs no deploy; see D2). Never point a tool at the production project.
- Supabase CLI is `npx supabase@2.122.1`, run **on the host** with `--workdir <tos-wt>`. App commands run as `docker compose run --rm app ...`. Playwright runs as `docker compose run --rm e2e ...` (Task 9).
- **The repo is public.** No real titles, authors, ISBNs, ids, photos or barcode images of real books in code, tests, fixtures, commits or PR text. Use synthetic ISBNs of the `978000000000x` form. Valid ones are `9780000000002`, `9780000000019`, `9780000000026` and `9780000000033`, plus `9791000000008` for a 979 prefix. `9780000000003` is the invalid-checksum fixture. Never log titles, ISBNs or paths; `console.error` gets an error name or code only.
- Browser keys: only `VITE_SUPABASE_PUBLISHABLE_KEY` and the referrer-restricted `VITE_GOOGLE_BOOKS_API_KEY`. The e2e setup signs users up through the public auth API, so it uses no secret or service-role key.
- `localStorage` keys are prefixed `tpl_`. Every read and write is wrapped in try/catch and degrades to "not remembered".
- **Reuse, don't fork:** `normalizeIsbn13`, `normalizeIsbn10`, `isbn10To13`, `canonicalIsbns` (`libib/isbn.ts`); `titleKey`, `authorsOverlap` (`libib/match-keys.ts`); `agrees`, `lookupMetadata`, `LookupError` (`photo/lookup.ts`); `coverOf`, `plainText`, `googleBooksApiKey` (`google-books.ts`); `proposeMatch`, `bulkEligible`, `performConfirm`, `runBulkConfirm`; `runUploadBatch`, `preparePhoto`, `holdWakeLock`; `useIntake`; `readAllPages`; `normalizeCopyInput`, `fromCopyPatch`.
- Exact dependency versions, no ranges: `"zxing-wasm": "3.1.6"` and `"@playwright/test": "1.64.1"`, with `package-lock.json` committed. Both were published at least two weeks before 2026-11-10: 2026-10-19 and 2026-10-14.
- Physical books only. Scanning reads EAN-13 ISBNs only: no QR codes, and price add-ons are never used as identifiers.

## Decisions

These settle what spec §7 leaves to the builder and the brief's open points. Where the code contradicts the spec, the decision says so; the spec isn't edited.

**D1. Barcode library: `zxing-wasm@3.1.6`, reader build only, on every browser.**
- **Why this library:** it is a maintained WebAssembly build of ZXing-C++ (3.1.6 published 2026-10-19). It reads from `ImageData`, so it works the same on iPhone Safari, which has no `BarcodeDetector`, and on Android Chrome. Its `ReaderOptions` expose `formats` and `eanAddOnSymbol`.
- **The API we use** (verified against the package's own `README.md` and `dist/es/reader/index.d.ts` at 3.1.6):
  - `import { prepareZXingModule, readBarcodes } from "zxing-wasm/reader"`;
  - `readBarcodes(imageData, { formats: ["EANUPC"], eanAddOnSymbol: "Ignore", maxNumberOfSymbols: 1, tryHarder: true })` returns `ReadResult[]`, each with `isValid`, `format` and `text`;
  - **why `EANUPC`:** in 3.x, `ISBN` is a separate read-only format in the `EANUPC` symbology, next to `EAN13`, so a 978/979 barcode may come back as `ISBN`. `formats: ["EAN13"]` could miss real books. `EANUPC` covers EAN-13, ISBN, UPC-A/E and EAN-8. Every result's `text` then goes through `isbnFromBarcode` (Task 3). That keeps only ISBNs, and it also lets a UPC on a mass-market paperback be recognised and trigger the `not an ISBN` nudge (D4). Task 7 checks the reported `format` against a writer-generated 978 image before anything relies on it;
  - `prepareZXingModule({ overrides: { locateFile }, fireImmediately: true })` returns a promise for the instantiated module.
  - `eanAddOnSymbol` defaults to `"Ignore"`; we still set it explicitly and pin it in a test.
- **The `.wasm` is self-hosted.** The package's default `locateFile` fetches the `.wasm` from jsDelivr. Instead, `src/lib/scan/decoder.ts` does `import wasmUrl from "zxing-wasm/reader/zxing_reader.wasm?url"`; the package exports that subpath. Its `locateFile` returns `wasmUrl` for paths ending `.wasm`, and `prefix + path` otherwise. Vite emits the `.wasm` as a hashed asset under GitHub Pages' own origin, so there is no third-party request and the browser cache keeps it.
- **Bundle cost, measured from the 3.1.6 tarball:**
  - reader JS: 41.7 KB raw, 12.3 KB gzipped;
  - `zxing_reader.wasm`: 947 KB raw, 411 KB gzipped.
  - The entry chunk pays nothing for any of it.
- **How it's lazy-loaded:** `ScanPage` is a `React.lazy` route chunk. `decoder.ts` is reached only through `import("./decoder")` from `loadDecoder()`, which runs when the camera starts. Task 9 adds `scripts/check-bundle.mjs`, which fails the build check if the entry chunk mentions `zxing` or if no `zxing_reader-*.wasm` asset exists.
- **Rejected:**
  - Native `BarcodeDetector` first: Android only, it has no add-on control, and it would mean a second code path to test.
  - The `barcode-detector@3.2.3` ponyfill: it wraps this same WASM but hides `eanAddOnSymbol`.
  - `@zxing/browser`: in maintenance mode, and its JS port is slower.
  - `html5-qrcode`: unmaintained.
  - Quagga2: weaker on angled and partly lit barcodes, and it is a second decoder style to learn.

**D2. Schema: one ToS migration, `library-scan-intake` (filename from `supabase migration new`).** Scans reuse `library.intake_items` (spec §6.4). The summary below is binding; Task 1 has the rules.

| Change | Shape | Why |
|---|---|---|
| Source marker | `intake_items.source text not null default 'photo' check (source in ('photo','scan'))` | Existing rows and old clients stay `photo` |
| Scanned ISBN | `intake_items.scanned_isbn text`, checked by `library.isbn13_is_valid(scanned_isbn)` (978 or any 979, including 9790; length 13; checksum), the same rule as `normalizeIsbn13` (D13) | The ISBN is the identity of a scan; a photo taken for a not-found scan carries it too |
| Relaxed constraints | `source_hash` drops `not null` (its regex check stays). `intake_items_cover_required` becomes `cover_path is not null or status in ('confirmed','discarded') or source = 'scan'`. A new `intake_items_source_shape` requires: **photo**, `source_hash is not null`; **scan**, `source_hash is null and scanned_isbn is not null and cover_path is null and title_page_path is null and status in ('ready','confirmed','discarded')` | Relaxed for scan rows only. A scan can never be `pending`, `processing` or `failed`, so it can never be claimed |
| Scan rows start `ready` | New RPC `library.create_scan_item(...)`; clients get no insert grant on `source` or `status` | The insert policy keeps `status = 'pending'` and gains `and source = 'photo'`, so a direct insert can only make a photo row |
| Never claimable | `claim_intake_item` returns `done` for `source = 'scan'` right **after** its existing not-found/not-member `42501` check, so ids still can't be probed, and before any status check or counter (belt and braces with the shape constraint) | A scan never bills and never touches `intake_usage` |
| Deliberate second copy | `intake_items.extra_copy boolean not null default false`, set only through `create_scan_item` | D9: a same-owner second copy must not default to `Already recorded` |
| Edition per item | `intake_items.edition_label text`, which must be null or trimmed, non-empty and at most 120 characters; it gets the insert grant (photo rows) and the update grant | Spec §6.3 session edition, stored at creation and changeable per card |
| Discard reason | `discard_reason` also allows `'replaced_by_photo'`: drop `intake_items_discard_reason_check` and re-add it under the same name | The not-found scan row is closed once its photo item exists (D8) |
| Copy origin | `copies` origin check becomes `('libib','photo','manual','scan')`: drop `copies_origin_check` and re-add it under the same name. Both auto-generated names (`copies_origin_check`, `intake_items_discard_reason_check`) were checked on 2026-11-10 by recreating those column checks in a scratch Postgres 16. Task 1 Step 3 re-checks them in the local database before writing the drops | Spec §6.2 |
| Copy note | `copies.copy_note text`, with `copy_note is null or char_length(copy_note) <= 2000` | Spec §6.3; `copies` already has table-wide grants, so no grant change |
| `confirm_intake_item` | **Same arguments** `(p_item uuid, p_book_id uuid, p_book jsonb, p_copy jsonb)`; new `p_copy` contract below | See below |
| Cleanup | `library.move_claude_edition_notes(p_before timestamptz) returns int`. It is **security invoker**: it has no caller to check membership for, and is executable by no client role. The migration calls it as the owner with `now()`, **only on the run that adds `copy_note`** (D3) | Spec §6.4; a function so pgTAP can test it on seeded data |

**The new `confirm_intake_item` contract.**
- `edition_note`: if the `edition_note` key is present in `p_copy`, its value (null clears it); if absent, the item's `edition_label`.
- `copy_note`: from `p_copy ->> 'copy_note'`.
- `origin`: `'scan'` when the item's `source = 'scan'`, else `'photo'`.
- `photo_path`: the item's `cover_path`, which is null for scans.
- Everything else (idempotency, locking, `42501`, `not_confirmable`, `22023`) is unchanged.

**Why the arguments stay the same:** the brief asks for "the new signature". This plan meets that with a new `p_copy` contract instead of new arguments. The production `db push` lands before the new app deploys. With unchanged arguments, the live Plan 3 app keeps working across that gap (it always sends `edition_note`, and never `copy_note`), with no `drop function`, no grant churn and no PostgREST overload ambiguity.

**`create_scan_item`:**
- Signature: `(p_item uuid, p_household uuid, p_batch uuid, p_owner uuid, p_isbn text, p_edition text, p_extra_copy boolean) returns text`, returning `'created'` or `'exists'`.
- It is security definer with `search_path = ''`. It raises `42501` unless `is_member(p_household)`.
- `p_owner` must be null or a member of `p_household`, else it raises `22023`.
- It inserts `status 'ready'`, `source 'scan'`, `uploaded_by auth.uid()`, `edition_label nullif(btrim(p_edition), '')`, using `on conflict (id) do nothing`:
  - if the existing row is a scan in that household, it returns `'exists'` (a resend after a lost response is idempotent, D6);
  - otherwise it raises `42501`, so ids can't be probed.
- An invalid ISBN fails the check with `23514`.

**The Edge Function doesn't change.** It only ever acts on an item `claim_intake_item` hands it. For a scan, the claim returns `done` and the function returns `{ outcome: "done" }` with no vision call. Client-side, `isDue` only selects `pending` and expired `processing` rows, and scans are neither.

**Grants after the migration:**
- **`select`:** the existing column list, plus `source`, `scanned_isbn`, `edition_label`, `extra_copy`. Still no `claim_token`.
- **`insert`:** the existing columns, plus `scanned_isbn` and `edition_label`.
- **`update`:** `lookup`, `owner_user_id` and `edition_label`.
- **Functions:**
  - `create_scan_item`: revoke from `public` and `anon`, grant to `authenticated`.
  - `isbn13_is_valid`: immutable `sql` with `set search_path = ''`. Revoke from `public` and `anon`; grant to `authenticated`, because a check constraint runs with the inserting role's privileges.
  - `move_claude_edition_notes`: security invoker. Revoke from `public`, `anon` and `authenticated`.

**D3. The cleanup's exact match rule.**
- **What matches:** a copy is moved only if all of these hold:
  - `c.origin = 'photo'`;
  - `c.intake_item_id = i.id`;
  - `jsonb_typeof(i.extraction -> 'editionClues') = 'array'`;
  - `c.edition_note is not null`;
  - `c.edition_note = regexp_replace(array_to_string(<clues in array order, via jsonb_array_elements_text ... with ordinality>, '; '), '^\s+|\s+$', '', 'g')`.
- **Why this rule:** it is exactly what Plan 3 wrote. The card sent `(editionNote ?? clues.join("; ")) || null`, bulk sent `clues.join("; ") || null`, and both went through `normalizeCopyInput`, which applies JS `trim()` and turns blank into null.
- **What a move does:** it sets `copy_note = edition_note` and `edition_note = null` (`copy_note` is new, so always null beforehand).
- **What is left alone:**
  - a note someone edited before or after confirming;
  - libib and manual copies;
  - photo copies whose item had no clues.
- **Where the rule can be wrong:** JS `trim()` strips some Unicode spaces that `\s` doesn't. A clue that starts or ends with one of those doesn't match, and its copy is left alone. That is the safe direction.
- **Only copies created before `p_before`** (`c.created_at < p_before`) are considered. A copy confirmed later, by the new app, with a picked label that happens to equal a single Claude clue is never moved.
- **It runs once.** The migration's first statement records whether `library.copies.copy_note` already exists. It does this in a `do` block that sets a transaction-local setting with `set_config('library.scan_intake_cleanup', ..., true)`. The last statement calls `move_claude_edition_notes(now())` only when the column was absent. So the first application (the production `db push`) cleans up with the push time as its cutoff, and a manual re-run of the idempotent migration never moves anything. The function is also idempotent on its own: moved rows have `edition_note` null.
- **Rollout gap:** a photo confirmed by the old app between `db push` and the Pages deploy keeps its Claude text. The rollout merges the library PR immediately after the push, and says not to confirm photos in between.

**D4. Repeated reads, and the "take a photo" nudge.**

| Constant | Value | Why |
|---|---|---|
| `REPEAT_WINDOW_MS` | 3000, **sliding**: every read of an ISBN, even an ignored one, refreshes its last-seen time | A barcode held in view for any length of time gives exactly one row. It fires again only after being out of view for 3 s, which is shorter than putting a book down and picking up its twin |
| `DECODE_GAP_MS` | 120 ms between the end of one decode and the start of the next; decodes never overlap | About 6–8 decodes a second on a mid-range phone, and it leaves the CPU idle between frames for a 100-book session |
| `NUDGE_AFTER_MS` | 8000 since the later of: camera start, the last accepted read, or the last nudge dismissal | Lining up a barcode takes 1–3 s. Eight seconds without success means it won't read, and that is the spec's "few seconds" approximation of "sees a book" |
| Non-ISBN EAN read | Shows `That barcode isn't an ISBN.` and the nudge **at once** | A 0-prefixed UPC on a mass-market paperback or a gift-shop sticker never becomes a row |
| `IDLE_PAUSE_MS` | 120000 with no accepted read and no touch: the camera stops and shows `Camera paused to save battery.` with `Resume camera` | A phone left on a shelf mid-session doesn't run the camera and the wake lock until the battery dies |

A scan of an ISBN **already in this session's list**, once outside the window, pauses decoding and asks `You already scanned this book in this session. Add another copy?` (`Add another copy` / `No`). A typed ISBN skips the window but still asks.

**D5. Scan feedback.** `createFeedback()` makes no `AudioContext` until `unlock()`, which runs synchronously in the `Start scanning` tap handler:
- it creates `new (AudioContext ?? webkitAudioContext)()`;
- it calls `resume()`;
- it plays a zero-gain 10 ms buffer, which is what unlocks audio on iOS.

The cues:
- **New row:** one sine beep, 1760 Hz, 90 ms, gain 0.2. `navigator.vibrate?.(50)`.
- **Repeat prompt, already owned, or open in another batch:** two 880 Hz beeps of 70 ms, 60 ms apart. `navigator.vibrate?.([40, 60, 40])`.
- **Visual flash:** a 250 ms green border on accepted reads and amber on notices. This is the one cue that always works: iOS Safari has no `vibrate`, and the ring/silent switch mutes Web Audio.

If the context isn't `running` (iOS suspends it when the tab is hidden), `resume()` is attempted on the next touch and the sound is skipped silently. A sound toggle is remembered in `tpl_scan_sound` (default on). Feedback never throws.

**D6. Saving scans offline, and lookups that stall.**
- **The outbox:** a scan's id comes from `crypto.randomUUID()`. The scan is appended to the outbox `tpl_scan_outbox_<householdId>` (the `create_scan_item` arguments plus `createdAt`) **before** any network call, and its row shows at once.
- **Flushing:** the outbox is flushed one entry at a time. A failure retries after 2 s, 8 s, then every 30 s, and again on the window's `online` event. An entry is removed only on `'created'` or `'exists'`.
- **Errors that won't fix themselves are rejected, never retried.** The entry is marked `failed: "rejected"` and its row reads `Couldn't save this scan.` This covers:
  - Postgres codes `42501` (for example, the person left the household), `22023` (owner), `23514` (check) and `22P02` (malformed input);
  - any other PostgREST 4xx, except `408` and `429`, which are transient.

  Network errors, 5xx, `408` and `429` are retried. `createScanItem` therefore rejects with an error that carries both `code` and the HTTP `status` (Task 2).
- **One flush at a time per household.** A module-level `Map<householdId, Promise<void>>` holds the running flush. A call while one runs sets a "run again" flag and returns the same promise. The running flush re-reads the outbox after each entry and loops until no unsent entry is left, so an entry appended mid-flush is sent by that same flush. Entries are removed **by id from a fresh `readOutbox`** (`removeOutboxEntry`), never by writing back an array read earlier. A scan appended during a flush therefore can't be lost.
- **Other tabs:** they have their own module state, so two tabs can send the same entry. That is harmless: `create_scan_item` is idempotent on the id and answers `exists` to the second sender, which then removes the entry by id.
- **Where it flushes:** while the scanner is open (after each read), and on mount of `useIntake` (the inbox and scanner both use it), so scans left after an offline `Done` upload the next time either page opens.
- **Lookups:**
  - they run one at a time, oldest first;
  - an item is due when `needsLookup(item)` holds (D7);
  - a retryable `LookupError` (429, 5xx, network) pauses lookups, shows `Online lookup paused. It will retry.`, and resumes automatically after 60 s, on `online`, or on `Retry`;
  - a non-retryable error marks only that item, as in Plan 3.
- **Scans never wait on a lookup.**

**D7. ISBN lookup.** `lookupIsbn(isbn13, opts)` in `photo/lookup.ts`:
1. **OpenLibrary:** `GET https://openlibrary.org/search.json?isbn=<isbn13>&limit=1&fields=key,title,author_name,isbn,cover_i,number_of_pages_median,first_publish_year,editions,editions.cover_i`. This was verified on 2026-11-10: the response's `editions.docs[0]` is the edition matching that ISBN.
   - The cover is that edition's `cover_i` when it is > 0, else the work's. The edition cover is the scanned printing's, which avoids the wrong-language work cover the roadmap mentions.
   - Synopsis and the work id come from the same work-record fetch Plan 3 uses (`fromOpenLibraryDoc`, refactored to take an optional cover id).
2. **Google Books:** if OpenLibrary has no doc and a key exists, call `searchGoogleBooksIsbn` (`q=isbn:<isbn13>`) and take the first hit whose `isbns` include `isbn13`.
3. **Neither:** `{ source: "none", agrees: false }`.

Every result found carries `byIsbn: true`, and its `matchIsbns` always include `isbn13`. Errors follow Plan 3 (P3-D8). `LookupResult` gains an optional `byIsbn?: boolean`; an old row without it reads as false.

`lookupForItem(item, opts)` chooses the lookup:
- a scan uses `lookupIsbn(scannedIsbn)`;
- a photo with `scannedIsbn` tries `lookupIsbn` first and, if that finds nothing and Claude read a title, falls back to `lookupMetadata` by title. **The ISBN wins** (§6.4);
- any other photo uses `lookupMetadata`, as before.

`needsLookup(item)`: `ready`, `lookup === null`, and either a scanned ISBN or a non-blank extraction title.

**D8. A not-found scan, then a photo.** The not-found row offers `Take a photo`. The photo becomes a normal photo item in the same batch:
- it carries `scanned_isbn` (the insert grant), plus the session edition and owner;
- it goes upload → claim → Claude → `lookupForItem` → proposal.

Once `createIntakeItem` returns `created`, the client calls `discard_intake_item(scanItemId, 'replaced_by_photo')`. Until that discard lands, both items are open twins (D9), so neither can be bulk-confirmed.

The session list hides items with `discardReason === "replaced_by_photo"`, so the photo's row stands in place of the scan's. This also holds after a reload, because `discard_reason` is now read (Task 2).

**Healing on session load.** A tab killed between the photo's create and the discard leaves both items open. On every session load, the scanner runs `scansToHeal(batchItems)` (pure, Task 7) and discards what it returns with `replaced_by_photo`. The rule, per scanned ISBN within the batch:
- photos = the photo items with that `scannedIsbn` that aren't discarded;
- already replaced = the scans of that ISBN already discarded as `replaced_by_photo`;
- to heal = photos − already replaced;
- it discards that many of the **open** scans of the ISBN whose lookup is `none` (not found), newest first.

This counting rule keeps a deliberate second copy (`extraCopy`) of the same ISBN that never got a photo.

**D9. Matching, confidence and bulk (`propose.ts`, pure).**
- **Query title:**
  - the typed override;
  - else the extraction title;
  - else the lookup's title, when `lookup.agrees && lookup.byIsbn`.
- **Query authors:**
  - the override;
  - else the extraction authors when there are any;
  - else the authors of a `byIsbn` lookup.
- **Query ISBNs:**
  - `scannedIsbn` first;
  - then a checksum-valid extraction ISBN;
  - then an exact-title agreeing lookup's `matchIsbns`.
- **`isbnConflict`:** the item has a `scannedIsbn` and a non-blank extraction title, a title the ISBN resolved to exists, and `agrees({extraction title, authors}, resolved)` is false. The resolved title is the `byIsbn` lookup's, else that of the catalog book matched by `isbn`. The card says `The photo and the barcode don't match. Check which book this is.`
- **`itemConfidence`:**
  - a scan is `"high"` when `lookup?.agrees`, else `"low"`;
  - a photo is its extraction's confidence, capped at `"medium"` when `isbnConflict`.
- **`bulkEligible`:** `ready`, a scan or `isBook`, `itemConfidence === "high"`, a title, no candidates, no twins, and no conflict. So a found scan with nothing like it in the catalog or the batch is bulk-eligible, and a not-found scan never is.
- **Twins:** as before, plus **ISBN twins**: any two open items sharing a normalized ISBN (scanned or extraction), in any batch. Same-batch twins where either one is `extraCopy` say `You scanned this book more than once in this session.` instead of the photo wording.
- **Defaults:** as P3-D7. One addition: an `extraCopy` item whose top candidate is `isbn` defaults to `add_copy`, never `already_recorded`. The person already said this is another copy.

**D10. Sessions and reload.**
- **A session is a `batch_id`** (§6.4). `tpl_scan_session` stores `{ householdId, batchId, edition, ownerUserId, startedAt }`.
- **Reopening `#/scan`:** if a stored session exists for this household, it is resumed. The list is that batch's items, any status, newest first, merged by id with that batch's outbox entries; the edition and owner come back from storage. The header shows `Started {time}` and `New session`.
- **`Done`:** stops the camera, clears `tpl_scan_session`, and opens `#/inbox`. Outbox entries stay until they're saved (D6). If any remain, the inbox shows `{n} scans are saved on this phone and will upload when you're online.`
- **The photo batch's edition picker** (`UploadPanel`) lives in component state and resets to none on reload. Each uploaded item has already stored its own label (§6.3).

**D11. Camera lifecycle (`src/lib/scan/camera.ts`).**
- **Request:** `getUserMedia({ audio: false, video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } } })`. An `OverconstrainedError` retries once with `{ video: true }`.
- **The video element:** `playsInline`, `muted`, `autoplay`, as iOS requires.
- **Errors map to `CameraError.code`:**

  | Error | Code | Screen text |
  |---|---|---|
  | `NotAllowedError` / `SecurityError` | `denied` | `Camera access is off. You can type an ISBN or take photos instead.` (iOS: Settings → Safari → Camera) |
  | `NotFoundError` | `no_camera` | `No camera found.` |
  | `NotReadableError` | `busy` | `The camera is in use by another app.` |
  | No `navigator.mediaDevices` | `unsupported` | `This browser can't use the camera here.` |

  All four keep `Type ISBN` and `Take a photo` (the file input works without camera permission).
- **Decoding** reads a center guide band, 90% of the frame's width and 35% of its height, at native resolution. One reused canvas uses `getContext("2d", { willReadFrequently: true })`, and no frame is kept after it's decoded.
- **The camera stops (all tracks stopped, loop aborted, wake lock released) on:**
  - `visibilitychange` to hidden;
  - `Take a photo` (before the file picker opens: iOS can't share the camera with the capture sheet);
  - an open prompt;
  - the idle pause (D4);
  - `Done`;
  - unmount.
- **The camera restarts** on becoming visible again, or when the photo input's `change` or `cancel` event fires, if the session is still running. If that restart fails, `Resume camera` is shown.
- **Torch:** shown only when `track.getCapabilities?.().torch === true` (Android Chrome; iOS Safari doesn't expose it). It toggles with `applyConstraints({ advanced: [{ torch: on }] })`. Stopping the track turns it off.
- **Wake lock:** `holdWakeLock()` while the camera runs.

**D12. Edition picker.**
- **The label list:** `editionLabels(catalog, openLabels)` is pure. It takes every copy's `editionNote` plus the open items' `editionLabel`:
  - trim them, and drop blanks and anything over 120 characters (long libib notes are notes, not labels);
  - group case-insensitively, keeping the spelling used most often (a tie goes to the first by `localeCompare`);
  - sort by `localeCompare(undefined, { sensitivity: "base" })`.
- **Where the values come from:**
  - inbox and scanner: the `catalog` and `items` that `useIntake` already loads;
  - book detail: `useCatalog().books` plus a new light query, `listOpenEditionLabels(householdId)` (`select edition_label` of open items, not null).
- **`EditionPicker`:**
  - a button showing `Edition: {label}` or `Edition: none`;
  - it opens a sheet with a filter field, `None`, the labels, and `Add "{typed}"` when the trimmed text matches no label case-insensitively;
  - typing an existing label in another case picks the existing spelling.
- **Labels are capped at `MAX_LABEL` (120 characters), matching the database check.**
  - `canonicalLabel` returns null for longer text.
  - The picker's filter field has `maxLength={120}`. It shows `Add "{typed}"` only for 1–120 trimmed characters; past that it shows `Labels are at most 120 characters.`
  - So no label the database would reject with `23514` can reach an item or the outbox.
- **No labels table, and no rename or delete** (§6.4).
- **Claude's clues are only a hint:** `Claude saw: {clues.join(", ")}` on photo cards. Nothing prefills the edition from them any more, in `IntakeCard`, `InboxPage` or `runBulkConfirm`.
- **Filtering and search:** the library gets an `Edition` filter (`All editions`, then the labels), which matches a copy's `editionNote` case-insensitively and in full. Search also matches copies' `editionNote`.
- **Bulk edits (a departure: the spec says bulk confirm "keeps" set-edition-for-selected, but the current `BulkConfirmSheet` has no such control):**
  - each entry in the sheet gets a checkbox, all checked by default;
  - `Set edition for selected` writes `edition_label` on the checked items;
  - the add button reads `Add {n} books` and adds only the checked ones.

**D13. One ISBN-13 rule everywhere: 978, or any 979 prefix (including 9790), plus a valid checksum.** That is what `normalizeIsbn13` already accepts, and spec §7 says "978/979". So:
- `isbn13_is_valid` (SQL) accepts it;
- `isbnFromBarcode` accepts it (after cutting an add-on);
- `isbnFromTyped` accepts it (or an ISBN-10 converted to 978).

9790 is the ISMN range for printed music. It is accepted rather than special-cased: a household scanning sheet music gets a not-found row and a photo prompt, which is harmless. Changing `normalizeIsbn13` would also change libib import matching. Task 1 and Task 3 pin `9790000000001` as accepted by all four.

## Cost

Scanning makes no Claude call and uses none of the 500-a-day vision cap. A scan costs one OpenLibrary search plus one work record (two free requests), and a Google Books request only on an OpenLibrary miss. A 100-book shelf is about 200 OpenLibrary requests, made one at a time over the session. Photos taken from the scanner cost what Plan 3's cost.

## Review Focus

Each has a test in the named task.

1. **The phone stays on one barcode for 10 s, or two books with the same ISBN are scanned a second apart.** One row only for the first. The second copy is reachable through `Add another copy` on the row, or by rescanning after 3 s. *(Task 7: read-gate tests with a fake clock. Task 9: the e2e "hold" test.)*
2. **The network drops mid-shelf, then the tab is killed.** Every scan is still listed after reload and uploads exactly once when the network is back. *(Task 7: outbox tests. Task 1 pgTAP: `create_scan_item` returns `exists` on a resend. Task 9: e2e offline then reload.)*
3. **A mass-market paperback's UPC, or a lone price add-on, is in view.** No row; `That barcode isn't an ISBN.` and the nudge show at once. *(Task 3: parser. Task 7: gate. Task 9: real phone.)*
4. **The photo taken for a not-found ISBN is of a different book.** The card warns, and the item is never bulk-eligible. *(Task 4: `isbnConflict`.)*
5. **The same book scanned twice on purpose for one owner.** After the first is confirmed, the second defaults to `Add a copy`, never `Already recorded`, and bulk adds neither. *(Task 4: `extraCopy` defaults and twins. Task 1: the `extra_copy` column.)*

---

### Task 1: ToS — scan intake schema, editions, copy notes and the cleanup

**Files (new ToS worktree):**
- Create: `supabase/migrations/<timestamp>_library-scan-intake.sql`, named by `migration new`
- Create: `supabase/tests/database/library_scan_intake.test.sql`

Set up the worktree. Fetching doesn't edit the main checkout:
```
git -C C:/Users/tierr/Github/tome-of-secrets fetch origin
git -C C:/Users/tierr/Github/tome-of-secrets worktree add C:/Users/tierr/Github/tome-of-secrets-scan-intake -b library-scan-intake origin/main
```
Below, `<tos-wt>` is that path. Load the `supabase:supabase` and `supabase:supabase-postgres-best-practices` skills first. Stop any local stack running from another ToS worktree (`npx supabase@2.122.1 stop --workdir <that wt>`) before `start`. Create the file with `npx supabase@2.122.1 migration new library-scan-intake --workdir <tos-wt>`.

**Interfaces — Produces** (D2 is the binding summary):

```sql
library.isbn13_is_valid(p text) returns boolean            -- immutable sql, set search_path = ''; '^97[89][0-9]{10}$' and EAN checksum (D13)
alter table library.intake_items
  add column if not exists source        text not null default 'photo',   -- + check (source in ('photo','scan'))
  add column if not exists scanned_isbn  text,                            -- + check (scanned_isbn is null or library.isbn13_is_valid(scanned_isbn))
  add column if not exists edition_label text,                            -- + check (null or (= btrim, <> '', <= 120 chars))
  add column if not exists extra_copy    boolean not null default false;
-- source_hash drop not null; replace intake_items_cover_required; add intake_items_source_shape;
-- intake_items_discard_reason_check (drop + re-add, same name) gains 'replaced_by_photo'
alter table library.copies add column if not exists copy_note text;      -- + check (null or <= 2000 chars)
-- copies_origin_check (drop + re-add, same name): ('libib','photo','manual','scan')
library.create_scan_item(p_item uuid, p_household uuid, p_batch uuid, p_owner uuid,
                         p_isbn text, p_edition text, p_extra_copy boolean) returns text   -- 'created' | 'exists'
library.claim_intake_item(uuid)            -- + scan → 'done', right after the existing 42501 not-found/not-member check
library.confirm_intake_item(uuid, uuid, jsonb, jsonb)   -- same args; p_copy contract in D2
library.move_claude_edition_notes(p_before timestamptz) returns int   -- security invoker; D3; guarded single call at the end
```

Rules:
- Idempotent like the earlier library migrations: `add column if not exists`, `drop constraint if exists` before each `add constraint`, `create or replace function`, `drop policy if exists`.
- Re-issue the insert policy with `and source = 'photo'`. Re-grant the column lists in D2: revoke the old column grants first, then grant the new lists.
- **Every definer function** checks membership itself and uses `set search_path = ''`. `move_claude_edition_notes` is the one exception to the membership rule: it is security **invoker**, with `set search_path = ''` and no client grant, because it acts on every household and only the migration owner (or `postgres` in tests) runs it.
- The migration **starts** by recording whether `library.copies.copy_note` exists (a `do` block, `set_config('library.scan_intake_cleanup', 'run' | 'skip', true)`). It **ends** with a `do` block that calls `library.move_claude_edition_notes(now())` only when the setting is `run` (D3).

- [ ] **Step 1: Write the failing pgTAP test** in the setup style of `library_photo_intake.test.sql`: users A (in a household) and B (not), `test_vals`, `pg_temp` helpers, and synthetic ISBNs only. One assertion each:
  - **Schema:** `isbn13_is_valid('9780000000002')`, `('9791000000008')` and `('9790000000001')` (D13) are true. `('9780000000003')` (checksum), `('978000000000')` (12 digits) and `('9770000000000')` are false. `has_column` for the four new item columns and `copies.copy_note`.
  - **Create:**
    - A's `create_scan_item(item 1, hh, batch, A, '9780000000002', ' Invented Box ', false)` returns `created`. The row is `ready`, `scan`, has a null `source_hash` and `cover_path`, `edition_label = 'Invented Box'`, and `uploaded_by = A`.
    - The same call again returns `exists`, and the item count is unchanged.
    - `p_isbn '9780000000003'` throws `23514`.
    - An owner who isn't a member throws `22023`.
    - A blank `p_edition` stores null.
    - A 121-character edition throws `23514`.
    - Reusing a photo item's id throws `42501`.
  - **Never claimable or billed (spec brief):**
    - `claim_intake_item` on a scan returns `done`, `intake_usage` for today stays 0, and the row is still `ready` with attempts 0.
    - B's `claim_intake_item` on A's scan throws `42501`, the same as for a random id (the scan check doesn't reveal that the id exists).
    - As `postgres`, `update ... set status = 'pending'` on a scan throws `23514`; so does setting `cover_path` or `source_hash` on it.
    - `retry_intake_item` on a scan returns false.
    - As A, a direct `insert` naming `source` or `status` throws `42501`.
    - A direct photo insert without `source_hash` throws `23514`.
  - **Photo with a scanned ISBN:** A inserts a photo item with `scanned_isbn` and `edition_label` (`lives_ok`). `update ... set edition_label` as A changes one row.
  - **Discard:** `discard_intake_item(scan, 'replaced_by_photo')` returns true, and the reason is stored.
  - **Confirm:**
    - A scan item confirmed as a new book with `p_copy` `{"edition_note":"Invented Box","copy_note":"Sprayed edges"}` makes a copy with `origin 'scan'`, a null `photo_path`, that edition and note, and its `intake_item_id`. A second call returns the same ids.
    - A scan confirmed with `p_copy '{}'` takes the item's `edition_label`. With `{"edition_note":null}` the edition is null.
    - A photo item still gets `origin 'photo'` and its cover as `photo_path`.
    - The Plan 3 tests' `'{}'` and `edition_note` payloads behave as before.
  - **Cleanup (`move_claude_edition_notes(p_before)`, called as `postgres` on seeded rows; the seeded copies get `created_at = now() - interval '1 day'` unless stated):** seed confirmed photo items with an `extraction`, plus their copies, and call it with `p_before = now()`. Then:
    - A matching copy (clues `["Invented Box"]`, note `Invented Box`) with `created_at = now() + interval '1 minute'`, standing for a new-app copy whose picked label equals a single clue, is untouched.
    - Clues `["Invented foil","Signed"]` with note `Invented foil; Signed`: **moved**, so `copy_note` holds that text and `edition_note` is null.
    - Clues `[" Invented foil "]` with note `Invented foil`: moved (Plan 3 trimmed it).
    - Note `Invented foil; Signed!` (edited): untouched.
    - Note `Signed; Invented foil` (different order): untouched.
    - A `libib` copy and a `manual` copy with the same text: untouched.
    - A photo copy with empty clues and a null note: untouched.
    - A photo copy with no `intake_item_id`: untouched.
    - The function returns 2. A second call returns 0 and changes nothing.
    - `authenticated` and `anon` executing it both throw `42501`.
    - `select prosecdef from pg_proc` for it is false (invoker), and both new functions have `search_path=""` in `proconfig`.
  - **RLS unchanged for non-members:**
    - B: `select` on A's scan item `is_empty`.
    - B: `create_scan_item` into A's household throws `42501`.
    - B: `update ... set edition_label` on A's item changes 0 rows.
    - B: selecting A's copies (and so `copy_note`) `is_empty`.
    - anon: `select` on `intake_items` and `execute create_scan_item` are both permission denied.
    - A (member): `select claim_token` still throws `42501`.
- [ ] **Step 2: Run it to verify it fails.** `npx supabase@2.122.1 start --workdir <tos-wt>`, then `npx supabase@2.122.1 test db --workdir <tos-wt>`. Expected: FAIL, `library.isbn13_is_valid` does not exist.
- [ ] **Step 3: Write the migration** per D2, D3 and the Rules. Before writing the two `drop constraint` lines, confirm the names on the local database: `select conrelid::regclass, conname from pg_constraint where conname in ('copies_origin_check', 'intake_items_discard_reason_check');` (through `npx supabase@2.122.1 db query --help`-confirmed syntax, or `psql` against the local stack). Expected: both rows. If a name differs, use the real one and note it in the PR body.
- [ ] **Step 4: Verify.**
  - `npx supabase@2.122.1 db reset --workdir <tos-wt>`, then `test db`. Expected: all four library test files pass, with Plan 3's `library_photo_intake.test.sql` unchanged.
  - `npx supabase@2.122.1 db advisors --local --workdir <tos-wt>`. Expected: no new findings for `library`; check `npx supabase@2.122.1 db advisors --help` for the flags first.
  - `cd <tos-wt>/tests && npm ci && npm test`. Expected: Jest green.
- [ ] **Step 5: Review, commit, PR.**
  - Subagent review of the migration diff for definer functions without `is_member`, grant gaps, a scan path into `pending`, and cleanup false positives.
  - Commit `feat(library): scan intake items, edition labels and copy notes`.
  - Push `library-scan-intake` and open a PR against ToS `main`. **Leave it unmerged and don't push the database.** The PR body states:
    - the `confirm_intake_item` contract and that the live app stays compatible;
    - that the Edge Function is unchanged;
    - that production needs the user-approved `db push`.

### Task 2: Library — types and repo for scans, editions and copy notes

**Files:**
- Modify: `src/lib/photo/types.ts`, `src/lib/photo/intake-repo.ts`, `src/lib/types.ts`, `src/lib/normalize.ts`
- Modify: every `CopyInput` literal `tsc` flags (`AddBook.tsx`, `BookDetail.tsx`, `CopyForm.tsx`, `CopyList.tsx`, `libib/*`, `photo/confirm.ts`, `IntakeCard.tsx`)
- Test: `src/lib/photo/intake-repo.test.ts`, `src/lib/types` mapping cases in `library-repo.test.ts`, `src/lib/normalize.test.ts`

**Interfaces — Produces:**

```ts
// lib/types.ts
type CopyOrigin = "libib" | "photo" | "manual" | "scan";
interface Copy { /* + */ copyNote: string | null }          // toCopy maps copy_note
interface CopyInput { ownerUserId; editionNote; copyNote: string | null; location }
// COPY_COLUMNS + copyNote: "copy_note"; normalizeCopyInput trims copyNote, blank → null

// photo/types.ts
type IntakeSource = "photo" | "scan";
type DiscardReason = "discarded" | "already_recorded" | "replaced_by_photo";
interface IntakeItem { /* + */ source: IntakeSource; scannedIsbn: string | null; editionLabel: string | null;
  extraCopy: boolean; sourceHash: string | null; discardReason: DiscardReason | null }
interface LookupResult { /* + */ byIsbn?: boolean }
// toIntakeItem: source ?? "photo", extra_copy ?? false

// photo/intake-repo.ts
// ITEM_COLUMNS + "source, scanned_isbn, edition_label, extra_copy, discard_reason" (still no claim_token)
createIntakeItem(row: { ...as before; scannedIsbn?: string | null; editionLabel?: string | null }):
  Promise<"created" | "duplicate">          // sends scanned_isbn / edition_label only when given
interface ScanItemArgs { id: string; householdId: string; batchId: string; ownerUserId: string | null;
  isbn: string; editionLabel: string | null; extraCopy: boolean }
class ScanSaveError extends Error { code: string | null; status: number | null }   // status null = network failure
createScanItem(args: ScanItemArgs): Promise<"created" | "exists">
// rpc create_scan_item; rejects with ScanSaveError carrying the PostgREST error code and the response status (D6)
setItemEdition(itemId: string, label: string | null): Promise<void> // trims; blank → null
discardItem(itemId, reason: "discarded" | "already_recorded" | "replaced_by_photo"): Promise<boolean>
listOpenEditionLabels(householdId: string): Promise<string[]>       // paged; status in open; edition_label not null
// confirmItem unchanged in shape; p_copy now carries copy_note via fromCopyPatch
```

- [ ] **Step 1: Write the failing tests:**
  - `toIntakeItem` maps the five new columns. A row without them (an old fixture) gives `source "photo"`, `extraCopy false`, and null `scannedIsbn`, `editionLabel` and `discardReason`.
  - `listIntakeItems`'s select string contains `scanned_isbn`, `edition_label` and `discard_reason`, but not `claim_token`.
  - `createScanItem` calls `rpc("create_scan_item", { p_item, p_household, p_batch, p_owner, p_isbn, p_edition, p_extra_copy })` and resolves `"exists"` when the RPC returns `exists`.
  - An RPC error `{ code: "23514" }` with status 400 rejects with a `ScanSaveError` carrying code `"23514"` and status 400; a thrown fetch failure gives code null and status null.
  - `createIntakeItem` without the new fields sends exactly Plan 3's seven columns; with them it sends nine.
  - `setItemEdition("i", "  ")` updates `{ edition_label: null }`.
  - `confirmItem` with `copy: { ..., copyNote: " Signed " }` sends `p_copy.copy_note = "Signed"`.
  - `toCopy` maps `copy_note`, and `normalizeCopyInput` trims `copyNote`.
- [ ] **Step 2: Run to verify failure.** `docker compose run --rm app npm test -- src/lib`. Expected: FAIL.
- [ ] **Step 3: Implement** per Interfaces. Fix each `CopyInput` literal with `copyNote: null`.
- [ ] **Step 4: Verify.** `docker compose run --rm app npm test`, then `docker compose run --rm app npx tsc -b`. Expected: PASS, no type errors.
- [ ] **Step 5: Commit** `feat: scan intake fields, edition labels and copy notes in types and repo`.

### Task 3: Library — barcode parsing and ISBN lookup

**Files:**
- Create: `src/lib/scan/isbn-input.ts`
- Modify: `src/lib/photo/lookup.ts`, `src/lib/google-books.ts`
- Test: `src/lib/scan/isbn-input.test.ts`, `src/lib/photo/lookup.test.ts`, `src/lib/google-books.test.ts`

**Interfaces — Produces:**

```ts
// scan/isbn-input.ts
type BarcodeVerdict = { kind: "isbn"; isbn13: string } | { kind: "not_isbn" };
isbnFromBarcode(text: string): BarcodeVerdict
// digits only; 13 → itself; 15 or 18 (an add-on appended) → the first 13; otherwise not_isbn.
// The 13 digits must pass normalizeIsbn13: 978 or any 979 (including 9790), valid checksum (D13).
isbnFromTyped(text: string): string | null
// normalizeIsbn13, else normalizeIsbn10 → isbn10To13; spaces and hyphens allowed; 'x' accepted as X.

// photo/lookup.ts (additions)
lookupIsbn(isbn13: string, opts: { fetchImpl: typeof fetch; googleBooksKey: string | null }): Promise<LookupResult>
lookupForItem(item: IntakeItem, opts: same): Promise<LookupResult>    // D7
needsLookup(item: IntakeItem): boolean                                // D7

// google-books.ts (addition; shares hit mapping with searchGoogleBooks through one private hitOf)
searchGoogleBooksIsbn(isbn13: string, key: string, fetchImpl: typeof fetch): Promise<GoogleBooksSearchHit | null>
```

- [ ] **Step 1: Write the failing tests** (synthetic ISBNs and titles, stubbed `fetchImpl`):
  - **`isbnFromBarcode`:**
    - `"9780000000002"` gives an isbn result;
    - `"978000000000251299"` (an EAN-5 add-on) and `"978000000000212"` (EAN-2) give `9780000000002`;
    - `"9780000000003"`, `"0012345678905"` (UPC-style), `"51299"` and `""` give `not_isbn`;
    - `"9791000000008"` and `"9790000000001"` give isbn results (D13).
  - **`isbnFromTyped`:**
    - `"978-0-00-000000-2"` and `" 9780000000002 "` give `9780000000002`;
    - `"0-00-000000-0"` (ISBN-10) gives `9780000000002`;
    - `"979-0-000000-00-1"` gives `9790000000001` (D13);
    - `"9780000000003"` and `"abc"` give null.
  - **`lookupIsbn`:**
    - the URL is `search.json?isbn=9780000000002&limit=1&fields=...editions,editions.cover_i`;
    - a doc whose edition has `cover_i` 42 and whose work has 7 gives a cover with `/b/id/42-L.jpg`, while an edition without one gives 7;
    - the result has `byIsbn: true`, `agrees: true`, and `matchIsbns` containing the ISBN;
    - zero docs with a Google key calls `q=isbn:9780000000002` and takes the hit listing that ISBN, ignoring a hit that doesn't list it;
    - zero docs without a key gives `source "none"`;
    - a 429 throws a retryable `LookupError`.
  - **`lookupForItem`:**
    - a scan calls only the ISBN path;
    - a photo with `scannedIsbn` whose ISBN lookup finds nothing falls back to `lookupMetadata` with the extraction title and returns `byIsbn` falsy;
    - a photo without one calls only the title path.
  - **`needsLookup`:**
    - true for a ready scan with `lookup` null;
    - false once `lookup` is set;
    - false for a ready photo with a blank title and no `scannedIsbn`.
  - **`searchGoogleBooksIsbn`:** never puts the key in an error message, and `searchGoogleBooks`'s existing tests still pass.
- [ ] **Step 2: Run to verify failure.** `docker compose run --rm app npm test -- src/lib/scan src/lib/photo/lookup src/lib/google-books`. Expected: FAIL.
- [ ] **Step 3: Implement** per Interfaces and D7.
- [ ] **Step 4: Verify.** Same command, then the full `npm test`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: ISBN barcode parsing and ISBN lookup`.

### Task 4: Library — proposals and confirm for scans, scanned ISBNs and editions

**Files:**
- Modify: `src/lib/photo/propose.ts`, `src/lib/photo/confirm.ts`
- Test: `src/lib/photo/propose.test.ts`, `src/lib/photo/confirm.test.ts`

**Interfaces:**
- Consumes: Task 2's `IntakeItem` fields; `agrees` (`lookup.ts`).
- Produces:

```ts
interface Proposal { /* + */ isbnConflict: boolean; repeatScan: boolean }   // repeatScan: a same-batch ISBN twin where either is extraCopy
itemConfidence(item: IntakeItem, proposal: Proposal): "high" | "medium" | "low"   // D9
// proposeMatch and bulkEligible keep their signatures; behavior per D9
lookupAsBookInput(title, authors, item: IntakeItem): NewBookInput
// CHANGED: takes the item. isbn13/isbn10 come from scannedIsbn first, else the valid extraction ISBN;
// lookup fields as before when agrees (a byIsbn lookup always agrees)
// runBulkConfirm: copy = { ownerUserId: item.ownerUserId, editionNote: item.editionLabel, copyNote: null, location: null }
```

- [ ] **Step 1: Write the failing tests** with the existing factories, extended with `source`, `scannedIsbn`, `editionLabel` and `extraCopy`:
  - **Scan query:** a scan with a found `byIsbn` lookup (title `"Salt Road"`, author `"A. Writer"`) and an empty catalog proposes `new_book`, has `needsTitle` false, is `"high"`, and is `bulkEligible`. The same scan with `source "none"` has `needsTitle` true, is `"low"`, and isn't eligible. With `lookup` null it isn't eligible.
  - **ISBN wins:** a catalog book with `isbn13 ["9780000000002"]` and a scan of that ISBN give reason `isbn`. A photo item with `scannedIsbn 9780000000002`, an extraction ISBN `9780000000019` and a different title also gets `isbn` for the first book.
  - **Conflict:**
    - A photo with `scannedIsbn`, Claude's title `"Glass Orchard"` and a `byIsbn` lookup titled `"Salt Road"`: `isbnConflict` true, confidence `"medium"` even if the extraction says high, not bulk-eligible.
    - With a `byIsbn` lookup titled `"The Glass Orchard"`: no conflict.
    - With no `byIsbn` lookup but a catalog `isbn` match titled differently: conflict.
    - With a blank Claude title: no conflict.
  - **Repeats and ISBN twins:**
    - Two open scans with the same ISBN in different batches list each other as twins, and neither is eligible.
    - The same in one batch, one with `extraCopy`: `repeatScan` true.
    - A photo item whose extraction ISBN equals an open scan's ISBN is a twin.
  - **`extraCopy` default (Review Focus 5):** the catalog book has a copy owned by A, and the `extraCopy` scan owned by A gives `add_copy`. The same scan without `extraCopy` gives `already_recorded`.
  - **Confirm:**
    - `lookupAsBookInput` for a scan stores `isbn13 ["9780000000002"]` and the lookup's cover.
    - For a photo with both ISBNs it stores only the scanned one.
    - `runBulkConfirm` sends `editionNote` from `item.editionLabel`; an item with clues `["Invented foil"]` and no label sends `editionNote: null` (the clues aren't prefilled).
    - `perform` is still only ever called with `new_book`.
  - **Purity:** the Plan 3 purity test still holds with the new fields.
- [ ] **Step 2: Run to verify failure.** `docker compose run --rm app npm test -- src/lib/photo`. Expected: FAIL.
- [ ] **Step 3: Implement** per D9. Keep the Plan 3 tests green; change only the assertions this plan changes (the bulk `editionNote` prefill).
- [ ] **Step 4: Verify.** Same command, then the full `npm test`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: proposals for scans, scanned ISBNs and per-item editions`.

### Task 5: Library — edition labels, the picker, copy notes and the library filter

**Files:**
- Create: `src/lib/editions.ts`, `src/components/edition/EditionPicker.tsx`
- Modify: `src/components/book/CopyForm.tsx`, `CopyList.tsx`, `BookDetail.tsx`, `src/lib/filter-books.ts`, `src/components/library/LibraryFilters.tsx`, `LibraryPage.tsx`
- Test: `src/lib/editions.test.ts`, `src/components/edition/EditionPicker.test.tsx`, `src/components/book/CopyList.test.tsx`, `src/lib/filter-books.test.ts`

**Interfaces — Produces:**

```ts
// lib/editions.ts
const MAX_LABEL = 120;
editionLabels(catalog: BookWithCopies[], openLabels: string[]): string[]   // D12
canonicalLabel(typed: string, labels: string[]): string | null              // trimmed; existing spelling on a case-insensitive hit; blank or > MAX_LABEL → null

// components/edition/EditionPicker.tsx
EditionPicker(props: { value: string | null; labels: string[]; onChange(label: string | null): void;
  label?: string /* default "Edition" */; disabled?: boolean })

// filter-books.ts
filterBooks(books, opts: { query: string; owner: OwnerFilter; edition?: string | null }): BookWithCopies[]
```

`CopyForm`: `Edition note` becomes `EditionPicker` (the labels come in through a new `labels: string[]` prop), plus a `Copy note` textarea (`Sprayed edges, signed, damage…` placeholder). `CopyList` shows `copyNote` under the edition and adds `copyNote` to `EDITABLE`. `BookDetail` builds labels from `useCatalog().books` and `listOpenEditionLabels`. A failure of the latter is logged, and the catalog labels are used alone.

- [ ] **Step 1: Write the failing tests:**
  - **`editionLabels`:**
    - copies `"Invented Box"`, `"invented box"`, `"Invented Box"` and `" Other Box "`, plus open label `"Third Box"`, give `["Invented Box", "Other Box", "Third Box"]`;
    - blank values and a 121-character note are dropped;
    - an empty input gives `[]`.
  - **`canonicalLabel`:** `("invented BOX", labels)` gives `"Invented Box"`, `("  ", ...)` gives null, and `(" New ", ...)` gives `"New"`. 120 characters plus surrounding spaces gives the 120 characters; 121 characters gives null.
  - **`EditionPicker`:**
    - it shows `Edition: none`;
    - opening it and typing `inv` filters to `Invented Box`;
    - typing `Fresh Box` shows `Add "Fresh Box"`, and choosing it calls `onChange("Fresh Box")`;
    - typing `invented box` shows no Add option;
    - `None` calls `onChange(null)`;
    - the filter field has `maxLength` 120, and pasting a 121-character value (set through `fireEvent.change`) shows `Labels are at most 120 characters.` with no Add option;
    - the sheet is keyboard-operable (Escape closes it, and the options are buttons).
  - **`CopyList`:** editing a copy, picking `Invented Box` and typing a copy note calls `updateCopy` with `{ edition_note: "Invented Box", copy_note: "Signed" }` and marks both edited fields.
  - **`filterBooks`:**
    - `edition: "invented box"` keeps only books with a copy whose note is exactly that label in any case, so `"Invented Box Deluxe"` is excluded;
    - `query: "invented"` matches a book through its copy's edition note;
    - `edition: null` filters nothing.
- [ ] **Step 2: Run to verify failure.** `docker compose run --rm app npm test -- src/lib/editions src/components/edition src/components/book src/lib/filter-books`. Expected: FAIL.
- [ ] **Step 3: Implement** per Interfaces and D12, in the existing Tailwind style.
- [ ] **Step 4: Verify.** Same command, then the full `npm test`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: household edition picker, copy notes and edition filter`.

### Task 6: Library — inbox: editions, Claude hints, scan cards, bulk edition and session edition for photos

**Files:**
- Modify: `src/components/inbox/IntakeCard.tsx`, `BulkConfirmSheet.tsx`, `InboxPage.tsx`, `UploadPanel.tsx`, `src/hooks/useIntake.ts`, `src/lib/photo/upload-queue.ts`
- Test: `src/components/inbox/InboxPage.test.tsx`, `src/lib/photo/upload-queue.test.ts`

**Interfaces:**
- Consumes: Tasks 2–5.
- Produces:

```ts
// useIntake additions
interface IntakeState { /* + */ labels: string[]; setEdition(itemId: string, label: string | null): void;
  upsertLocal(item: IntakeItem): void;            // the scanner adds a created scan without a reload
  lookupPausedUntil: number | null }              // D6 auto-resume
// runLookups uses needsLookup + lookupForItem, and auto-resumes after 60 s / on "online" (D6).
// (Flushing the scan outbox on mount is added to useIntake in Task 8, once Task 7's outbox exists.)
// runUploadBatch opts + { editionLabel?: string | null; scannedIsbn?: string | null } passed through to create
```

UI, with exact copy:
- **`IntakeCard`:**
  - The `Edition note` text input is replaced by `EditionPicker`, which defaults to `item.editionLabel` and calls `onEdition` (which persists) on change. It is always visible, not only under `Edit details`.
  - Add a `Copy note` textarea under `Edit details`.
  - Photo cards with clues show `Claude saw: {clues.join(", ")}`.
  - Scan cards show the lookup cover as the thumbnail (or the placeholder) and `Scanned ISBN {isbn}` (the item's own ISBN is shown only to the household in the app, never logged).
  - A not-found scan's heading is `Not found online`, with `No title found. Type it to continue.`
  - `isbnConflict` shows its D9 sentence, and `repeatScan` shows its D9 sentence in place of the twin sentence.
  - Confirm sends `copy: { ownerUserId, editionNote: <picker value>, copyNote, location }`.
- **`BulkConfirmSheet`:** each entry gets a checkbox (checked by default) and its `Edition: {label}` line. Under the list are an `EditionPicker` labelled `Set edition for selected`, an `Apply` button (which calls `setEdition` for the checked ids), and `Add {n} books` (the checked ones) and `Cancel`. `InboxPage` passes `editionNote: i.editionLabel ?? ""`; the clue prefill is deleted.
- **`UploadPanel`:** an `EditionPicker` labelled `Edition for this batch` sits under the owner select, defaults to none, and is passed to `runUploadBatch`. A `Scan barcodes` link to `#/scan` sits beside `Take a photo`.

- [ ] **Step 1: Write the failing tests** (mocks as in Plan 3):
  - A ready photo item with clues `["Invented foil","Signed"]` shows `Claude saw: Invented foil, Signed`. Its picker shows `Edition: none`, and Confirm sends `editionNote: null`. Picking `Invented Box` calls `setItemEdition(id, "Invented Box")`, and Confirm sends that label and the typed `copyNote`.
  - A scan item with a found lookup renders the lookup title as its heading and `Scanned ISBN 9780000000002`. It is counted in `Add {n} new books` alongside an eligible photo.
  - A not-found scan shows `Not found online` and disables Confirm until a title is typed. It then confirms with `{ book: { title, isbn13: ["9780000000002"] } }`.
  - **Bulk:**
    - with 3 eligible entries, unchecking one, picking `Invented Box` and pressing `Apply` calls `setItemEdition` twice;
    - `Add 2 books` confirms exactly the two checked;
    - each `confirmItem` call carries `edition_note: "Invented Box"`.
  - **Upload:** choosing a file with `Edition for this batch` set to `Invented Box` calls `createIntakeItem` with `editionLabel: "Invented Box"`. In `runUploadBatch`, `scannedIsbn` is passed through to `create`.
  - **Lookups:** a ready scan with `lookup` null triggers `lookupIsbn` once and `saveLookup`. A retryable error shows `Online lookup paused. It will retry.`, and after advancing fake timers by 60 s the lookup runs again with no click.
- [ ] **Step 2: Run to verify failure.** `docker compose run --rm app npm test -- src/components/inbox src/lib/photo/upload-queue`. Expected: FAIL.
- [ ] **Step 3: Implement.** Update Plan 3 assertions that pinned the old `Edition note` prefill to the new behavior. Delete none of the others.
- [ ] **Step 4: Verify.** Same command, then the full `npm test`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: edition picker, Claude hints and scan cards in the inbox`.

### Task 7: Library — scanner engine (read gate, outbox, owners, feedback, camera, decoder)

**Files:**
- Create in `src/lib/scan/`: `read-gate.ts`, `outbox.ts`, `owners.ts`, `session.ts`, `feedback.ts`, `camera.ts`, `decoder.ts`, `scan-loop.ts`
- Modify: `package.json`, `package-lock.json` (`"zxing-wasm": "3.1.6"`; run `docker compose run --rm app npm install zxing-wasm@3.1.6 --save-exact`)
- Test: `src/lib/scan/*.test.ts`, one per module. `decoder.ts` gets an options test plus `decoder.format.test.ts`, which runs the real WASM in Node against writer-generated images (I1)

**Interfaces — Produces:**

```ts
// read-gate.ts (pure; D4)
const REPEAT_WINDOW_MS = 3000;
type GateVerdict = { kind: "ignored" } | { kind: "not_isbn" } | { kind: "add"; isbn13: string }
  | { kind: "ask_another_copy"; isbn13: string };
createReadGate(windowMs?: number): {
  onBarcode(text: string, now: number, sessionIsbns: ReadonlySet<string>): GateVerdict;  // via isbnFromBarcode
  onTyped(isbn13: string, sessionIsbns: ReadonlySet<string>): GateVerdict;              // no window
}
const NUDGE_AFTER_MS = 8000; const IDLE_PAUSE_MS = 120_000; const DECODE_GAP_MS = 120;
nudgeDue(now: number, since: number): boolean          // since = max(cameraStart, lastAccepted, lastDismissed)
idleDue(now: number, lastActivity: number): boolean

// outbox.ts (D6)
interface OutboxEntry extends ScanItemArgs { createdAt: string; failed?: "rejected" }
outboxKey(householdId: string): string                  // `tpl_scan_outbox_${householdId}`
readOutbox(householdId): OutboxEntry[]; appendOutbox(entry): void
removeOutboxEntry(householdId: string, id: string): void       // re-reads storage, drops that id, writes back
markOutboxRejected(householdId: string, id: string): void      // same read-modify-write by id
isRejection(err: ScanSaveError): boolean
// code in (42501, 22023, 23514, 22P02), or status 400–499 except 408 and 429 (D6)
flushOutbox(householdId: string, deps: { create: typeof createScanItem; sleep(ms: number): Promise<void>;
  online(): boolean; onSaved(id: string): void; onRejected(id: string): void; signal?: AbortSignal }): Promise<void>
// One flush per household: a module-level Map<householdId, Promise<void>>. A call while one runs sets a
// "run again" flag and returns the running promise. The loop re-reads the outbox before each entry and
// ends when no unsent entry is left. Backoff 2000, 8000, then 30000 repeating while online(); stops on abort.
// 'created' | 'exists' → removeOutboxEntry + onSaved; isRejection → markOutboxRejected + onRejected; else keep
scansToHeal(batchItems: IntakeItem[]): string[]   // pure; D8 healing rule; ids of open scans to discard

// owners.ts (pure)
interface OwnedInfo { line: string | null; elsewhere: boolean }
ownedInfo(isbn13: string, catalog: BookWithCopies[], members: HouseholdMember[],
  openItems: IntakeItem[], batchId: string): OwnedInfo
// line: "Already in library — {owners}" where owners is "{Name}'s copy" | "shared copy" |
//   "{A}'s and {B}'s copies" | "{A}'s, {B}'s and shared copies" (members order, then shared;
//   unknown owner → "a former member's"). elsewhere: an open item in another batch has this ISBN
//   (scanned or extraction); its line is "Also waiting in the inbox from another session."

// session.ts
interface ScanSession { householdId: string; batchId: string; edition: string | null;
  ownerUserId: string | null; startedAt: string }
loadSession(householdId: string): ScanSession | null; saveSession(s: ScanSession): void; clearSession(): void
// key tpl_scan_session; a stored session of another household reads as null

// feedback.ts (D5)
createFeedback(env?: { AudioContextCtor?: typeof AudioContext; vibrate?: (p: number | number[]) => boolean }):
  { unlock(): void; accept(): void; notice(): void; setMuted(m: boolean): void }

// camera.ts (D11)
class CameraError extends Error { code: "denied" | "no_camera" | "busy" | "unsupported" | "unknown" }
interface CameraHandle { torchSupported: boolean; setTorch(on: boolean): Promise<void>; stop(): void }
startCamera(video: HTMLVideoElement, md?: MediaDevices): Promise<CameraHandle>
grabGuideFrame(video: HTMLVideoElement, canvas: HTMLCanvasElement): ImageData | null  // center 90% × 35%

// decoder.ts (lazy; D1). Only ever reached through `await import("./decoder")` in loadDecoder().
const READER_OPTIONS: { formats: ["EANUPC"]; eanAddOnSymbol: "Ignore"; maxNumberOfSymbols: 1; tryHarder: true };
interface Decoder { decode(frame: ImageData): Promise<string[]> }
// texts of results with isValid, any EAN/UPC format; the caller filters them through isbnFromBarcode (D1)
createDecoder(): Promise<Decoder>
// scan-loop.ts
loadDecoder(): Promise<Decoder>                          // import("./decoder").then(m => m.createDecoder())
runScanLoop(opts: { grab(): ImageData | null; decoder: Decoder; onText(text: string): void;
  gapMs?: number; signal: AbortSignal; sleep?(ms: number): Promise<void> }): Promise<void>
// sequential: grab → decode → onText per text → sleep(gap); never overlaps; exits on abort; a decode
// rejection is logged by name and the loop continues
```

- [ ] **Step 1: Write the failing tests** (fake clock, fake `MediaDevices` and `AudioContext`, no real WASM in Vitest):
  - **`read-gate` (Review Focus 1):**
    - `"9780000000002"` at t=0 gives `add`.
    - The same text every 100 ms up to t=10000 gives only `ignored`. At t=13100, after a 3 s gap, it gives `ask_another_copy` when the ISBN is in `sessionIsbns`, and `add` when not.
    - After an `add` at t=0, reads at t=2999 and t=5998 are both `ignored` (sliding: each refreshes the window).
    - `"0012345678905"` gives `not_isbn`, and so does `"9780000000003"`.
    - A different ISBN at t=100 gives `add` (two books in quick succession).
    - `onTyped` of an ISBN in the session gives `ask_another_copy` at once.
    - `nudgeDue(8000, 0)` is true and `(7999, 0)` false. `idleDue(120000, 0)` is true.
  - **`outbox` (Review Focus 2):**
    - Appending 3 entries then reading them back gives 3, in order.
    - `flushOutbox` with `create` failing twice then returning `exists` sleeps 2000, then 8000, then removes the entry and calls `onSaved`.
    - `22023` calls `onRejected` and keeps the entry marked; the next entry is still sent.
    - With `online()` false it stops sending until called again.
    - A throwing `localStorage` makes `appendOutbox` a no-op and `readOutbox` return `[]`, without throwing.
    - **Append during a flush:** `create` for entry 1 waits on a deferred promise. Meanwhile the test appends entry 2 and calls `flushOutbox` again, which returns the same promise and makes no second concurrent `create`. When entry 1 resolves, entry 1 is removed, **entry 2 is still in storage**, and the same flush then sends entry 2. At the end the outbox is empty, and `create` was called exactly twice, never two at once.
    - **Rejections:** `ScanSaveError` with `23514`, with `22P02`, and with code null and status 404 are each marked rejected and sent once only. Status 429, status 503 and a network error (status null) are retried.
  - **`scansToHeal` (D8):**
    - A batch with a not-found scan S and an open photo P of the same ISBN gives `[S]`. If S is already discarded as `replaced_by_photo`, it gives `[]`.
    - Two not-found scans of one ISBN (the second `extraCopy`) and one photo give only the newer scan.
    - A found scan (lookup agrees) plus a photo of the same ISBN gives `[]`.
    - Items from another batch are ignored.
  - **`owners`:**
    - A's copy gives `Already in library — Avery's copy` (fixture member A has the invented display name `"Avery"`, B `"Blake"`).
    - A's plus a shared copy gives `Avery's and shared copies`; A's and B's give `Avery's and Blake's copies`.
    - An unknown owner gives `a former member's copy`.
    - An open photo item in another batch whose extraction ISBN matches sets `elsewhere`; one in the same batch doesn't.
    - An ISBN-10 stored on the book is matched through `canonicalIsbns`.
  - **`session`:** save then load round-trips. Another household's session loads null. Blocked storage gives null.
  - **`feedback`:**
    - Before `unlock`, `accept()` creates no context.
    - After `unlock`, `accept()` starts one oscillator at 1760 Hz and calls `vibrate(50)`; `notice()` starts two at 880 Hz and calls `vibrate([40,60,40])`.
    - Muted, it starts none and doesn't vibrate.
    - A missing `vibrate` and a suspended context don't throw.
  - **`camera`:**
    - The constraints asked for equal D11's.
    - `OverconstrainedError` retries with `{ video: true }`.
    - `NotAllowedError` throws `CameraError("denied")`; `NotReadableError` gives `busy`; no `mediaDevices` gives `unsupported`.
    - `torchSupported` follows `getCapabilities().torch`, and `setTorch(true)` calls `applyConstraints({ advanced: [{ torch: true }] })`.
    - `stop()` stops every track.
    - `grabGuideFrame` on a 1920×1080 video reads the rect `(96, 351, 1728, 378)`, and returns null before `videoWidth` is set.
  - **`scan-loop`:**
    - With a decoder that resolves after a deferred promise, a second `grab` happens only after the first decode settles, followed by `sleep(120)`.
    - Aborting stops it.
    - A rejection doesn't end it.
  - **`decoder`:** `READER_OPTIONS` deep-equals the D1 options (this pins `formats: ["EANUPC"]` and `eanAddOnSymbol: "Ignore"`).
  - **`decoder.format.test.ts` (`// @vitest-environment node`; the real WASM, loaded from `node_modules` through `prepareZXingModule({ overrides: { wasmBinary } })` for both the writer and the reader):**
    - `writeBarcode("9780000000002", { format: "EAN13" })` from `zxing-wasm/writer` produces a PNG;
    - `readBarcodes(png, READER_OPTIONS)` from `zxing-wasm/reader` returns exactly one valid result with `text` `"9780000000002"`, and `isbnFromBarcode(text)` accepts it;
    - the test asserts the reported `format` is one of `"EAN13"` or `"ISBN"`, and the implementer records which one in the commit message;
    - the same check for `9791000000008`;
    - a written UPC-A (`"012345678905"`) is read, and `isbnFromBarcode` rejects it, which proves the `not an ISBN` path sees UPCs.

    If the writer's API differs from this, check `dist/es/writer/index.d.ts` at 3.1.6 and adjust the call, not the assertions.
- [ ] **Step 2: Run to verify failure.** `docker compose run --rm app npm test -- src/lib/scan`. Expected: FAIL.
- [ ] **Step 3: Implement** per Interfaces. `decoder.ts` uses D1's `prepareZXingModule` and `?url` exactly. Run `decoder.format.test.ts` first, **before** wiring the decoder into anything. If a 978 image is reported in a format the D1 filter doesn't expect, stop and fix D1 before continuing.
- [ ] **Step 4: Verify.** Same command, the full `npm test`, then `npm run build`. Expected: PASS, and the build emits a `zxing_reader-*.wasm` asset.
- [ ] **Step 5: Commit** `feat: scanner engine (read gate, offline outbox, camera, lazy decoder)`.

### Task 8: Library — the Scan screen

**Files:**
- Create: `src/components/scan/ScanPage.tsx`, `ScanList.tsx`, `TypeIsbnSheet.tsx`
- Modify: `src/lib/router.ts` and its test (`{ name: "scan" }`, `#/scan`), `src/App.tsx` (`React.lazy` route, header link `Scan` before `Photos`), `src/hooks/useIntake.ts` (on mount, `flushOutbox` for the household, then `upsertLocal` each saved scan; the inbox shows D10's `{n} scans are saved on this phone…` line while entries remain)
- Test: `src/components/scan/ScanPage.test.tsx`, `src/lib/router.test.ts`

**Interfaces:**
- Consumes: Task 7 (all of it), `useIntake` (Task 6), `runUploadBatch`, `processNew`, `discardItem`, `EditionPicker`, `holdWakeLock`.
- Produces: the default export `ScanPage`. The props it takes, for tests only, are `{ deps?: Partial<ScanDeps> }`, where `ScanDeps = { startCamera; loadDecoder; createFeedback; now(): number; newId(): string; storage: Storage }`.

Screen (phone-first, full height; style per the inbox):
- **Before start:** the owner select (shared `tpl_intake_owner`), `EditionPicker` labelled `Edition for this session`, the list restored from the session, and one big `Start scanning` button. Its handler calls `feedback.unlock()` and then `startCamera`.
- **Running:**
  - the video with the guide band outlined;
  - a top bar with `Done`, the session edition, the sound toggle, and `Torch` when it is supported;
  - under the video, `Take a photo` and `Type ISBN`.
- **The flash and the nudge:** the flash border follows D5. The nudge banner reads `Can't read a barcode? Take a photo instead.`, with `Take a photo` and `Dismiss`.
- **On session load (fresh or resumed):** discard every id `scansToHeal(batchItems)` returns, with `replaced_by_photo` (D8). Failures are logged by name and retried on the next load.
- **The running list (`ScanList`):** newest first. Items with `discardReason === "replaced_by_photo"` are hidden. The first 20 are shown, then `Show all {n}`. Each row has a thumbnail (`lookup.coverUrl`, `loading="lazy"`, `decoding="async"`) and a status, by state:

  | Row state | Status text |
  |---|---|
  | Outbox | `Saving…`; when offline, `Saved on this phone. It will upload when you're back online.` |
  | Rejected | `Couldn't save this scan.` |
  | Looking up | `Looking up…` |
  | Found | `{title} · {authors}` |
  | Not found | `Not found online.` + `Take a photo` |
  | Photo row | `Photo · Reading the cover…`, then its extraction title |

  Each row also shows its `ownedInfo` line and an `Add another copy` action.
- **On each accepted ISBN:**
  1. `appendOutbox`;
  2. add the row;
  3. `feedback.accept()`, or `notice()` when `ownedInfo` has a line or `elsewhere`;
  4. flush;
  5. once saved, `upsertLocal` with a ready scan item, and lookups pick it up.
- **On `ask_another_copy`:** stop decoding and show the D4 prompt. `Add another copy` saves with `extraCopy: true`; either answer resumes decoding.
- **`Take a photo`:**
  - stop the camera, then open `<input type="file" accept="image/*" capture="environment">`;
  - on `change`: `runUploadBatch([file], { householdId, ownerUserId, batchId, editionLabel, scannedIsbn, onChange }, { ...browserUploadDeps, onItemCreated: intake.processNew })`. `onChange` maps the single `UploadEntry` onto the photo row's status (`preparing`/`uploading` show `Uploading photo…`; `failed` shows `Upload failed.` with `Retry`; `unreadable` shows the Plan 3 HEIC or too-small sentence; `duplicate` shows `Already uploaded`);
  - then `processNew`; if it came from a not-found row, `discardItem(scanId, "replaced_by_photo")` (D8);
  - restart the camera on `change` or `cancel`.
- **`Type ISBN`:** a sheet with `<input inputmode="numeric" autocomplete="off">` and `Add`. An invalid entry shows `That isn't a valid ISBN. Check the digits.` A valid one goes through `onTyped`.
- **Lifecycle per D11:** visibility, idle pause (`Camera paused to save battery.` / `Resume camera`), the camera-error screens with their fallbacks, and the wake lock while running.
- **`Done`:** stop, `clearSession`, navigate to `#/inbox`. A `beforeunload` prompt is shown while the outbox has unsent entries **and** the browser is online.

- [ ] **Step 1: Write the failing tests** with fake deps: a fake camera, a decoder fed by a test-controlled queue of texts, a fake clock, an in-memory `Storage` and a mocked `intake-repo`.
  - **No silent writes:** decoding `9780000000002` creates a scan through `createScanItem` with the session's batch, owner and edition. It never calls `confirmItem`, `processItem` or the Edge Function for a scan.
  - **Hold (Review Focus 1):** the same text fed 50 times across 5 s gives one `createScanItem` and one `accept()`.
  - **Second copy:** after 3.5 s of nothing, the same ISBN shows the prompt, and decoding is paused (the decoder receives no frames). `Add another copy` creates a second item with `extraCopy: true`; `No` creates nothing.
  - **Owned:** a catalog copy of that ISBN owned by A shows `Already in library — {A}'s copy` on the row and plays `notice()`.
  - **Not an ISBN:** `0012345678905` creates nothing and shows `That barcode isn't an ISBN.` and the nudge.
  - **Nudge:** advancing 8 s with no read shows the nudge; `Dismiss` hides it for another 8 s.
  - **Offline (Review Focus 2):** with `createScanItem` rejecting with a network error, 3 scans show `Saved on this phone…`. After an `online` event and a successful mock, all 3 are created exactly once and the rows change to `Looking up…`.
  - **Reload:** unmount, then remount with the same `Storage` and items mock: the list shows the batch's items plus the unsent outbox entries, the edition picker shows `Invented Box`, and the owner is restored.
  - **Not found → photo:** a scan whose lookup is `none` shows `Take a photo`. Choosing a file calls `runUploadBatch` with `householdId`, `batchId`, `ownerUserId`, `scannedIsbn: "9780000000002"`, the session edition and an `onChange`, then `discardItem(scanId, "replaced_by_photo")`. The camera is stopped before the input opens and restarted after `change`.
  - **Replaced scans stay gone (I4):**
    - a remount whose items mock returns the scan with `discardReason: "replaced_by_photo"` lists only the photo row;
    - a remount whose mock returns the scan still open (`lookup.source "none"`) next to a photo item with the same `scannedIsbn`, standing for a tab killed before the discard, calls `discardItem(scanId, "replaced_by_photo")` once and lists only the photo row.
  - **Typed:** `978-0-00-000000-2` adds a scan. `9780000000003` shows the invalid message and adds nothing.
  - **Camera states:** `denied` shows its sentence with `Type ISBN` and `Take a photo` still working, and no torch. `torchSupported` shows `Torch`, and pressing it calls `setTorch(true)`.
  - **Lifecycle:** `visibilitychange` to hidden calls `stop()` and releases the wake lock; visible again calls `startCamera` again. 120 s idle shows `Camera paused to save battery.` `Done` calls `stop()`, clears `tpl_scan_session`, and sets the hash to `#/inbox`.
  - **Router:** `parseHash("#/scan")` gives `{ name: "scan" }` and round-trips.
- [ ] **Step 2: Run to verify failure.** `docker compose run --rm app npm test -- src/components/scan src/lib/router`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Verify.** Same command, the full `npm test`, `npm run lint`, then `npm run build`. Expected: all green.
- [ ] **Step 5: Commit** `feat: continuous barcode scanning screen`.

### Task 9: Playwright walkthrough with a fake camera, docs, and branch wrap-up

**Files:**
- Create: `playwright.config.ts`, `e2e/fake-camera.ts` (init script), `e2e/barcodes.ts` (renders EAN-13 PNGs with `zxing-wasm`'s writer in Node), `e2e/scan.spec.ts`, `e2e/routes.ts` (synthetic OpenLibrary and Google responses), `scripts/check-bundle.mjs`
- Modify: `package.json` (`"@playwright/test": "1.64.1"` exact; scripts `e2e` and `check:bundle`), `docker-compose.yml` (service `e2e`: image `mcr.microsoft.com/playwright:v1.64.1-noble`, the same `.:/app` and `node_modules` volumes, `extra_hosts` `host.docker.internal:host-gateway`), `.gitignore` (`test-results/`, `playwright-report/`), `README.md` (a Scan section)

**How the walkthrough runs:**
- **The stack:** the local ToS stack runs from `<tos-wt>` (Task 1, after `db reset`), with `functions serve` and the fake-vision env file from Plan 3 Task 3.
- **The app:** Playwright's `webServer` runs `npm run dev -- --port 5174` **inside the e2e container**, with `VITE_SUPABASE_URL=http://host.docker.internal:54321` and the local publishable key, passed in from the host env.
- **A guard:** `globalSetup` aborts unless the Supabase URL's host is `host.docker.internal`, `127.0.0.1` or `localhost`.
- **Users:** each test signs up a fresh user through the public auth API and creates a household with `create_household`. No secret key is involved.
- **Network:** `page.route` serves OpenLibrary and Google from `e2e/routes.ts`, using synthetic titles and the synthetic ISBNs (one ISBN is set up as "not found").
- **The fake camera:** `fake-camera.ts` replaces `navigator.mediaDevices.getUserMedia` with a `canvas.captureStream(15)` stream. It draws whatever `window.__fakeCamera.show(pngDataUrl | null)` last set, and exposes `window.__fakeCamera.tracks()`. Variants: `deny` (rejects with `NotAllowedError`) and `torch` (`getCapabilities` returns `{ torch: true }`, and `applyConstraints` is recorded).

- [ ] **Step 1: Write `e2e/scan.spec.ts`.** Each case is one test, at a 390 × 844 viewport:
  1. **Shelf session:**
     - start; show the barcodes for `9780000000002`, `9780000000019` and `9791000000008` for 2 s each, with a blank frame between them;
     - expect 3 rows with titles; `9780000000003` (bad checksum) adds no row;
     - the list survives `page.reload()` with the edition `Invented Box` still selected;
     - `Done` opens the inbox with 3 scan cards, and `Add 3 new books` adds them;
     - the Library shows 3 books whose copies have origin `scan` and edition `Invented Box`.
  2. **Hold and repeat:** keep `9780000000026` in view for 10 s: 1 row. Blank for 4 s, then show it again: the prompt appears, and `Add another copy` gives 2 rows. In the inbox, neither card is bulk-eligible. After the first is confirmed, the second defaults to `Add a copy`.
  3. **Already owned:** confirm `9780000000033` once, start a new session and scan it: the row reads `Already in library — {name}'s copy`.
  4. **Not found → photo:** scan the not-found ISBN, tap `Take a photo`, and set a synthetic JPEG on the input (`setInputFiles`). Expect the row replaced by a photo row. In the inbox the card has the typed-title prompt (fake vision reads no title), and confirming creates a book with `isbn13` equal to the scanned ISBN. Check in Studio or through REST.
  5. **Offline mid-shelf:** `context.setOffline(true)`, scan 2 books: `Saved on this phone…`. Reload while still offline: both rows are still shown. Go back online: both upload once, and the inbox shows exactly 2 new scan items.
  6. **Lookup rate-limited:** the route answers OpenLibrary with 429 for the next 3 calls. Scans still add rows and show `Online lookup paused. It will retry.`, and after the clock moves on, the lookups finish.
  7. **Permission denied** (`deny` variant): the denied sentence shows, and `Type ISBN` with `0-00-000000-0` adds `9780000000002`.
  8. **Torch** (`torch` variant): `Torch` is visible, and pressing it records `advanced: [{ torch: true }]`.
  9. **Tab hidden:** set `document.visibilityState` to hidden and dispatch `visibilitychange`: every fake track's `readyState` is `ended`. Visible again: a new stream is live.
  10. **Long session** (Review Focus, the 100-book case): 100 distinct synthetic ISBNs: first 12 digits `9780000001NN` (NN = 00–99), check digit computed with the same rule as `normalizeIsbn13`. All 100 rows exist, and `performance.memory` (Chromium) after the run is within 50 MB of the value after 10 scans. The DOM row count stays at most 21 until `Show all`.
- [ ] **Step 2: Run to verify failure, then make it pass.** `docker compose run --rm e2e npx playwright test`. Expected: green after fixing only app bugs it finds. Don't weaken an assertion to pass; if one is wrong, fix the test and say so in the commit.
- [ ] **Step 3: Bundle check.** `docker compose run --rm app sh -c "npm run build && npm run check:bundle"`. Expected:
  - the entry chunk contains no `zxing`;
  - one `zxing_reader-*.wasm` exists;
  - the script prints the scanner chunk and `.wasm` sizes, and they are within 10% of D1's numbers. If not, update D1 in a follow-up commit.
- [ ] **Step 4: Full gates.** `docker compose run --rm app npm test`, `npm run lint` and `npm run build`; then `npx supabase@2.122.1 test db --workdir <tos-wt>`. Expected: all green.
- [ ] **Step 5: Privacy check.**
  - `git diff --name-only origin/main...HEAD` lists no `.jpg`, `.jpeg`, `.heic`, `.png` (besides the existing `public/icons`) or `.env` file;
  - the barcode PNGs are generated at test time, never committed;
  - fixtures contain only invented titles and the synthetic ISBNs;
  - `grep -rn "console\.\(log\|error\)" src/lib/scan src/components/scan` shows no ISBN, title or path argument.
- [ ] **Step 6: README, review, commit, PR.**
  - Write the README `Scan` section: start a session; one tap starts the camera; the edition and owner for the session; what the beeps mean; `Take a photo` when it won't read; `Type ISBN`; that scans are saved on the phone when offline; that review happens in the inbox.
  - Run a whole-branch subagent review against the spec and this plan, with Review Focus 1–5 called out.
  - Commit `docs: barcode scanning usage`, plus the e2e commit(s) before it.
  - Push and open a PR to `main`, leaving it unmerged. The PR body says **the ToS `library-scan-intake` PR and the user-approved step must land first**, and that the Edge Function is unchanged. It also lists the real-phone checks below as not done yet.

**What still needs a real phone** (Playwright can't do these; the user does them in the rollout, step 6):
- iPhone Safari's camera prompt;
- `playsinline` behavior;
- the beep after the session-start tap, with the ring switch on and with it off (silent: expect no beep, but the flash still shows);
- the camera coming back after the photo capture sheet;
- Android Chrome's vibration and torch;
- real books, including a price add-on, a mass-market UPC, glossy and curved barcodes, and dim light;
- a real 50–100-book shelf (time per book, heat and battery, the screen staying on, the idle pause);
- edition covers from real lookups.

---

## USER-APPROVED STEP: production rollout

**Agents don't run this without the user's explicit go-ahead at that moment.** Approval of this plan isn't approval of this step. The user runs it, or explicitly tells an agent to, in this order:

1. Merge the ToS `library-scan-intake` PR.
2. In the linked worktree `C:/Users/tierr/Github/tome-of-secrets-library-schema`, run `git fetch origin`, then `git checkout --detach origin/main`. Then:
   - run `npx supabase@2.122.1 db push --dry-run --workdir C:/Users/tierr/Github/tome-of-secrets-library-schema`, and confirm the only pending migration is `..._library-scan-intake`;
   - run it without `--dry-run`. The migration also runs the one-time edition-note cleanup (D3).
3. **No function deploy:** `library-intake` is unchanged.
4. Merge the library PR **right away**; the Pages deploy runs. Don't confirm photos between steps 2 and 4: a photo confirmed by the old app in that gap keeps Claude's text as its edition (D3).
5. Spot check: open a book that was confirmed from a photo under Plan 3. Its Claude text is now under the copy note, and the edition is empty. A libib edition note is unchanged.
6. **Real-phone walkthrough** (the list at the end of Task 9), on the deployed HTTPS site, on the user's phone(s). Run whichever platform-specific checks apply to the phones at hand; for example, torch and vibration need Android Chrome, and the silent-switch beep check needs an iPhone:
   - scan 5 books, including one already in the library and one scanned twice;
   - photograph a book with no barcode;
   - put the phone down for 2 minutes;
   - reload mid-session;
   - turn on airplane mode for 2 scans, then turn it off;
   - set the session edition to a box name.

   Expected: each matches its Task 9 e2e counterpart, and nothing reaches the catalog until you confirm in the inbox. Discard anything you scanned only to test. Report anything that differs; fixes are follow-up PRs.

## Open questions for the user

Each has a default that the plan builds; answer only to change it.

1. **Bulk sheet checkboxes (D12).** The spec says bulk confirm "keeps" set-edition-for-selected, but no such control exists today. The plan adds a checkbox per entry: the checked entries get the edition and are the ones added. Say if you'd rather keep "add all", with the checkboxes for the edition only.
2. **Real-phone testing happens after the production rollout (Task 9, rollout step 6).** The camera needs HTTPS, so the local dev server over the LAN can't be used. Nothing is written without a confirm, so test scans can be discarded. The alternative is a self-signed HTTPS dev server, which needs an extra dev dependency and accepting a certificate warning on each phone.
3. **Sound defaults to on**, with a remembered toggle (D5). The flash always shows.
4. **Labels over 120 characters** (long libib notes) are left out of the edition list (D12) but stay on their copies, searchable. Say if any long note should become a label.
