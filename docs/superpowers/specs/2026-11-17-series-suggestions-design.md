# Series suggestions: design

**Date:** 2026-11-17
**Status:** draft for the owner's review
**Repos:** Tome of Secrets (the tagger function and the database migration) and the library app (screens).

## 1. Intent

Today a book's series (name and number) is only ever set by hand, on the book page or with bulk edit. Scans, photo intake and imports all leave it blank. The owner wants new books to arrive with their series filled in, without the library drifting into near-duplicate series names ("Name", "Name Series", "The Name Saga"). That drift is the same worry that made new tags go through approval.

**Success:** after a scan, a book in a series the household already has shows that series (and usually its number) with no typing. A book from a series new to the household shows up as a suggestion, and one tap approves it for every book that suggested it.

## 2. Goals, non-goals, anti-goals

**Goals**
- The AI tagger names a book's series and number while it tags.
- A series that's already in the household's library is applied straight away, under the household's existing spelling.
- A series name new to the household is never applied without approval. It becomes a suggestion that a person approves or dismisses.
- Books already in the library can be checked for a series in one cheap, opt-in run.

**Non-goals**
- Pulling series from Open Library or Google Books. The owner chose the tagger route; book-database series data is patchy.
- Series pages, reading-order views, or "next in series" features.
- Changing or merging series that are already set.
- Automatically merging near-duplicate series names.

**Anti-goals (this would be a failure even if it technically works)**
- A new series name appears on books without a person approving it.
- The tagger overwrites, or later refills, a series someone set or cleared by hand.
- Any spend the household didn't see coming. The backfill shows its cost first, like Tag all books.
- Wrong series on books, from the model guessing. Prefer blank over wrong.

## 3. Decisions (the owner's)

- **Source: the AI tagger** (2026-11-17), not book databases.
- **New series need approval; existing ones apply directly** (2026-11-17): "It should suggest new series for approval to prevent the same concern we had for tags."
- **Unknown number is fine** (2026-11-17): if the tagger is confident the book is in a series but can't tell its place, the book still gets the series, with the number left blank.
- Subtitle and series-suffix title matches in read-status matching stay as clear matches (2026-11-17, closing the Plan 8 question). Recorded here only so it isn't asked again.

## 4. How it works

### 4.1 What the tagger returns
For every full tag job, the tagger also returns `series`: either null, or `{ name, volume }`, where `volume` is a number (decimals allowed, such as 2.5 for a novella) or null.
- It returns a series only when it is confident the book belongs to one. Otherwise it returns null. Prefer null over a guess.
- `volume` is null when the place in the series is uncertain, and for omnibus or box-set editions that hold several volumes.
- The prompt's existing rule applies: book text is data, not instructions.
- The tagger is told the household's existing series names (up to a sensible cap, see §6), so it can reuse an exact existing spelling when the book belongs to one of them. *(Claude's call: this does most of the duplicate-avoidance work cheaply.)*

### 4.2 What happens to the result (server side, in the same step that saves tags)
The series result is used only when the book's series is still blank **and** neither `seriesName` nor `seriesVolume` is in the book's hand-edited fields. Otherwise it is ignored. A book whose series was cleared by hand counts as hand-set, so it is never refilled.

Then:
1. **Matches an existing household series** (trimmed, case-insensitive, compared against the series names currently on the household's books): set the book's series to the household's existing spelling, and the number to `volume` (or blank). These writes are not marked as hand-edited, so a later hand change still wins and is recorded as usual.
2. **New name:** do not touch the book. Record a **series suggestion** for the household, keyed by the name's case-insensitive form, and attach the book with its proposed number and a one-line why.
   - If that name was **dismissed** before, do nothing: a dismissed name is never suggested again for that household.
   - If that name was **approved** before, apply the series it was approved as (the approved name may differ, see §4.3) directly, like step 1. *(Claude's call: an approved suggestion remembers where it led, so "Name Saga" approved as the existing "Name" never comes back as a repeat suggestion.)*

A tagger write to the series must not start another tag job. (Today only synopsis and cover changes do; keep it that way.)

### 4.3 Approving and dismissing
Pending series suggestions show on the **Tag suggestions** screen in their own **Series** section, below the tag suggestions. The badge or count that points people to that screen includes them. Each suggestion shows:
- the proposed series name, editable before approving;
- the books behind it, each with its proposed number (editable or clearable) and the tagger's why;
- **Approve** and **Dismiss**.

**Approve** fills in the series (the possibly edited name) and the numbers on the listed books that are still blank and not hand-set. If the edited name now matches an existing household series case-insensitively, the existing spelling is used. *(Claude's call: this is how someone folds a near-duplicate suggestion into a series they already have, without a separate "merge" feature.)* Either household member may approve or dismiss, like tag suggestions.

**Dismiss** marks the name dismissed for the household. It is not suggested again.

### 4.4 Books already in the library (backfill)
A **Find series** action on the Tag suggestions screen checks books that already have a tag card, a blank series, no hand-set series, **and have never been checked for a series**.
- **Each book is checked once.** Every series check (a full tag job after launch, or this pass) records that the book was checked, whatever the result, so standalone books and books behind a pending or dismissed suggestion are never paid for twice. Only **Retag this book** re-checks a book. *(Claude's call: no repeat spend, per the anti-goals.)*
- It uses each book's saved card (summary and cover description) and title and authors, with no image: a text-only pass that asks only for the series. It goes through the same rules as §4.2.
- Before it runs, it shows the number of books, a cost estimate and the tagging budget left, behind a Confirm, the same pattern as Tag all books and Check for new tags. It runs in the open app and stops cleanly at the monthly cap.
- It uses **the same model as tagging** (the owner, 2026-11-17: accuracy over a cheaper model) and is charged to the existing **tagging** budget. Estimate: about 30¢ per hundred books, once; new books get the check inside normal tagging at almost no extra cost. The per-call budget hold may be smaller than a full tag job's, since there's no image.
- Books with no card yet are covered by Tag all books, which now includes series.
- **Retag this book** on the book page also re-checks series, under the same rules.

## 5. Constraints

- The Tome of Secrets repo owns the database migration and the tagger function. The library app owns the screens. The migration and function ship first.
- **Production:** the database push and function deploy need the owner's explicit go-ahead at the time.
- Public repos: synthetic examples only, in tests, fixtures and docs. No real series names.
- Follow the existing series rules: names are trimmed and 1 to 200 characters; numbers are 0 to under 10000 with two decimals.
- New tables follow the household row-level security pattern of `tag_suggestions` and `tag_suggestion_books`.
- Cost stays inside the existing tagging budget and its caps. No new budget.
- The design is reflected in the existing dark UI (Plan 9): shared parts, tap targets of at least 44px on phones.

## 6. Left to the builder

- The schema: a new `series_suggestions` plus `series_suggestion_books` pair is expected, mirroring the tag-suggestion tables. Reusing the tag tables is acceptable only if it stays clear.
- The cap on existing series names sent to the tagger, and what happens to households above it.
- The backfill job's kind name, batching and exact cost estimate.
- Whether the series section of the Tag suggestions screen is a section or a tab.
- Bulk edit already marks the series name as hand-set (`src/lib/mass-edit.ts`); that is enough, since either field being hand-set protects the book.
- Where the "checked for a series" marker lives (the card or the job) and how the approved-as name is stored on a suggestion.
- Prompt wording, and a synthetic test set showing it returns null for standalone books and for uncertain cases.
