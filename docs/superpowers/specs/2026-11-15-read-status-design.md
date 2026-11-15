# Plan 8: Read status per household member — design

Status: designed with Tierra on 2026-11-15; builder check done and its one question answered (Unread sticks). Awaiting Tierra's review of this document.

## 1. Why

When Tierra picks a book for a reading prompt (a ToS prompt or an outside challenge), they want to choose from **books the household owns that they haven't read yet**. Today the library has no idea who has read what.

- **Tierra** tracks reading in StoryGraph. It holds their full history, including many books the household doesn't own. Only about 70% of the household's books are scanned into the library so far.
- **AJ** doesn't use StoryGraph. He will mark what he has read from memory, in the library app.
- **ToS** records a completed book (with `dateCompleted`) on each player's character sheet. A ToS book that is on the household shelf carries a `libraryBookId`. ToS's completion tracking before its recent changes was only partial.

The household also wants a simple number for each person: **how much of what we own have I read?**

## 2. What success looks like

- In search and in Ask ✨, Tierra can narrow to **"Unread by me"** and get only owned books they haven't read or abandoned.
- Each person sees **read / owned** as a percentage, plus "read this year" and "read since a date" counts.
- AJ can catch up quickly by selecting a run of books in mass edit and marking them read.
- Tierra's StoryGraph history fills in once, and keeps filling in as unscanned books are added later, without manual linking for clear matches.
- After setup, keeping it current is a habit, not a chore. Tierra marks a finished book in StoryGraph and the library app; finishing a book in ToS marks it automatically.

## 3. Goals, non-goals, anti-goals

**Goals**
- A per-person, per-book **read status** (Read or Did not finish) with a **finish date**.
- A **StoryGraph import** from its export file (CSV), which can be uploaded again at any time to catch up.
- **Hidden reading history**: StoryGraph rows that match no library book are kept privately and linked automatically when the book is added later.
- **Possible matches**: a short review list for uncertain matches.
- **ToS completion** marks the book read in the library for the person who completed it.
- **Marking in the app**: on the book page and in mass edit.
- An **"Unread by me"** filter (and its siblings) that Ask respects.
- **Reading stats** per person.

**Non-goals**
- Not a reading tracker. StoryGraph stays Tierra's real record (ratings, reviews, moods, re-read history, currently reading, to-read).
- No live StoryGraph connection. As far as we know StoryGraph has no API; the export file is the only way in.
- No writing back to StoryGraph or ToS.
- No "currently reading", "to-read" or star ratings.

**Anti-goals** (failure even if it technically works)
- **StoryGraph books the household doesn't own never appear in the library**: not as books, not in search, not in counts.
- **A re-upload never clears or overrides a status someone set in the app** (§5.3).
- A wrong automatic match is worse than a missed one. When in doubt, ask (Possible matches) rather than guess.
- No real titles, ISBNs or reading data in the public repos (tests and fixtures are synthetic).
- No one marks a book for the other person by accident: marking is always for yourself (§5.5).

## 4. Constraints

- Tierra's standing rules apply (no AI attribution; Tierra merges; production changes need their go-ahead; synthetic data in public repos).
- **ToS owns all schema, RPCs and pgTAP** (ToS PR, new worktree off `origin/main`). Any ToS app change (the completion hook) is in the same ToS PR or a sibling one.
- No Claude API use is needed. Matching is deterministic. Cost: $0.
- Phone-first UI, same patterns as the existing screens (Tag suggestions, Edition labels, mass edit).

## 5. How it works

### 5.1 Data

- **Read status**: one row per household, book and member: `status` (`read` | `dnf` | `cleared`), `finished_on` (date, nullable), `source` (`app` | `storygraph` | `tos`), `updated_at`, and who set it. Unread is either no row or a `cleared` row. Status is per **book**, not per copy, so reading any edition counts.
- **Cleared (Tierra, 2026-11-15: Unread sticks):** setting Unread in the app stores `cleared` rather than deleting. Filters and stats treat `cleared` exactly like no row. StoryGraph uploads and automatic linking never change a `cleared` row. A new ToS completion of that book does change it, because that's a new finish (its `dateCompleted` is after the clear).
- **Reading history** (Tierra's StoryGraph rows, private to the member who uploaded them): only the fields needed to match and set status: title, authors, ISBN/UID, StoryGraph read status, last date read, plus the matched book (if any) and a match state (`matched`, `possible`, `dismissed`, `unmatched`). **Do not store** reviews, ratings, moods, content warnings, tags or other export columns.
- Rows whose StoryGraph status is `to-read` or `currently-reading` are ignored at import (not stored). `read` → Read. `did-not-finish` → Did not finish.
- RLS: household members can read everyone's read status in their household (that's what the stats compare). Reading-history rows are visible only to the member they belong to.

### 5.2 StoryGraph import and re-uploads

