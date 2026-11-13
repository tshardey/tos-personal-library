# Plan 6: Unhauled, Deluxe and Signed copies, date-added filter, scroll position — design

Status: designed with Tierra on 2026-11-12; builder check done and its questions settled as Claude's calls. Awaiting Tierra's review of this document.

## 1. Why

- **Unhauling.** Tierra trades books in for store credit and donates originals to free libraries or book exchanges after buying a deluxe edition. Today the only option is deleting the copy, which loses the record that the household once owned it and chose to let it go.
- **Deluxe and Signed.** Tierra owns many publisher deluxe editions. Today "deluxe" lives only as free text in a copy's edition note (often moved there from the title by the libib import, e.g. "(Deluxe Edition)"). They want a simple on/off toggle for each, with the note kept for anything else.
- **Date added.** After a bulk import, Tierra wants to check that day's books in one pass.
- **Scroll position.** Opening a book from far down the list and going back returns to the top of the list. This is a bug.

## 2. What success looks like

- Unhauling a copy takes one tap from the book's page, and undoing it takes one more.
- The main library view and Tome of Secrets show only what is on the shelf, but a search at the store still turns up "we had this and got rid of it".
- Deluxe and Signed are visible at a glance on each copy and can be filtered on.
- "Date added: Nov 12" shows exactly the copies added that day.
- Back from a book page lands where the person left the list.

## 3. Goals, non-goals, anti-goals

**Goals**
- Per-copy **Unhauled**, **Deluxe** and **Signed** toggles.
- A **Date added** filter.
- Keep the list's scroll position (and its filters and search) across opening a book and going back.

