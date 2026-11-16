# UI overhaul — design

Status: draft for Tierra's review. Date: 2026-11-15.

## 1. Intent

The library app works, but it looks and feels like a phone page stretched over every screen, and some features are hard to find. Tierra wants a **simple, clean, dark app** that follows common UI/UX practice. Netflix's layout and Audible's library are the reference points; Bookshelf (squidbit) is liked but is light.

Tierra's pain points, in their words:
1. Cover size can't be changed. Smaller covers would make picking books in bulk easier.
2. The top menu items (Library, Scan, Photos, Import) don't say what they're for until you open them.
3. Some features are hidden in the profile menu: read counts, Tag suggestions (adding tags), Edition labels.
4. After scrolling down the library you have to scroll all the way back up to change filters, switch to Select, or search.

How it's used:
- **Phone:** scanning books in, and quick "do we own this?" searches.
- **Computer:** editing books, finding corrected covers, curating, tagging, and searching for Tome of Secrets prompts (Ask).
- AJ uses the app too (he doesn't use StoryGraph), mainly on the library and mass edit.

Success looks like: everything Tierra uses often is visible or one tap away, the search/filter/select controls never scroll out of reach, covers can be sized, and the whole app is consistently dark.

## 2. Goals, non-goals, anti-goals

**Goals**
- Dark theme everywhere, one shared set of colours.
- A navigation where every destination is named and findable.
- Library page: pinned slim toolbar, filters in a panel, active-filter chips, sort, cover-size control.
- Book page: two-column layout with tabs on the computer.
- A real computer layout (not the phone layout stretched), while staying phone-first.
- Shared UI parts (button, sheet/dialog, chip, select, tabs) so screens stop copying class strings.

**Non-goals**
- No behaviour changes on Scan, Photos, Import, Covers to review, Reading history, Tag suggestions, Edition labels or Sign in. They are **restyled to match only**.
- No new data, schema, RPCs or Edge Functions. This is a library-app-only change; nothing in Tome of Secrets (ToS) changes.
- No Netflix-style rows on the home screen (considered and not chosen).
- No light mode (Claude's call; see §6).

**Anti-goals (would be a failure even if it "works")**
- Losing a feature or making one harder to reach than today.
- Search, filters or Select scrolling out of reach again.
- A layout that's pretty but slower for the bulk-select and curating jobs on the computer.
- Low-contrast text (dark themes often fail here).

## 3. Decisions Tierra made (from the mockups)

### 3.1 Library home: one grid with a slim pinned toolbar (layout B)
- One full grid of covers. No rows/carousels.
- A **slim toolbar pinned to the top** while scrolling, containing: search (which keeps the Ask entry it has today), **Filters** (shows a count of active filters), **Sort**, **Select**, and a **cover-size control** (slider or step buttons).
- **Active filters show as removable chips** under the toolbar, with the book count.

### 3.2 Phone navigation: bottom tab bar
- Bottom tab bar with icons and labels: **Library, Add, Scan (large centre button), Covers, More**.
- **Covers** shows a count badge when covers wait for review (replaces today's amber "Covers to review (N)" pill).
- **More** holds: Reading history, Tag suggestions, Edition labels, Import, Photos, and the account (email, invite code if relevant, Sign out).
- The top of the phone screen keeps only the app title and the pinned toolbar (on screens that have one).
- On the computer, the same destinations sit in a row across the top; More becomes a dropdown menu.

### 3.3 Book page: two columns with tabs (option B)
- Left column: the cover, then the main actions **Edit, Find cover, Mark read**, and a **⋯** menu for the rest (Delete, Add copy, etc.).
- Right column: title, authors, series line, then tabs: **Overview** (synopsis + "Your reading", with AJ's status alongside), **Copies (n)**, **Tags** (library tags), **Tome of Secrets** (ToS tags).
- On the phone: cover on top, same tabs below.

### 3.4 Grid cards: cover with title and author underneath (option A)
- Title and author under each cover, truncated to one line each.
- At the smallest cover size the text hides so more books fit.
- Badges on the cover: Deluxe / Signed / Unhauled in one corner; the viewer's read status (✓ Read / DNF) in another. (This builds the "read badge on cards" Plan 8 follow-up.)
- Select mode: a checkbox on each cover and an accent outline on selected books. The existing bottom selection bar (N selected · Clear · Done · Edit) stays, restyled.

### 3.5 Colours: warm amber on slate (palette A)
Starting values from the mockup (the builder may tune for contrast):
- Background `#0f1115`; raised surfaces `#171a21`; controls `#232835`; borders `#262a33` / `#2f3440`.
- Text `#e6e6e6`; headings `#ffffff`; muted `#8a909c`.
- Accent `#e8b44c` (text on accent `#111`): active filters, selected books, current tab, primary buttons.
- Errors use a distinct red, never the accent. Success/read uses a soft green.

### 3.6 Filters panel on the computer: opens under the toolbar (option A)
- Opens below the toolbar, in four groups across the width: **Reading** (Unread/Read/DNF, plus For: Me / AJ), **Owner & Copy** (All/Shared/each member; Deluxe/Signed/Unhauled), **Tags & Series** (ToS tags, Library tags, Series), **Edition, Covers & Dates** (Edition, Covers, Published from/to, Date added).
- The grid updates live. "Clear all" is in the panel. Closing it leaves only the chips.
- On the phone the same groups stack in a bottom sheet.

### 3.7 Other screens: restyle only
Scan, Photos, Import, Covers to review, Reading history, Tag suggestions, Edition labels, Sign in and household setup get the dark theme and shared parts. Their flows and behaviour don't change.

## 4. Current state (for the builder)

From a read of the code on 2026-11-15:
- Router: `src/lib/router.ts`, switch in `src/App.tsx`. Routes: `#/`, `#/series/<name>`, `#/book/<id>`, `#/add`, `#/scan`, `#/inbox`, `#/import`, `#/covers`, `#/editions`, `#/tags`, `#/reading`.
- Header and nav: `src/App.tsx` (title, `CoversBadge`, `AccountMenu`), `src/components/nav/TabBar.tsx` (four text tabs), `src/components/nav/AccountMenu.tsx`. Not sticky.
- Library: `src/components/library/LibraryPage.tsx`, `LibraryFilters.tsx` (a tall sticky block with every filter expanded), `CoverWall.tsx` (fixed `grid-cols-2 … lg:grid-cols-6`), `BookCard.tsx`, `MassEditSheet.tsx`. No sort control; order is by title (series by volume).
- Book detail: `src/components/book/BookDetail.tsx`, sections stacked in one column.
- Styling: Tailwind 4, `src/index.css` is only `@import "tailwindcss";`. No theme tokens, no `dark:` classes, colours hard-coded (stone palette). No shared Button/Sheet/Dialog; the sheet pattern is hand-copied in ~8 places. `index.html` theme-color is `#292524`.
- `#/add` is only reachable from the empty-library state today.

## 5. Claude's calls (Tierra can overrule while reading)

1. **No light mode.** Dark only; the `theme-color` meta and the browser `color-scheme` are set to dark.
2. **Theme as Tailwind 4 `@theme` tokens** in `index.css` (semantic names like `surface`, `raised`, `text-muted`, `accent`), so colours change in one place.
3. **Shared UI parts** in `src/components/ui/`: Button (primary/secondary/ghost/danger), Sheet/Dialog (bottom sheet on phone, centred or anchored on computer, with focus trap and Escape), Chip, Select, Tabs, IconButton, Badge. Existing screens move onto them.
4. **Sort options:** Title (default), Author, Recently added, Published (newest first). Series view keeps volume order. Sort is remembered per device.
5. **Cover size:** about 4–5 steps from "small" (many per row; text hidden) to "large". Remembered per device (localStorage, wrapped so it can't break the page). Default ≈ today's size.
6. **The "Add" tab** opens a small chooser: **Type it in** (today's `#/add`), **Photos** (`#/inbox`), **Import** (`#/import`). Scan stays its own tab. Photos and Import also stay in More.
7. **The read count** ("You've read X of Y") moves to the top of Reading history and also shows in More.
8. **The book page remembers the last tab** used (per device), so tagging several books in a row stays on Tags.
9. **Pinned toolbar** stays pinned while scrolling on both phone and computer; on the phone it sits under the title, and the bottom tab bar is fixed.
10. **Accessibility basics:** text contrast at least WCAG AA on the dark palette, visible focus rings in the accent colour, 44px minimum tap targets on the phone, labelled icon buttons, keyboard-reachable menus and tabs, and respects reduced motion.
11. **Computer layout:** content capped at a comfortable max width for the book page and the simple screens; the library grid uses the full width.
12. **Book page tab contents (no new data):** **Tags** holds library tags (today's `LibraryTagsSection`); **Tome of Secrets** holds ToS tags (today's `TosTagsSection`). The mockup's "linked prompts" wording is not in scope. If a book has no ToS section to show, the tab still appears with today's empty-state text.
13. **"Mark read" button:** a shortcut over the existing reading control, not new behaviour. When the book is unread for the viewer it reads **Mark read** and does what today's Read option does (Read, dated today, through the same save/queue path in `YourReadingSection.tsx`). When it's already Read or DNF it shows that status (e.g. "✓ Read") and opens the Overview tab's reading control for changes. Hidden when reading isn't available, as today.
14. **Covers tab is always present** in the bar (stable five-slot layout). The count badge shows only when covers are waiting. When the cover finder isn't available or nothing waits, the Covers page shows a short empty/unavailable message instead of hiding. Tag suggestions and Reading history in More keep today's rule (hidden when their feature is off).
15. **Icons:** a small inline SVG set (no new icon library), unless the builder finds a tiny dependency clearly better.

## 6. Left to the builder (the plan)

- How to break the work into PRs. Suggested order: (1) tokens + shared parts + dark base + navigation; (2) library page (toolbar, filters panel, chips, sort, cover size, cards); (3) book page; (4) restyle the remaining screens; then a whole-scope review. Each PR must leave the app working and fully dark-consistent for what it touches.
- Exact breakpoints, spacing scale, type scale, icon drawings, cover-size step values.
- Whether the cover-size control is a slider or +/- buttons (whichever is easier to use on a phone).
- How filters map onto the existing `FilterOptions` and URL/series routing without changing filter behaviour.
- Keeping existing unit and e2e tests passing; updating selectors where markup changes; adding tests for sort, cover size, chips and the new nav.
- Checking the scan camera screen still works full-screen with the bottom tab bar (hide the bar while scanning if needed).

## 7. Constraints

- Library app only (Vite/React 19/TS/Tailwind 4, GitHub Pages). No ToS changes, no schema, no API spend.
- Public repo: synthetic data only in tests, fixtures, screenshots and PR text.
- Tierra's standing rules apply (no AI attribution, never touch `main`, Tierra merges).
- Pages caches JS for about 10 minutes; hard-refresh after each merge.

## 8. Mockups

Local only (git-ignored): `.superpowers/brainstorm/335-1794808923/content/` — `home-layout.html` (B chosen), `phone-nav-v3.html` (A, bottom bar), `book-page.html` (B, tabs), `cards.html` (A, titles under covers), `palette.html` (A, amber on slate), `filters.html` (A, panel under the toolbar).