- **Where:** a new screen in the account menu, *Reading history*, with "Upload StoryGraph export". The CSV is parsed in the browser. Only the fields in §5.1 are sent (an RPC that upserts in batches).
- **Matching**, in order:
  1. ISBN (13 or 10, normalised) against the library's known ISBNs for the book (any edition).
  2. Normalised title + first author (case, punctuation, leading articles, subtitle after a colon).
  3. Anything close but not exact (e.g. a different edition's ISBN with a near-identical title, or a title match with a different author spelling) is **possible**, not matched.
  4. Everything else is **unmatched** and stays hidden.
- **Re-upload:** rows are keyed by StoryGraph's identity for the row (its ISBN/UID, else title + authors), so uploading again updates the same rows instead of duplicating them. A newer export can **add** a status or **upgrade** it (no status → Read/DNF; DNF → Read) and update the finish date. It never removes a status and never overwrites one whose `source` is `app` or `tos` (§5.3).
- **Result:** the screen reports counts only: matched and applied, possible matches to review, kept for later (unmatched), skipped (to-read / currently-reading).

### 5.3 Who wins when sources disagree

- A status set in the **app** or from **ToS** is never changed by a StoryGraph upload.
- A **StoryGraph** status can be replaced by a later app or ToS mark.
- An app mark always applies, including Unread, which stores `cleared` (§5.1).
- (Builder: if "newest wins" by timestamp is simpler and gives the same results for these cases, that's fine.)

### 5.4 Linking later: new books and Possible matches

- When a book is added (scan, photo intake, libib re-import, manual), or gains an ISBN, the database checks the hidden reading history of each household member with history. A **clear match** (rules 1–2 above) sets that member's status silently, as `source = storygraph`, unless they already have a row (any status, including `cleared`).
- An **uncertain** match goes to **Possible matches** (on the Reading history screen): each row shows the StoryGraph title and author next to the library book, with **Link** and **Not this book**. Not this book dismisses that pairing for good.
- Possible matches only ever show the uploader's own history.

### 5.5 Marking in the app

- **Book page:** a "Your reading" control: Unread / Read / Did not finish, with a finish date that defaults to today and can be changed (or cleared). Below it, other members' statuses in plain words ("AJ: read").
- **Mass edit:** a "Mark as… (for you)" field: Read, Did not finish, Unread, with an optional date for Read (default: leave existing dates, today for new ones; Claude's call). Same confirm-and-apply pattern as the other mass edit fields.
- Marking is always for the signed-in member. No marking on someone else's behalf.

### 5.6 ToS completion

- When a ToS player completes a book whose entry has a `libraryBookId`, ToS writes Read for that player (their auth user is a household member), with `finished_on` = the book's `dateCompleted`, `source = tos`. If they already have Read, only fill the date if it is empty.
- **One-time ToS backfill (Claude's call):** apply the same rule once to completed ToS books that already carry a `libraryBookId`, for any player whose save is reachable through the same path ToS uses for the library. Low effort and it can only add statuses. If the cloud save data isn't reachable server-side, do the backfill from the ToS app the next time the player opens it, or drop it (§6).
- Un-completing a book in ToS does not remove the library status.
- **Catch-up (Claude's call):** besides writing at the moment of completion, ToS checks on open for completed shelf books whose library status is missing or older, so a completion made offline or signed out still lands. This is safe because a `cleared` row is only replaced by a completion dated after the clear.
- Builder check notes: ToS completion happens in the browser (`stateAdapter.markBookComplete` sets `dateCompleted`); saves live in `public.tos_saves.data`, so a server-side one-off backfill is possible. Ask already runs on the filtered view (`askBookIds` uses `filterView`).

### 5.7 Filters and Ask

- A **Read status** filter in the library filters: *Unread by me* (no status for me, which excludes my DNFs), *Read by me*, *Did not finish (me)*, and the same three per other household member (e.g. *Unread by AJ*). Default: no filter.
- **Ask** respects it like the other filters: the Ask book set is the filtered set.
- Unhauled books are already hidden from the default view; nothing changes there.

### 5.8 Stats

- A **Reading** section (Claude's call: on the Reading history screen, and a one-line summary in the account menu) shows, for each member:
  - **Read of owned:** books read ÷ books owned, as a % with the counts ("142 of 205, 69%").
    - **Owned** = books with at least one copy that is that member's or Shared, and **not unhauled**.
    - **Read** = those owned books where the member's status is Read. DNF doesn't count as read.
  - **Read this year** and **read since [date]** (a date picker, e.g. for a challenge start), counting owned books with a finish date in range. Books without a date are counted in "read of owned" only.
  - DNF count, for information.

## 6. Left to the builder

- Exact table/RPC names, indexes, and how the "check history on new book" hook fires (trigger vs. RPC called from intake), as long as every add path is covered.
- The normalisation rules for title/author matching and the exact line between "clear" and "possible". Bias towards possible.
- How StoryGraph's CSV columns map (verify against a synthetic export built from StoryGraph's published column list; don't use Tierra's real file in tests).
- The ToS backfill mechanism (§5.6), or dropping it with a note if it needs disproportionate work.
- Whether the date in mass edit is one field for all selected books or "keep existing dates".
- Copy, layout and placement on the screens, within the existing patterns.

## 7. Rollout

1. ToS PR (schema, RPCs, history matching, completion hook, pgTAP) → Tierra merges → `db push` and any function deploy, with Tierra's go-ahead.
2. Library PR → Tierra merges → hard-refresh.
3. Tierra exports from StoryGraph and uploads it on Reading history, then reviews Possible matches.
4. AJ marks his books from memory with mass edit.