**Non-goals**
- Recording who an unhauled copy went to, or what it was traded for. The copy note covers that if wanted.
- The UI overhaul (editing in a drawer, the cover finder's bottom bar). That is a later plan, designed around these new fields.
- Searching descriptions with Claude. That is a later plan with its own brainstorm.

**Anti-goals** (failure even if it technically works)
- **An unhauled copy that silently disappears.** It must stay findable by search and by the Unhauled filter.
- **A quest in Tome of Secrets that loses its book** because the copy was unhauled.
- **Rewriting notes.** Turning Deluxe or Signed on, by hand or by the one-time backfill, never edits the note text.

## 4. Constraints

- **ToS owns all migrations.** The schema change goes in a ToS PR with pgTAP tests; the app goes in a library PR; ToS's own reading of the shelf goes in a second ToS PR (see §7). Production `db push` and any data backfill are user-approved steps that agents never run.
- Both repos are public. Fixtures and PR text use synthetic titles only.
- Shared household catalogue for Tierra and AJ; RLS as for the existing `copies` columns.
- Phone-first, matching the existing app (Vite, React 19, TypeScript, Tailwind 4) and the ToS Dark Academia look.

## 5. How it works (decided)

### 5.1 Unhauled (per copy, Tierra)

- **Unhauling is per copy, not per book** (Tierra). Example: a household keeps a deluxe edition and donates the original; the book stays on the shelf with one copy.
- A book is **unhauled** when it has at least one copy and every copy is unhauled. Every other book is **on the shelf**, including a book with no copies at all, so nothing disappears silently. *(Claude's call on the no-copies case.)*
- **One definition.** The on-shelf rule is defined once in the database (a view or a column the migration adds) and used by the app, the cover finder and ToS, rather than worked out separately in each. *(Claude's call.)*
- **Main library view and cover wall:** unhauled books are hidden unless the **Unhauled** filter is on (Tierra). The Unhauled filter shows books with any unhauled copy.
- **Search:** typing in the search box also finds unhauled books (Tierra), so someone in a bookshop can see the household deliberately got rid of a title. Unhauled books are clearly marked "Unhauled" in the results.
- **Book page:** unhauled copies stay listed, marked Unhauled and visually muted, with a toggle to undo. Copy counts in the list count on-shelf copies only. *(Claude's call.)*
- **Stored as** a nullable `unhauled_at` timestamp, set when toggled on and cleared when toggled off. The app shows it as an on/off toggle; the date is kept for free and can be shown as "Unhauled Nov 12". *(Claude's call: same as a boolean to the person, and the date is useful later.)*
- **Cover finder:** books with no on-shelf copy are left out of the No cover filter and of batches, so no money is spent on books the household got rid of. *(Claude's call.)*
- **Imports:** a libib re-import or intake must never clear `unhauled_at` on an existing copy.

### 5.2 Unhauled in Tome of Secrets (Tierra)

- Unhauled books are hidden from ToS's "On our shelf" view, the link-a-book picker and the tidy review, **unless the book is already linked to an existing quest** in the player's save. Those linked books keep working and keep showing where they do today, with a small "Unhauled" mark so the player knows. *(Claude's call.)*
- ToS reads the shelf directly from the `library` schema (`assets/js/services/LibraryCatalogService.js`), so this needs the copy's `unhauled_at` in that read and a filter in ToS.

### 5.3 Deluxe and Signed (per copy, Tierra)

- Two independent toggles on each copy, next to the existing edition note, copy note and the existing field for where the copy came from. Neither changes those fields.
- Shown as small badges on the copy and, when set on any on-shelf copy, on the book's row. **Deluxe** and **Signed** filters in the list. *(Claude's call on the badges and filters.)*
- **One-time backfill, shown to Tierra first:** after the production push, Claude runs a read-only query listing copies whose edition note or copy note contains "deluxe" or "special edition" (for Deluxe) or "signed" (for Signed), case-insensitive, and shows Tierra the list privately in chat. Once Tierra rules copies in or out, Claude sets the flags on exactly the approved copies with a one-off update, run with Tierra's go-ahead. The backfill is **not** in the migration, so no titles or ids go in the public repo; the migration is schema only. Note text is left as is. *(Claude's call.)*

### 5.4 Date added

- Uses each copy's `created_at`, read as a calendar day in the viewer's local time zone. A book matches if any of its copies was added that day.
- The filter offers the days that have copies, most recent first, each with its count of **copies** added that day (for example "Nov 12 · 23"). *(Claude's call.)*
- It follows the same unhauled rule as the rest of the list: unhauled copies count, and their books show, only when the Unhauled filter is on or in search results. *(Claude's call.)*
- Copies from the original libib import all share the day of that import, not libib's own "date added". That's acceptable for the bulk-import use case.

### 5.5 Scroll position

- Going back from a book page restores the list's scroll position, filters and search text, for both the list and the cover wall. Covers loading in after the return must not push the list away from where the person was.

## 6. Left to the builder

1. Exact column names and constraints, and how the new columns join `user_edited_fields` so imports respect hand edits.
2. Where each toggle sits on the current book page (the overhaul will redesign it later, so keep changes small).
3. How the filters combine (for example Unhauled with Date added) and where the date picker sits in the existing filter UI.
4. How ToS detects "linked to an existing quest" from the save's book records, and whether ToS should show Deluxe as an edition label alongside the existing edition-note labels.
5. The scroll-restoration mechanism (router state, a stored offset, or keeping the list mounted).

## 7. Rollout (user-approved steps)

The new column must exist before any code reads it: ToS selects copy columns by name, and a missing column would blank the whole shelf, not just the new filter. So the ToS work is two PRs. *(Claude's call.)*

1. Merge the ToS migration PR (schema and pgTAP only).
2. `db push`, with Tierra's go-ahead.
3. Backfill: Claude shows Tierra the Deluxe and Signed candidates privately, then sets the approved ones with Tierra's go-ahead.
4. Merge the ToS shelf PR and the library PR. Hard-refresh both sites after the Pages deploys.
5. Tierra unhauls this week's traded-in copies and checks they're gone from the main view and ToS but still found by search.
