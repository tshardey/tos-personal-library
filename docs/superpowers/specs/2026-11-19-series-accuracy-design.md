# Series accuracy: design

**Date:** 2026-11-19
**Status:** draft for the owner's review
**Builds on:** `2026-11-17-series-suggestions-design.md` (Plan 10). Everything there still holds unless this document changes it.
**Repos:** Tome of Secrets (tagger function and migration) and the library app (the cost estimates, the "Add to your series" wording and the Find covers note).

## 1. Why

The owner reviewed the first real series results (2026-11-18/19). Suggestions were mostly sensible, but there were wrong series and misses. The coordinator checked production read-only and confirmed the causes. Real titles stay out of this public repo; the examples below are invented stand-ins.

- **Wrong series, filled with no approval.** A book by one author was put into an existing household series that only held another author's books. For example, a book by "A. Reed" was filled into "The Lantern Vale Cycle", which only held books by "M. Holt". The design's "existing series apply directly" rule had no author check. At the time of the check, 8 auto-filled books sat in a series shared only with other authors. One pair was correct: the same author written two ways, "Tj Holt" and "T. J. Holt".
- **Misses.** The series check saw only the title, the authors, the AI-written summary and the cover line.
  - It never saw the book database description, nor the household's other books by the same author. A second book by an author whose first book already had a series came back blank.
  - Some books have almost no description (28 books under 100 characters).
  - Some books are simply unknown to the model.
- **Rejected guesses.** The owner dismissed suggestions that came from two places. Some were guesses from a number in the title. Others treated an author's loosely linked standalone novels as a series.

## 2. Goals and anti-goals

**Goals**
- No book is put into an existing series without approval unless one of its authors already has a book in that series.
- Give the model the evidence it was missing, for free where possible.
- Let the model search the web, but only when it is still unsure, and with a hard limit per book.
- Re-check the books most likely missed, cheaply and once.

**Anti-goals (unchanged from Plan 10, restated)**
- Wrong series on books without a person approving them.
- Surprise spend. Search cost must be bounded, measured and shown in estimates.
- Overwriting or refilling hand-set series.

## 3. Decisions (the owner's, 2026-11-19)

1. **Auto-fill only on an author match.** An existing series is filled in automatically only when an author of the book matches an author of a book already in that series. Otherwise, it becomes a suggestion for approval, exactly like a new series name.
2. **More evidence:**
   - the book's database description;
   - the household's other books by the same author, with their series and numbers;
   - Open Library's series data where it exists, which is free.
3. **Tighter rules:**
   - A number in the title is not by itself proof of a series.
   - A set of standalone novels linked only by theme, setting or the author's own grouping is not a series, unless it is published as a named series.
4. **Web search only when stuck.**
   - The model may search only when it is still unsure after the evidence above, with **at most 2 searches per book**.
   - Searches count against the tagging budget.
   - A real-API measurement, capped at **$0.50** and run on invented books, sets the estimates first, as in Plan 10 Task 4.
5. **A one-time targeted re-check** of likely misses (§4.5), not a full re-run.
6. **Find covers now note** (library): after Find covers now in Edit selected, say that the sheet can be closed and the results will show up in the Covers tab.

## 4. How it works

