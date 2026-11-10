# Barcode scanner and edition picker — design

Date: 2026-11-10. Builds on the personal library design (`2026-11-03-personal-library-design.md`) and the photo pipeline (Plan 3, live since 2026-11-09). Calls marked *(Claude's call)* were not stated by Tierra and can be overruled.

## 1. Intent

Tierra still has several shelves to catalogue, then mostly new books bought from bookstores. Photo intake works well (bulk confirm is liked), but two things are missing:

1. **A barcode scanner like libib's.** Scanning an ISBN is faster than a photo, free, and identifies the exact book. When a book will not scan, the app should go straight to taking a photo.
2. **Useful edition notes.** Claude's `editionClues` describe what the photo shows ("hardcover with gold foiling"), which is not what Tierra wants recorded. A Broken Binding copy just looks like a foiled hardcover; the box it came from is not printed on it. Tierra wants to pick the edition from a list.

Why the two belong together: book-box editions are exactly the books that do not scan. OwlCrate and FaeCrate books often have **no barcode at all**; some Broken Binding books do. Tierra groups books from the same box/publisher together on shelves, so a shelf session is often "all OwlCrate" — a session-wide edition is the natural way to label them.

## 2. Goals

- Catalogue a shelf in one continuous session: scan book after book, photograph the ones without a barcode, review everything once at the end, bulk-confirm.
- Scan one or two new books and confirm them quickly (the bookstore case).
- Tell Tierra **at scan time** when the household already owns the scanned book.
- Never dead-end: a barcode that will not read, or an ISBN no lookup knows, leads to a photo in one tap.
- Pick a copy's edition from a household list (OwlCrate, FaeCrate, Broken Binding, …), set once per session and overridable per book.
- Works on iPhone Safari and Android Chrome (*Claude's guess, accepted by Tierra*; the original design targeted an Android PWA, but scanning should not depend on which phone is used).

## 3. Non-goals

- Identifying the box edition from the barcode or the photo. The ISBN identifies the publisher's printing; the edition is Tierra's pick.
- Asking Claude to choose from the edition list (*Claude's call:* box editions look too alike for this to be reliable; revisit only if picking by hand proves tedious).
- Rewriting existing copies' edition notes, except moving the Claude-written ones from Plan 3 into copy notes (§6.4).
- Scanning anything other than book ISBN barcodes (no QR, no price-only supplemental codes as identifiers).
- Several books from one photo (still a future idea from the original design).

## 4. Anti-goals

- A scan silently adding a wrong book or a duplicate copy. Scans go through the same review/confirm step as photos.
- Claude's photo description landing in the catalog as if it were the edition.
- A scanner that is fiddly in a session: needing a tap per book to start scanning, re-adding the same barcode because the camera saw it twice, or losing a session's scans on reload.
- Scanning costing money or eating into the 500-photo daily limit.

## 5. Constraints and known facts

- App: Vite + React 19 + TypeScript + Tailwind 4, GitHub Pages (HTTPS, so camera access works). Supabase `library` schema in the ToS project; **ToS owns all migrations**, developed against a local stack, reaching production only after the maintainer merges and approves `db push`.
- Already built and reusable (Plans 2–3):
  - ISBN normalisation/validation (`src/lib/libib/isbn.ts`).
  - Metadata lookup: OpenLibrary first, then Google Books (`VITE_GOOGLE_BOOKS_API_KEY`), in `src/lib/photo/lookup.ts` and `src/lib/google-books.ts`.
  - Catalog matching and proposals (`src/lib/photo/propose.ts`, `similarity.ts`), including "Already recorded" and in-batch twin detection.
  - Intake items, the review inbox (`src/components/inbox/*`), bulk confirm, and the idempotent `confirm_intake_item` RPC.
  - Photo upload queue, Edge Function `library-intake` (Claude Haiku 5.5), daily cap 500 calls, 3 attempts.
- Today a confirmed photo writes `editionClues.join("; ")` into `copies.edition_note` (`src/lib/photo/confirm.ts`), and the inbox and bulk sheet show it as "Edition note". This design changes that.
- `copies.origin` is currently `libib | photo | manual`.
- The household's existing `edition_note` values (mostly from libib) already contain box names; they are the seed for the edition list.

## 6. Decided approach

### 6.1 Scanning session

- A **Scan** entry point (next to the existing photo upload) opens a full-screen camera view that scans continuously. No tap per book.
- Each successful read gives immediate feedback (beep and/or vibration where supported, plus a visual flash) and adds a row to a **running list** at the bottom of the screen: cover thumbnail and title once the lookup returns, or "Not found".
- **Repeated reads:** the same ISBN seen again within a few seconds is ignored (the camera sees one barcode many times). Scanning an ISBN already in this session's list later asks "Add another copy?" rather than adding silently. *(Claude's call.)*
- **Already owned:** if the ISBN matches a book in the household catalog, the row says so at scan time (e.g. "Already in library — Tierra's copy"). It still goes to review, where the existing "Already recorded" / new-copy choice applies.
- **"Take photo" is always one tap away** in the scanner. It captures a cover photo that joins the same session and goes through the existing photo pipeline (upload → Claude → lookup → proposal).
- **Won't read:** if the camera sees a book but no barcode reads within a few seconds, the scanner suggests "Take photo instead". *(Builder decides how "sees a book" is approximated; a simple "no read for N seconds since the last one" nudge is acceptable.)*
- **ISBN not found** by OpenLibrary or Google: the row prompts for a photo. The photo's intake item **keeps the scanned ISBN**, so its proposal and matching use the ISBN as well as Claude's reading.
- **Typing an ISBN** by hand is available as a fallback for a damaged barcode. *(Claude's call.)*
- Ending the session goes to the review inbox, where scans and photos appear together and bulk confirm works on both.

### 6.2 Scans in the inbox

- A scan becomes an **intake item** like a photo, so it survives a reload or a closed tab, shows in the same inbox, and is confirmed through the same idempotent confirm. It has no photo and **never calls Claude** or touches the daily vision cap.
- A scan whose lookup found the book is normally high confidence (the ISBN pins the book), so it is eligible for bulk confirm under the existing rules.
- Copies created from scans get a distinguishable origin (e.g. `scan`) *(Claude's call)*; that needs a ToS migration for the origin constraint and whatever intake-item changes scans require (a photo-less item, a source marker, the scanned ISBN, the session edition). Exact shape is the builder's.
- Scan lookups happen in the browser, like Plan 3's lookups.

### 6.3 Edition picker

- **Edition list per household**, shared by both members. It starts from the distinct `edition_note` values already in the household's copies, and a new label can be added straight from the picker ("Add 'FaeCrate'"). Labels are derived from existing values, not kept in a table (see §6.4); a label added by either member appears for both.
- **Session edition:** the scanning session (and a photo batch) has "Edition for this session: none" at the top. Choosing OwlCrate applies it to every scan and photo taken afterwards until changed. It is stored on each item when the item is created, so it survives a reload.
- **Per book:** each card in the review inbox shows the edition picker and can change it. Bulk confirm keeps "set edition for selected".
- **Copy notes:** a free-text note beside the picker for copy-specific details (sprayed edges, signed, damage). *(Claude's guess, accepted by Tierra.)* It is a new column (§6.4). Existing `edition_note` values are not rewritten, and the edition picked from the list is filterable and searchable as a whole value.
- **Claude's editionClues stop being written into the catalog.** They show as a small hint on the photo card ("Claude saw: hardcover, gold foil") to help Tierra pick. This replaces Plan 3's prefill in `confirm.ts`, the inbox, and the bulk sheet.
- The book detail page's copy editor uses the same picker, so editions can be fixed on books already catalogued.

### 6.4 Builder-check answers *(Claude's calls unless marked)*

- **Scans reuse `library.intake_items`** (ToS migration `20261108000000_library-photo-intake.sql`). Today an open item requires `cover_path` (`intake_items_cover_required`) and a `source_hash`, and new rows start `pending`, which the Edge Function claims. Scans need a source marker (`photo` / `scan`), the scanned ISBN, and those constraints relaxed for scan rows. A scan item is created directly as `ready`, with its lookup already filled in, so the vision queue never sees it. Dedupe for scans is by ISBN within a batch (see below), not by `source_hash`.
- **A session is the existing `batch_id`.** One scanning session = one batch id on every scan and photo item it creates; the session edition is stored per item at creation. "Add another copy?" applies to a repeat ISBN within the same batch. A reload restores the session's list from that batch's items.
- **Scanned ISBN vs Claude's reading** (photo taken after a not-found scan): the ISBN wins for lookup and catalog matching. If Claude's title clearly disagrees with what the ISBN resolved to, the item drops below high confidence, so it is not bulk-eligible and gets a look in review.
- **"Already owned" informs; it does not block.** The scan-time row names whose copies exist ("Tierra's copy", "AJ's copy", "shared copy", or several). The new-copy vs "Already recorded" decision stays in review.
- **Editions are stored as label strings**, not ids: the picked label goes in `copies.edition_note`, matching the existing data. The picker's list is the household's distinct `edition_note` values plus labels set on open intake items; adding a label just means using it. No labels table, and no rename/delete in this plan.
- **Copy notes get a new column** (e.g. `copies.copy_note`) for free text.
- **Cleanup of Claude-written edition notes** (decided by Tierra): the migration that adds `copy_note` moves Claude's text out of `edition_note` for copies confirmed from photos under Plan 3. Only copies whose `edition_note` still equals what Plan 3 wrote are moved: origin `photo`, linked by `intake_item_id`, and `edition_note` equal to that item's `editionClues` joined with `"; "`. Those copies get `copy_note` set to that text and `edition_note` set to null. A note someone has since edited no longer matches and is left alone. All other `edition_note` values (libib, manual) are untouched.
- **`confirm_intake_item` may change signature.** Only this app calls it. It must take the edition and the copy note, and set origin `scan` for scan items.

## 7. Left to the builder

- Barcode library. It must work on iPhone Safari and Android Chrome; the native `BarcodeDetector` API is not available on iPhone Safari, so expect a JS/WASM decoder (optionally preferring native where present). Load it lazily so the rest of the app does not pay for it.
- Accepting only EAN-13 978/979 (and validating the checksum with the existing ISBN code); ignoring the 5-digit price add-on.
- Camera handling: back camera by default, torch toggle where supported, permission-denied state with a path to photos/typing, releasing the camera when the session ends or the tab is hidden.
- Exact schema changes and their pgTAP tests (in ToS, following its migration process).
- Look and layout, matching the existing inbox.
- How long "a few seconds" is for both the duplicate-read window and the "take photo instead" nudge.

## 8. Roadmap after this

- **Plan 4 — Tome of Secrets integration** (unchanged, original design §6.5).
- **Plan 5 — Agent cover finder** (requested by Tierra 2026-11-10; may swap with Plan 4). Some automatic covers are wrong — for example a Spanish-language cover instead of the English edition — and some books have none. An agent (Claude with web search/fetch) would look for a better cover from sources such as Goodreads, publisher sites, or retailer listings:
  - **Per book:** "Find a better cover" on the book page, optionally with a hint ("English edition", "the OwlCrate cover").
  - **In bulk:** run over books with no cover, or with covers flagged as wrong.
  - Tierra **approves** each proposed cover before it replaces `cover_url`; candidates are shown side by side with the current one.
  - Open questions for its own design: where the agent runs (Edge Function vs. a Claude Code / MCP-style tool run locally), hotlinking vs. copying images into storage, cost per book, respecting site terms.
- Location (stretch, original design).