### 4.1 Author matching (server side)
- **Two author names match when their normalised forms are equal.** To normalise a name: make it lowercase, apply Unicode normalisation, and remove everything that isn't a letter or digit. "Tj Holt", "T. J. Holt" and "TJ Holt" all become `tjholt`.
- **A book matches a series** when any of its normalised authors equals any normalised author of a book in the household that currently carries that series (compared case-insensitively, as now).
- **This replaces Plan 10 §4.2 step 1.** An existing series is applied only when the series result matches it **and** the authors match. With no author match, the series is recorded as a suggestion for that book, under that series' existing household spelling.
- **The same author rule applies to a name approved earlier as an alias** (Plan 10 `approved_as`). The alias is followed only when the authors match its target series; otherwise the book becomes a suggestion.
- **Dismissing a suggestion for an existing series dismisses it for those books only.** It must not stop later same-author books from filling that series automatically, and must not stop other books from being suggested. Dismissing a new name still dismisses the name, as now. *(Claude's call: otherwise one dismissed cross-author guess would block a real series.)*
- **The approve screen marks these differently.** A suggestion for an existing series reads "Add to your series *X*", with the "Joins your series" hint, so the owner can see it isn't a new name.

### 4.2 More evidence for the model
Each series judgement, in full tag jobs and series checks alike, gets:
- the book database description (the book's synopsis), clipped to a sensible length;
- **same-author books:** the household's other books that share a normalised author, with title, series and number (or "no series"). This is capped at a sensible number, newest first;
- the **Open Library series** for the book, when its ISBN or work id gives one.
  - It is looked up by the function at check time, and is free.
  - A failure or timeout means "no data", never a failed job.
  - It is treated as a hint, not proof: it is shown to the model as "Open Library lists: …".

The household series-name list from Plan 10 stays, so spellings are reused. The prompt says plainly that the list exists for spelling only, and is never evidence that a book belongs to a series.

### 4.3 Tighter rules (prompt)
Add to `SERIES_RULES`:
- A number or "Book N" in the title alone is not enough.
- An author's standalone novels that share only a theme, setting or loose grouping are not a series, unless they are published under a series name.
- Prefer the publisher's series name.
- When an author has books in the household, use their series only if this book really belongs to it.

### 4.4 Web search only when stuck
- The model's series answer gains a third state. It is either:
  - **found**, with a name, number and why;
  - **none**, meaning the model is confident it is a standalone;
  - **unsure**.
- **Series check jobs** (Find series, re-checks and the follow-ups below) may use the web search tool, with `max_uses` 2, **only when the answer would otherwise be unsure.**
  - The builder picks the mechanism:
    - a first call without the tool, then a second call with it only on unsure;
    - or a single call with instructions to search only when unsure, plus the hard tool limit.
  - Use the cheapest mechanism that the measurement shows works.
- **Full tag jobs keep no web tool.** When a full job's series answer is unsure, the function queues a series check job (with search) for that book.
  - This doesn't happen if the book is hand-set or already has a series.
  - The book's "checked once" marker is set only by that series check.
- **Cost and budget:**
  - Search fees ($10 per 1,000 searches) and the tokens from search results go into the usage and spend records, against the tagging budget.
  - **Honest accounting over a perfect ceiling** *(Claude's call)*: search result size isn't bounded by the API, so the series-check reserve is the measured maximum with 2 searches times a generous margin (at least 2×). Settling a **series** job records its true cost even when that exceeds the reserve, so the budget never under-records real spend. The household can then go over its monthly cap by at most one call's overrun, and the next reservation fails at the cap as usual. Use the search tool version with result filtering where it is available, to keep results small.
  - If the series reserve ends up above the full-job reserve, the app's "budget used up" check and `ai_budget.reserve_micro` must use the larger figure, or each run must use its own.
  - The Find series estimate uses the measured mean.
  - **Follow-ups are costed** *(Claude's call)*: the Tag all books and Retag estimates add an allowance for unsure follow-ups. Until real data exists, assume 30% of books need one, and say so in a build note. After launch, the coordinator reads the real unsure rate from production usage (read-only, counts only) and updates the constant.
- **Untrusted pages:** search results and Open Library text are data, never instructions. The output stays the same narrow schema, and §4.1 keeps any risky result behind approval.

### 4.5 One-time targeted re-check
- Clear the "checked once" marker, so the existing Find series picks the books up. Do this only for books that meet all of the following:
  - their series is blank;
  - their series is not hand-set;
  - they have no pending suggestion;
  - either another household book shares a normalised author and has a series, or the synopsis is under 100 characters.
- This should run as a migration step, or as a one-off RPC the coordinator runs with the owner's go-ahead; the builder decides.
- Expected: about 40 books, roughly $1–2 even if every one searches. The Find series confirm shows the estimate before anything runs.
- Books already in a wrong cross-author series are not changed automatically; the owner fixes them by hand. *(The coordinator gave her the list.)*
- **Rollout gate:** existing series on books count as author evidence (§4.1, §4.2), so the wrong cross-author fills must be fixed **before** the production `db push`. The coordinator re-runs the read-only cross-author check and confirms that only legitimate rows remain (such as the same author spelled two ways) before asking for the go-ahead. *(Claude's call: only a handful of rows are wrong, so a gate is far cheaper than a provenance column.)*

### 4.6 Find covers now note (library)
- After a confirmed Find covers now in Edit selected, the result line also says, in about these words: "You can close this. Covers show up in the Covers tab when they're ready."
- It links to the Covers tab if that is cheap.

## 5. Constraints
- **Repos and production:**
  - ToS owns the migration and the function; the library owns the copy fix.
  - The production `db push` and function deploy need the owner's go-ahead at the time.
- **Test data:**
  - Synthetic data only, in tests, fixtures and docs.
  - The measurement uses invented books. Web searches for invented titles will find nothing, which is fine; that tests restraint, and the cost per search.
  - To measure search cost, the test set may include a few **public-domain classics in long-running series** whose details are public knowledge. The builder must ask the coordinator before adding any real title, even a classic.
- **No new budget.** Everything stays inside the tagging budget and its caps.
- **Keep Plan 10's guarantees:** hand-set series win, dismissed new names stay dismissed, and approved aliases still work (now behind the author rule).

## 6. Left to the builder
- The search mechanism in §4.4, chosen by measurement.
- The caps: same-author books sent, description length, the Open Library timeout.
- How the "unsure → queue a series check" follow-up is recorded, so it can't loop.
- Where the suggestion for an existing series stores its "existing" flag, and the per-book dismissal.
- Whether §4.5 is a migration step or an RPC.
- Updating the Find series estimate constants after measurement.
