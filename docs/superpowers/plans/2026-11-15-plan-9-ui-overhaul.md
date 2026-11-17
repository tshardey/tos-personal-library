# Plan 9 — UI Overhaul Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The whole library app becomes one consistent dark app. It gets named navigation (a bottom tab bar on the phone, a top row on the computer), a library page with a pinned slim toolbar, a filters panel, active-filter chips, sort and cover sizes, and a two-column book page with tabs. No feature is lost and no behaviour changes on the restyled screens.

**Architecture:**
- **Colours** live as Tailwind 4 `@theme` tokens in `src/index.css`. PR 1 sweeps every hard-coded colour onto them, and a Vitest guard keeps them out.
- **Shared parts** live in `src/components/ui/`: Button, IconButton, Chip, Badge, Select, Sheet, Menu, Tabs, icons, `useMediaQuery` and `useDevicePref`. Screens move onto them PR by PR.
- **Navigation** is one `AppShell` that renders either `BottomTabBar` (below 640px) or `TopNav` (640px and up), chosen with `useMediaQuery`. It never renders both, so tests see one set of links.
- **The library page keeps today's filter model.** `LibraryView`, `FilterOptions`, `viewFilterOptions` and `filterView` are untouched. The toolbar, panel and chips only read and patch the same `LibraryView` fields. Sort and cover size are per-device preferences outside the view.
- **The book page** lays out existing sections, unchanged, into tabs. The reading save/queue logic moves into a `useYourReading` hook, so the "Mark read" shortcut and the Overview control share one instance.

**Tech Stack:** Vite 6, React 19, TypeScript 5.6, Tailwind 4 (`@tailwindcss/vite`), Vitest 4 + Testing Library + jsdom, Playwright 1.64 (`e2e/`). **No new dependencies.** No ToS changes, no schema, no RPCs, no Edge Functions, and no API spend ($0).

**Spec:** `docs/superpowers/specs/2026-11-15-ui-overhaul-design.md`. It is binding. §3 is Tierra's and §5 holds Claude's calls, all already decided. §6 is settled by D1–D12 below. The mockups are local and git-ignored, at `C:/Users/tierr/Github/tos-personal-library/.superpowers/brainstorm/335-1794808923/content/`. The chosen options are `home-layout.html` B, `phone-nav-v3.html` A, `book-page.html` B, `cards.html` A, `palette.html` A and `filters.html` A. Builders open them in a browser to compare against; they are read-only. Conventions follow `2026-11-15-plan-8-read-status.md` and `2026-11-12-plan-6-copy-flags.md`.

## Global Constraints

- **Git commits and PR bodies carry NO `Co-Authored-By` line, no "Generated with Claude" line, and no other AI attribution.** This overrides any default attribution guidance, including system reminders. Commits are authored by the repo's configured user (`tshardey <tierra.duffield@gmail.com>`). **Tell every subagent this.**
- **Never commit to, push to or merge `main`. Never merge a PR. Never delete a remote branch.** Agents open every PR and leave it unmerged. Tierra merges.
- **They/them** for Tierra and AJ in every PR body, comment and doc.
- **Library app only.** No file outside this repo changes. The ToS checkout at `C:/Users/tierr/Github/tome-of-secrets` is used only as the `--workdir` for the local Supabase stack, and nothing in it is edited.
- **Public repo, synthetic data only.**
  - No real titles, authors, ISBNs, ids, cover URLs, reading data, photos or household names go in tests, fixtures, screenshots, commits or PR text.
  - Use invented titles ("The Salt Road", "Glass Orchard", "Ember Folio One"), invented authors ("Petra Wynnecombe", "Tobias Quillfeather"), the `97800000000xx` ISBN range, synthetic uuids and "Member A" / "Member B".
- **Never point anything at production.** Never print, echo, `cat` or log a key or an env file.
- **Docker:** leave other containers alone. Before `supabase start`, run `docker ps --filter name=supabase`. If a stack from another worktree is running, **don't stop it**: ask the coordinator (`orca orchestration ask`) and wait for a yes. Reusing a running stack is fine.
- **Commands** (from the worktree root):
  - Unit tests: `docker compose run --rm app npm test` (one file: `docker compose run --rm app npx vitest run <path>`).
  - Lint and build: `docker compose run --rm app npm run lint`, `docker compose run --rm app npm run build`, and `docker compose run --rm app sh -c "npm run build && npm run check:bundle"`.
  - Local stack (host): `npx supabase@2.122.1 start --workdir C:/Users/tierr/Github/tome-of-secrets`, then `npx supabase@2.122.1 status --workdir C:/Users/tierr/Github/tome-of-secrets` for the local publishable key. Don't print the key in a PR or a report.
  - E2E: `E2E_SUPABASE_PUBLISHABLE_KEY=<local key> docker compose run --rm e2e npx playwright test`.
  - Screenshots: the same command with `-e E2E_SCREENSHOTS=1 -e E2E_SCREENSHOT_DIR=.superpowers/screenshots/plan9/pr<N>` and `e2e/visual.spec.ts` (Task 7).
- **Screenshots** go only under `.superpowers/screenshots/plan9/pr<N>/`. `.superpowers/` is already in `.gitignore`. Check `git status --short` shows no `.png` before every commit.
- **Keep shell commands simple.** No brace-group redirects, no long multi-line quoted strings. Write PR bodies to a file in the scratchpad and pass `--body-file`.
- **Reuse, don't fork:**
  - `useCoverFinder().available/reviewCount`, `useTagging().available`, `useReading()`, `readingStats`, `readCatalogCache`, `localDay`;
  - `readStatusOptions` (for chip labels), `dayLabel`, `groupTags`/`isSharedTag`, `editionLabels`, `seriesNames`;
  - `bookBadges`, `stateFor`;
  - the `memoryStorage` idea in `ScanPage.tsx` (a failed `localStorage` must never break a page);
  - the e2e helpers `newUserWithHousehold`, `signIn`, `rest`, `newMemberOf` (`e2e/supabase.ts`) and `insert` (`e2e/tag-jobs.ts`).
- **`localStorage` keys this plan adds:** `tpl_library_sort`, `tpl_cover_size` and `tpl_book_tab`. Each is read and written only through `useDevicePref` (Task 3).
- **Accessible names stay stable where tests use them.** Unless a task says otherwise, keep: `Search books`, `Ask ✨`, `Select`, `Select all`, the `Selection` region, `Edit selected books`, `Edition`, `Series`, `Covers`, `Date added`, `Published from`, `Published to`, `ToS tags`, `Deluxe`, `Signed`, `Unhauled`, `Back to library`, `Edit book`, `Delete book`, `Add copy`, the `Your reading` group, `Our Library`, and the single `p[aria-live='polite']` book count on the library page.

## Decisions

These settle spec §6 and the brief.

**D1. PR split, bases and merge order.**

| # | Branch | Based on | Tasks | Users see after merge |
|---|---|---|---|---|
| 1 | `tshardey/ui-overhaul-design` (already carries the spec and this plan) | `main` (it is already based there) | 1–7 | The whole app is dark. The new navigation (bottom tab bar, Add chooser, More, Covers tab). Every screen still has today's layout, now in the new colours. |
| 2 | `tshardey/ui-library-page` | `origin/main` **after PR 1 merges** | 8–13 | Pinned toolbar, filters panel, chips, sort, cover sizes, new cards with read badges |
| 3 | `tshardey/ui-book-page` | `origin/main` after PR 1 merges | 14–16 | Two-column book page with tabs and Mark read |
| 4 | `tshardey/ui-restyle-screens` | `origin/main` after PR 1 merges | 17–19 | The remaining screens on the shared parts, with comfortable widths |
| — | (no branch) | — | 20 | Whole-scope review; fixes land on whichever PR owns the code |

- **They don't stack.** PR 1 puts every shared part, token and the nav in place. PRs 2, 3 and 4 then each touch their own screens only, so each branches from `origin/main` once PR 1 is merged. They can be built in parallel and merged in any order.
  - *Why:* Tierra merges, and a PR based on `main` never needs retargeting.
- **Files PRs 2–4 might all touch:** `e2e/visual.spec.ts` (each adds routes) and `src/components/ui/*` (only if a part needs a small extension). Before opening each of PRs 2–4, run `git fetch origin` and `git rebase origin/main`, then rerun the gates.
- **No stacking (Tierra, 2026-11-15):** if PR 1 is still unmerged when a builder is ready for PR 2/3/4, the builder waits. Don't branch from `tshardey/ui-overhaul-design`.
- **Every PR leaves the app working and fully dark.** PR 1's colour sweep (Task 2) covers every screen, so later PRs change layout and parts, not readability.
- **Rollback:** each PR is a plain frontend change. Reverting any one restores the previous look, with no data effect. Reverting PR 1 after 2–4 have merged needs those reverted first, since they import `src/components/ui/`.

**D2. Tokens (spec §3.5, §5.2), with WCAG ratios.** Defined in `@theme` in `src/index.css`, so classes read `bg-surface`, `text-muted` and so on:

| Token | Value | Use |
|---|---|---|
| `--color-surface` | `#0f1115` | page background |
| `--color-raised` | `#171a21` | header, bars, cards, sheets, menus |
| `--color-control` | `#232835` | buttons, inputs, chips, placeholders |
| `--color-line` | `#262a33` | dividers, card borders (decorative) |
| `--color-line-strong` | `#2f3440` | sheet and menu edges (decorative) |
| `--color-field` | `#6b7285` | **input, select, checkbox and secondary-button borders** (≥3:1, D11) |
| `--color-fg` | `#e6e6e6` | body text |
| `--color-fg-strong` | `#ffffff` | headings |
| `--color-muted` | `#8a909c` | secondary text |
| `--color-accent` | `#e8b44c` | active filter, selected book, current tab, primary button, focus ring |
| `--color-on-accent` | `#111111` | text on accent |
| `--color-danger` | `#f2726b` | errors (never the accent) |
| `--color-danger-surface` | `#3a1d1f` | error box background |
| `--color-success` | `#7ccf96` | read badge, success text, scan accept flash |
| `--color-notice` | `#2a2619` | notice banners (formerly `amber-50/100`) |
| `--color-notice-line` | `#5c4d24` | notice banner border |

Contrast, computed with the WCAG 2.x formula (Task 1's test pins these):

| Foreground | on surface | on raised | on control | Needs |
|---|---|---|---|---|
| fg `#e6e6e6` | 15.14 | 13.95 | 11.80 | 4.5 |
| fg-strong `#fff` | 18.90 | 17.41 | 14.72 | 4.5 |
| muted `#8a909c` | 5.89 | 5.43 | **4.59** | 4.5 |
| accent `#e8b44c` (text, focus ring) | 9.96 | 9.17 | 7.76 | 4.5 / 3 |
| danger `#f2726b` | 6.65 | 6.13 | 5.18 | 4.5 |
| success `#7ccf96` | 10.10 | 9.30 | 7.87 | 4.5 |
| field `#6b7285` (borders) | 3.93 | 3.62 | 3.06 | 3 (non-text) |
| on-accent `#111` on accent | 9.95 | | | 4.5 |
| danger on danger-surface | 5.38 | | | 4.5 |

- `muted` on `control` (4.59) is the tightest pair. **Don't darken `muted` or lighten `control`** without rerunning the test.
- `line` and `line-strong` (1.2–1.5:1) are decorative only. No control relies on them to be seen.

**D3. Breakpoints, spacing, type and layers (§6).**
- **One layout breakpoint, Tailwind `sm` = 640px.** Below it is the phone: bottom tab bar, filters in a bottom sheet, sort and size inside that sheet. From 640px up is the computer: top nav, filters panel under the toolbar, sort and size in the toolbar.
- **The book page goes two-column at `md` = 768px.**
- **Widths:** the library grid uses the full width. The book page is capped at `max-w-5xl` (1024px). The other screens use `max-w-3xl` (768px), centred.
- **Spacing:** Tailwind's 4px scale.
  - Page gutter `px-4` (16px), `sm:px-6` (24px). Gaps between groups are `gap-3`/`gap-4`.
  - Controls are `min-h-11` (44px) below `sm` and `sm:min-h-9` (36px) from `sm`. Icon buttons are `size-11` / `sm:size-9`.
- **Type:** the system font stack (no web font).
  - UI text and controls `text-sm` (14px); reading text (synopsis) `text-base` (16px).
  - Page titles `text-xl font-semibold text-fg-strong`; the book title `text-2xl md:text-3xl`.
  - Captions `text-xs text-muted`, used only for secondary text.
- **Heights:** phone header `h-12` (not sticky; it scrolls away). Desktop header `h-14`, `sticky top-0`. Bottom tab bar 56px plus `env(safe-area-inset-bottom)`.
  - `:root` defines `--nav-bottom: calc(56px + env(safe-area-inset-bottom))`. At `sm` it is `0px`.
  - `--toolbar-top: 0px` on the phone and `3.5rem` (the desktop header) from `sm`.
- **Layers:** content `z-0`, pinned toolbar `z-20`, fixed bottom bars `z-20`, header and bottom tab bar `z-30`, menus `z-40`, the scan camera view `z-40`, sheets `z-50` (portalled).

**D4. Cover size: five steps with − / + buttons (§5.5, §6).**
- **Buttons, not a slider.** A slider thumb is a poor phone target and has keyboard quirks. Two `IconButton`s, `Smaller covers` and `Larger covers`, are 44px targets, each disabled at its end. They sit in a `role="group" aria-label="Cover size"` with five `aria-hidden` dots showing the step.
- **Steps** (`src/lib/cover-size.ts`). Columns are computed for a 358px phone content width and a 1248px desktop width:

| Step | Phone columns | Min card width from 640px | Gap | Title/author | ≈ columns at 1280px |
|---|---|---|---|---|---|
| `1` | 5 | 64px | 8px | hidden (`sr-only`) | 17 |
| `2` | 4 | 88px | 8px | shown | 13 |
| `3` | 3 | 120px | 12px | shown | 9 |
| `4` (default, ≈ today) | 2 | 170px | 12px | shown | 6 |
| `5` | 1 | 240px | 16px | shown | 5 |

- Implemented as a `.cover-grid` class in `index.css`. It uses CSS variables set inline by `CoverWall`: `--cover-cols`, `--cover-min` and `--cover-gap`.
  - Below 640px: `grid-template-columns: repeat(var(--cover-cols), minmax(0, 1fr))`.
  - From 640px: `repeat(auto-fill, minmax(var(--cover-min), 1fr))`.
- Remembered as `tpl_cover_size`. An unknown value falls back to `4`.

**D5. Sort (§5.4).** `src/lib/sort-books.ts`. A native `<select aria-label="Sort">`.
- **Options:**
  - `title` **Title** (default): catalogue order, which is today's database `order("title")`. There is no client re-sort, so the default changes nothing.
  - `author` **Author**: the first author's surname key, then title.
    - The key is the last whitespace token, skipping a trailing `Jr`/`Sr`/`II`/`III`/`IV` (with or without a dot).
    - Compared with `Intl.Collator(undefined, { sensitivity: "base", numeric: true })`.
    - Books with no author go last.
  - `added` **Recently added**: the newest `createdAt` among all the book's copies, else the book's `createdAt`, newest first.
  - `published` **Published (newest first)**: compares year, then month and day when `publishDate` starts `YYYY-MM` or `YYYY-MM-DD`. Uses `publishYear` for the year. Books with no date go last.
- **Ties** keep catalogue order (a stable sort).
- **Series view:** always volume order, nulls last, then title (today's rule, moved here). The select is disabled and shows a single option, `Series order`.
- Remembered as `tpl_library_sort`. Unknown values fall back to `title`.
- **Sort is not part of `LibraryView`.** It doesn't clear Ask, doesn't enter `viewKey`, and doesn't change the Ask set or the Ask result order.

**D6. Filters map onto the existing model unchanged (§3.6, §6).**
- **No change to `LibraryView`, `DEFAULT_VIEW`, `FilterOptions`, `viewFilterOptions`, `filterView` or `askBookIds`.** Every panel control patches the same field today's `LibraryFilters` patches. The series stays in the route (`changeSeries`).
- **Panel groups** (`src/components/library/FiltersPanel.tsx`), in this order:
  1. **Reading** (only when `readStatusFilter` is given).
     - A `role="group" aria-label="Read status"` of pressed buttons: `Any`, `Unread`, `Read`, `Did not finish`.
     - A `For` select listing members, me first, labelled `For`. It shows only when the household has more than one member.
     - Mapping: `Any` → `readStatus: null`. Otherwise `{ userId: forMember, state }`.
     - `forMember` is `view.readStatus?.userId ?? me`, held in local state while `Any` is pressed.
     - This expresses exactly the option set of today's `readStatusOptions`; the state space is the same.
  2. **Owner & Copy:** the owner buttons `All` / `Shared` / each member (today's `aria-pressed` buttons), then `Deluxe` / `Signed` / `Unhauled`.
  3. **Tags & Series:** the `ToS tags` button (opens today's sheet), today's `LibraryTagFilter` (only when tagging is available), and the `Series` select.
  4. **Edition, Covers & Dates:** `Edition` (when labels exist), `Covers` (when covers are available), `Published from` / `Published to` (today's `YearInput`), and `Date added`.
  - Then `Clear all`.
- **Phone:** the same groups stack in a `Sheet` labelled `Filters`. A **View** group comes first, holding `Sort` and `Cover size`. The sheet closes with a `Done` button, Escape or the scrim.
- **Computer:** a non-modal `role="region" aria-label="Filters"`, inside the pinned block under the toolbar.
  - The four groups sit in a `sm:grid-cols-2 lg:grid-cols-4` grid, with `max-h-[60vh] overflow-y-auto`.
  - `Filters` toggles it (`aria-expanded`, `aria-controls`). Escape inside it closes it and returns focus to `Filters`.
- **The grid updates live.** Panel open state is local to `LibraryPage`, so it is closed again when you come back from a book.
- **Chips** (`activeFilterChips`, Task 9) come from the **effective** `view`, after `LibraryPage` drops a stale library-tag or read-status choice. A hidden filter never shows as a chip and never counts.
  - The `Filters` button reads `Filters`. With N active it reads `Filters` plus a `Badge` with N, accessible name `Filters, N active`.
  - The search query is not a chip; the box shows it.
- **Clear all** (in the panel and, with two or more chips, in the chips row) patches every filter field back to `DEFAULT_VIEW`'s value **except `query`**. With a series in the route it also calls `changeSeries(null)`.

**D7. Navigation (§3.2, §5.6, §5.7, §5.14).**
- **`Tab` becomes `"library" | "add" | "scan" | "covers" | "more"`.** `tabFor` maps:
  - `add`, `inbox`, `import` → `add`;
  - `scan` → `scan`;
  - `covers` → `covers`;
  - `tags`, `reading`, `editions` → `more`;
  - `library`, `book` → `library`.
- **Phone `BottomTabBar`** (`<nav aria-label="Main">`, fixed bottom, `bg-raised`, top border `line`): `Library` (link `#/`), `Add` (button, opens the Add sheet), `Scan` (link `#/scan`, a raised 56px accent circle in the centre slot), `Covers` (link `#/covers`) and `More` (button, opens the More sheet).
  - Each item has an icon over a `text-xs` label and a 44px+ target.
  - The current item has `aria-current="page"` and the accent colour. The Add/More buttons get it too when their tab is current.
- **Computer `TopNav`**, in the sticky header after `Our Library`: `Library`, `Add ▾` (a `Menu`), `Scan`, `Covers`, `More ▾` (a `Menu`). The current one has an accent underline and `aria-current="page"`.
- **Add chooser** (sheet title `Add books`, or the desktop menu), with three links:
  - `Type it in` → `#/add`, hint `Title, author or ISBN`;
  - `Photos` → `#/inbox`, hint `Read books from photos`;
  - `Import` → `#/import`, hint `A libib CSV export`.
- **More** (sheet title `More`, or the desktop menu), top to bottom:
  - the read summary `You've read {read} of {owned} ({pct}%)`, today's `AccountMenu` rule;
  - links `Reading history` (when reading is available), `Tag suggestions` (when tagging is available), `Edition labels`, `Import`, `Photos`;
  - then an account block: the email, `InviteCode`, and a `Sign out` button.
  - `AccountMenu.tsx` is deleted. The invite code leaves the top of the library page (§3.2 "account (email, invite code if relevant…)").
- **Covers tab:** always present. When `available && reviewCount > 0` it carries a `Badge` with the count, and its accessible name is `Covers, {n} to review` (the visible number is `aria-hidden`). `CoversBadge.tsx` is deleted.
  - On `#/covers` with the finder unavailable, the page says `The cover finder isn't available yet.`
- **The read summary also tops Reading history** (§5.7): the same sentence, from `readingStats` for the viewer, above the stats panel. It is omitted when `owned` is 0.
- **Fixed bottom bars sit above the tab bar.** A shared `BottomBar` (`fixed inset-x-0 bottom-[var(--nav-bottom)] z-20 bg-raised border-t border-line p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]`) replaces the three hand-made bars: the library selection bar, `CoverBatchFooter` and the `CoverReviewPage` footer.
  - **Safe area:** on the phone the bar sits above the tab bar, which already absorbs the inset. From `sm`, `--nav-bottom` is 0, so the `pb-[max(...)]` padding applies.
  - `<main>` gets `pb-[var(--nav-bottom)]` so the last row isn't hidden.

**D8. The scan camera with the tab bar (§6).** The scanning view (`fixed inset-0 z-10` in `ScanPage.tsx`) becomes `z-40`, above the tab bar (`z-30`), so the bar is covered while the camera runs.
- No new state, and the camera keeps the full screen.
- The pre-scan screen (Start scanning) shows the bar as usual.
- `TypeIsbnSheet`'s overlay inside the scan view moves from `z-30` to `z-50` in Task 6, then onto `Sheet` in Task 17.

**D9. Book page (§3.3, §5.8, §5.12, §5.13).**
- **Layout:** below `md`, one column. From `md`, a two-column grid (`md:grid-cols-[240px_1fr] gap-8`), capped at `max-w-5xl`.
  - **Left:** the cover (`w-40` phone, full 240px column on the computer), then `Edit book`, `FindCoverPanel` (its open button relabelled `Find cover`) and `MarkReadButton` (all three primary/secondary `Button`s), then the `⋯` `Menu`.
    - The menu button's accessible name is `More actions`. It holds `Add copy` (selects the Copies tab and opens the copy form) and `Delete book` (danger).
  - **Right:** `Back to library`, the title (`h2`), the authors, and a series line.
    - The series line is today's `SeriesPicker` button, plus `Show the rest of this series` when there is a series.
    - Then the tabs. `aria-label="Book sections"`. Their names are `Overview`, `Copies ({n})` (n = `book.copies.length`), `Tags` and `Tome of Secrets`.
- **Tab contents:** today's components, unchanged.
  - **Overview:** the synopsis (`text-base`) and `YourReadingControl`.
  - **Copies:** today's Copies section (counts note, unhauled note, `CopyList`, `CopyForm`, `Add copy`).
  - **Tags:** `LibraryTagsSection`. While tagging is unavailable it shows `Library tags aren't available yet.` (the tab stays, for a stable layout).
  - **Tome of Secrets:** `TosTagsSection`, with today's empty and unavailable text.
- **Editing:** `Edit book` replaces the right column's title block and tabs with `BookForm`, until Save or Cancel.
- **Remembered tab:** `tpl_book_tab` ∈ `overview | copies | tags | tos`, default `overview`. It is written on every tab change. `Add copy` from the menu also writes `copies`.
- **Mark read** (`MarkReadButton`), driven by the same `useYourReading` instance as the Overview control:
  - **unread:** the label is `Mark read`. A click calls `choose("read")`, so the date is the existing one or today's local day, through the same save/queue path.
  - **read:** a check icon (`aria-hidden`) and `Read`, with accessible name `Your reading: Read`.
  - **dnf:** `Did not finish`, with accessible name `Your reading: Did not finish`.
  - In the read and dnf states, a click selects Overview and focuses the `Your reading` group.
  - It is disabled while a save is running, and not rendered when `available` is false or `userId` is null.

**D10. Cards (§3.4).** `BookCard` keeps its link/label structure and `data-book-id`.
- **Corner badges on the cover:** Deluxe / Signed / Unhauled (`bookBadges`) bottom-left. The viewer's read state top-right: `✓ Read` (success) or `DNF` (muted on control). The select checkbox is top-left, so nothing collides.
- **Under the cover:** title and first author, each `line-clamp-1`. At step `1` both are `sr-only`, so the link name still holds the title.
- **Select mode:** today's checkbox (`accent-accent`, 24px) and a `ring-2 ring-accent ring-offset-2 ring-offset-surface` on selected covers.
- The read state comes from `useReading()` in `CoverWall` (`stateFor(byBook, id, userId)`), only when `available`.

**D11. Accessibility rules every PR follows (§5.10).**
- **Focus:** global `:focus-visible { outline: 2px solid var(--color-accent); outline-offset: 2px; }`. No `outline-none` without a replacement.
- **Targets:** 44×44px minimum for every control below `sm`, except inline text links inside a sentence.
- **Names:** every `IconButton` has an `aria-label`. Icons are `aria-hidden`.
- **Keyboard:**
  - `Menu` is a disclosure. Enter or Space opens it, Tab moves through its links, and Escape or an outside click closes it, with focus returned to the button on Escape.
  - `Sheet` is a modal dialog with `aria-modal`. It traps Tab and Shift+Tab, Escape closes it and returns focus to the opener, and an Escape inside a nested sheet closes only the inner one.
  - `Tabs` follow the WAI-ARIA tabs pattern: Left/Right/Home/End with roving `tabIndex` and automatic activation.
- **Reduced motion:** sheet and menu transitions only under `motion-safe:`. Plus a global `@media (prefers-reduced-motion: reduce)` rule setting animation and transition durations to `0.01ms` and `scroll-behavior: auto`.
- **Contrast:** the D2 table, pinned by `src/test/contrast.test.ts`.

**D12. Icons (§5.15).** `src/components/ui/icons.tsx`, a hand-drawn inline SVG set, no library.
- 24×24 `viewBox`, `fill="none"`, `stroke="currentColor"`, `strokeWidth={1.75}`, round caps and joins, `aria-hidden="true"`. `className` is passed through.
- Icons:
  - `LibraryIcon` (2×2 rounded squares), `PlusIcon`, `ScanIcon` (five vertical bars of varying width inside corner brackets), `CoversIcon` (a rect with a mountain and a sun), `MoreIcon` (three horizontal lines);
  - `SearchIcon`, `FilterIcon` (a funnel), `SelectIcon` (a rounded square with a tick), `MinusIcon`, `CloseIcon`, `CheckIcon`, `DotsIcon` (three dots), `ChevronDownIcon`, `SparkleIcon`.

## Review Focus

Each line has a test in the named task.

1. **Fixed bars against the bottom tab bar at 390px.** With the selection bar, the cover batch footer or the review footer up, every bar sits fully above the tab bar, and the last row of covers can scroll fully into view above both. *(Task 6 unit; Task 13 e2e.)*
2. **`localStorage` that throws, is blocked, or holds a stale value** (for example `tpl_cover_size = "9"`, `tpl_book_tab = "reading"` from a future version, `tpl_library_sort = ""`). The page renders with the defaults, the control still works for the session, and nothing is logged with data. *(Task 3; Task 10; Task 15.)*
3. **A stored filter that's being ignored:** library tags stored while tagging is unavailable, or a read status for a member who left. No chip shows, the `Filters` count leaves it out, and `Clear all` doesn't throw. *(Task 9; Task 11.)*
4. **Nested sheets and Escape:** the phone Filters sheet with the ToS tags sheet open on top, or `MassEditSheet` with `EditionPicker` open. One Escape closes only the top sheet, and focus returns to its opener inside the lower sheet. *(Task 4; Task 11; Task 12.)*
5. **A series route with a stored sort:** `#/series/<name>` with `tpl_library_sort = "author"` shows volume order. Removing the series chip goes to `#/` and the stored sort applies again. *(Task 8; Task 10.)*

---

## PR 1 — tokens, shared parts, dark base and navigation (`tshardey/ui-overhaul-design`)

The builder works in a worktree of `tshardey/ui-overhaul-design` (it already holds the spec and this plan).

### Task 1: Tokens, dark base and the contrast test

**Files:**
- Modify: `src/index.css`, `index.html`, `public/manifest.webmanifest`
- Create: `src/test/contrast.test.ts`, `src/lib/contrast.ts`

**Interfaces — Produces:**
```ts
// src/lib/contrast.ts
export function relativeLuminance(hex: string): number   // "#rrggbb"
export function contrastRatio(a: string, b: string): number
export function themeTokens(css: string): Record<string, string>  // "--color-x: #hex;" pairs inside @theme
```
CSS: the D2 tokens; `:root { color-scheme: dark; --nav-bottom; --toolbar-top }` per D3; and the `.cover-grid` class (D4).

- [ ] **Step 1: Write the failing test.** `contrast.test.ts` imports `src/index.css?raw` and calls `themeTokens`. It asserts every D2 value, and asserts each pair in the D2 table meets its "Needs" column:
  - fg, fg-strong, muted, accent, danger and success on surface, raised and control ≥ 4.5;
  - field on surface, raised and control ≥ 3;
  - on-accent on accent ≥ 4.5;
  - danger on danger-surface ≥ 4.5.
  - It also checks `contrastRatio("#8a909c", "#232835")` ≈ 4.59 (2 dp).
- [ ] **Step 2: Run it.** `docker compose run --rm app npx vitest run src/test/contrast.test.ts`. Expected: FAIL (no tokens).
- [ ] **Step 3: Implement.**
  - **`index.css`:** `@import "tailwindcss";`, then `@theme { …D2… }`, then `@layer base`:
    - `html, body` get `bg-surface text-fg`;
    - `*, ::before, ::after, ::backdrop, ::file-selector-button { border-color: var(--color-line); }`;
    - `input, select, textarea` get `background-color: var(--color-control); color: var(--color-fg); border-color: var(--color-field)`;
    - `::placeholder` is `var(--color-muted)`;
    - the D11 focus and reduced-motion rules;
    - and the `.cover-grid` rules.
  - **`index.html`:** `theme-color` becomes `#0f1115`, and add `<meta name="color-scheme" content="dark">`.
  - **Manifest:** `background_color` and `theme_color` become `#0f1115`.
- [ ] **Step 4: Run it.** Same command. Expected: PASS. `npm run build` also passes.
- [ ] **Step 5: Commit** `feat: dark colour tokens and base styles`.

### Task 2: Colour sweep and the palette guard

Every screen becomes readable on the dark base. This is a mechanical change only, with no layout changes.

**Files:**
- Modify: every `src/**/*.tsx` that uses a class in the table below (about 47 files)
- Create: `src/test/palette.test.ts`

**Mapping** (apply with care to variants like `hover:` and `disabled:`):

| Old | New |
|---|---|
| `bg-white`, `bg-white/90` | `bg-raised`, `bg-raised/90` |
| `bg-stone-100`, `bg-stone-200`, `hover:bg-stone-100` | `bg-control`, `hover:bg-control` |
| `bg-stone-800 text-white` (buttons, pressed chips) | `bg-accent text-on-accent` |
| `bg-stone-900` | `bg-surface` |
| other `text-white` | `text-fg-strong` (on accent: `text-on-accent`) |
| `text-stone-900` | `text-fg-strong` |
| `text-stone-500/600/700` | `text-muted` |
| `text-stone-300` | `text-fg` |
| `border-stone-300/400` | `border-field` |
| `border-stone-800`, `ring-stone-800`, `accent-stone-800` | `border-accent`, `ring-accent`, `accent-accent` |
| `text-red-700`, `bg-red-50`, `border-red-300` | `text-danger`, `bg-danger-surface`, `border-danger` |
| `bg-amber-50/100/200`, `border-amber-300/400`, `text-amber-800/900` | `bg-notice`, `border-notice-line`, `text-fg` |
| `border-green-500` / `border-amber-500` (scan flash) | `border-success` / `border-accent` |
| `border-white/80` | `border-fg-strong/80` |
| `bg-black/40`, `bg-black/80`, `bg-black` (scrims, camera) | unchanged (allowed) |

- [ ] **Step 1: Write the failing test.** `palette.test.ts` loads every `src/**/*.tsx` that isn't a test, via `import.meta.glob("/src/**/*.tsx", { query: "?raw", import: "default", eager: true })`.
  - It asserts no file matches `/\b(?:bg|text|border|ring|accent|divide|outline|from|to|placeholder)-(?:white|stone|gray|slate|zinc|neutral|red|amber|yellow|green|emerald|blue)\b/`.
  - The message names each file and class.
- [ ] **Step 2: Run it.** Expected: FAIL, listing the files.
- [ ] **Step 3: Apply the mapping.** Prefer the table's choice. Where a primary button and a selected state would look the same (today's `bg-stone-800` on an `aria-pressed` chip), both become accent. That is the spec's meaning of accent.
- [ ] **Step 4: Run the guard and every unit test.** `docker compose run --rm app npm test`. Expected: PASS, with no existing test edited (no test asserts colour classes). Also run `npm run lint` and `npm run build`.
- [ ] **Step 5: Commit** `style: move every screen onto the dark colour tokens`.

### Task 3: Static shared parts, icons, `useMediaQuery` and `useDevicePref`

**Files:**
- Create: `src/components/ui/Button.tsx`, `IconButton.tsx`, `Chip.tsx`, `Badge.tsx`, `Select.tsx`, `icons.tsx`, `index.ts`; `src/hooks/useMediaQuery.ts`; `src/lib/device-prefs.ts`
- Tests: `src/components/ui/parts.test.tsx`, `src/hooks/useMediaQuery.test.ts`, `src/lib/device-prefs.test.ts`

**Interfaces — Produces:**
```ts
type Variant = "primary" | "secondary" | "ghost" | "danger";
Button(props: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: "md" | "sm" })  // default secondary, md
buttonClass(variant?: Variant, size?: "md" | "sm"): string   // for <a> styled as a button
IconButton(props: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; children: ReactNode })  // aria-label = label
Chip(props: { label: string; onRemove?(): void; pressed?: boolean; onClick?(): void })
  // with onRemove: text + a remove button named `Remove filter: ${label}`; with onClick: an aria-pressed toggle
Badge(props: { children: ReactNode; tone?: "accent" | "success" | "muted"; className?: string })
Select(props: SelectHTMLAttributes<HTMLSelectElement> & { label?: string })   // native select, token styles; label → aria-label
// icons.tsx: the D12 components, each (p: { className?: string }) => JSX
useMediaQuery(query: string): boolean    // useSyncExternalStore on matchMedia; false when matchMedia is missing
export const DESKTOP = "(min-width: 640px)";   // the book page's md: columns are CSS only
// device-prefs.ts
readPref<T extends string>(key: string, allowed: readonly T[], fallback: T): T   // try/catch; unknown → fallback
writePref(key: string, value: string): void   // try/catch; failure ignored silently
useDevicePref<T extends string>(key: string, allowed: readonly T[], fallback: T): [T, (v: T) => void]
  // React state seeded from readPref; the setter updates state even when the write throws
```
- Variant styles:
  - primary: `bg-accent text-on-accent`;
  - secondary: `bg-control text-fg border border-field`;
  - ghost: `text-fg hover:bg-control`;
  - danger: `bg-danger-surface text-danger border border-danger`.
- Every part gets D3 heights and `disabled:opacity-50`.

- [ ] **Step 1: Write the failing tests:**
  - **Button:** `Button variant="primary"` renders a `button` of `type="button"` by default, and passes `disabled` through.
  - **IconButton:** `IconButton label="Smaller covers"` is found by `getByRole("button", { name: "Smaller covers" })`, and its svg has `aria-hidden="true"`.
  - **Chip:**
    - with `onRemove`, it shows `Deluxe` and a button `Remove filter: Deluxe` that calls `onRemove`;
    - with `pressed`, the button has `aria-pressed="true"`.
  - **Select:** `Select label="Sort"` is found by `getByLabelText("Sort")`.
  - **`useMediaQuery`:**
    - false with no `window.matchMedia`;
    - true when a stub matches;
    - updates when the stub fires `change`.
  - **Device prefs:**
    - `readPref("k", ["a", "b"], "a")` returns `"b"` when stored `"b"`, and `"a"` for stored `"z"`, for missing, and when `getItem` throws (`vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked") })`);
    - `writePref` doesn't throw when `setItem` throws;
    - `useDevicePref`'s setter changes the returned value even when `setItem` throws (**Review Focus 2**).
- [ ] **Step 2: Run them.** `docker compose run --rm app npx vitest run src/components/ui src/hooks/useMediaQuery.test.ts src/lib/device-prefs.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** per the Interfaces.
- [ ] **Step 4: Run them.** Expected: PASS.
- [ ] **Step 5: Commit** `feat: shared button, chip, badge, select, icons and device preferences`.

### Task 4: Interactive shared parts — Sheet, Menu, Tabs

**Files:**
- Create: `src/components/ui/Sheet.tsx`, `Menu.tsx`, `Tabs.tsx`; tests `Sheet.test.tsx`, `Menu.test.tsx`, `Tabs.test.tsx`

**Interfaces — Produces:**
```ts
Sheet(props: {
  label: string;                 // aria-label of the dialog
  title?: string;                // visible heading (h2) when given
  onClose(): void;
  children: ReactNode;
  footer?: ReactNode;            // sticky bottom row
  initialFocus?: RefObject<HTMLElement | null>;   // else the first focusable
  className?: string;            // merged onto the dialog element
})
```
- `Sheet` is portalled to `document.body`: a scrim (`bg-black/60`, a click closes) and a `role="dialog" aria-modal="true"`.
  - Below `sm` it's a bottom sheet (`rounded-t-xl`, `max-h-[85dvh]`, `pb-[env(safe-area-inset-bottom)]`). From `sm` it's centred, `max-w-lg rounded-xl`.
  - It uses `bg-raised border-line-strong`. The body is `overflow-y-auto`.
  - Keydown on the dialog element itself: Tab/Shift+Tab wrap within it, and Escape calls `onClose` and `stopPropagation()`.
  - On unmount, focus returns to the element focused before it opened.
```ts
Menu(props: {
  label: string;                         // the button's accessible name
  button: ReactNode;                     // its visible content
  align?: "start" | "end";
  children(close: () => void): ReactNode; // the panel content
  current?: boolean;                     // aria-current="page" on the button
})
```
- `Menu` is a disclosure: a button with `aria-expanded` and `aria-controls`, and a panel (`absolute z-40 bg-raised border border-line-strong rounded-lg shadow-lg p-2 min-w-56`).
  - It closes on an outside `pointerdown`, on Escape (focus back to the button), and when `close()` is called.
```ts
Tabs<T extends string>(props: {
  label: string;
  tabs: readonly { id: T; label: string }[];
  value: T;
  onChange(id: T): void;
  panel(id: T): ReactNode;               // only the current panel renders
})
```
- `Tabs`:
  - The tablist is `role="tablist" aria-label={label}`.
  - Each tab is a `button role="tab"` with `aria-selected`, `aria-controls` and `tabIndex` 0 when current, else -1. The current one has an accent underline.
  - The panel is `role="tabpanel"` with `aria-labelledby` and `tabIndex={0}`.
  - Left/Right wrap, and Home/End jump. Each key moves focus and calls `onChange` (automatic activation).

- [ ] **Step 1: Write the failing tests:**
  - **Sheet:**
    - renders in `document.body` with role `dialog` named by `label`;
    - focuses `initialFocus`, else its first button;
    - Tab from the last focusable goes to the first, and Shift+Tab from the first goes to the last;
    - Escape calls `onClose`, and focus returns to the opener after unmount;
    - a scrim click calls `onClose` and a click inside doesn't;
    - **two nested sheets: Escape in the inner one calls only the inner `onClose` (Review Focus 4).**
  - **Menu:**
    - the button has `aria-expanded="false"`, and clicking shows the panel with `aria-expanded="true"`;
    - Escape closes it and focuses the button;
    - a `pointerdown` outside closes it;
    - `close()` from a child link closes it;
    - `current` sets `aria-current="page"`.
  - **Tabs:**
    - three tabs, with the current one `aria-selected`;
    - ArrowRight from the last goes to the first and calls `onChange`;
    - End and Home;
    - only the current panel is in the DOM, labelled by its tab.
- [ ] **Step 2: Run them.** `docker compose run --rm app npx vitest run src/components/ui`. Expected: FAIL.
- [ ] **Step 3: Implement.** The sheet's motion is `motion-safe:transition` only.
- [ ] **Step 4: Run them.** Expected: PASS.
- [ ] **Step 5: Commit** `feat: shared sheet, menu and tabs with keyboard support`.

### Task 5: The navigation shell — bottom tab bar, top nav, Add chooser, More, Covers tab

**Files:**
- Create: `src/components/nav/AppShell.tsx`, `BottomTabBar.tsx`, `TopNav.tsx`, `AddChooser.tsx`, `MoreMenu.tsx` (holding `MoreContent`), `CoversTab.tsx`; tests `src/components/nav/nav.test.tsx`, `MoreMenu.test.tsx` (replacing `AccountMenu.test.tsx`)
- Modify: `src/lib/router.ts` (`Tab`, `tabFor`), `src/lib/router.test.ts`, `src/App.tsx`, `src/App.test.tsx`
- Delete: `src/components/nav/TabBar.tsx`, `AccountMenu.tsx`, `AccountMenu.test.tsx`, `src/components/covers/CoversBadge.tsx`

**Interfaces:**
- **Consumes:** Task 3 (`IconButton`, `Badge`, icons, `useMediaQuery(DESKTOP)`) and Task 4 (`Sheet`, `Menu`).
- **Produces:**
```ts
export type Tab = "library" | "add" | "scan" | "covers" | "more";
tabFor(route: Route): Tab                                    // D7
AppShell(props: { route: Route; email: string | undefined; onSignOut(): void; children: ReactNode })
  // header (phone h-12 static; desktop h-14 sticky top-0 z-30 with TopNav), banners slot, <main className="pb-[var(--nav-bottom)]">, BottomTabBar on phone
MoreContent(props: { email: string | undefined; onSignOut(): void; onNavigate(): void })   // D7 More list, shared by the sheet and the menu
AddLinks(props: { onNavigate(): void })                    // the three D7 links, shared
CoversTab(props: { variant: "bar" | "top"; current: boolean })
```
- `App.tsx` wraps today's route switch in `AppShell`, and keeps `CoverStopBanner`/`TagStopBanner` as children above the page. The `InviteCode` block on the library route is removed (it now lives in More).

- [ ] **Step 1: Write the failing tests.**
  - **`router.test.ts`:** `tabFor` for every route per D7 (`inbox` → `add`, `tags` → `more`, `covers` → `covers`, `book` → `library`).
  - **`nav.test.tsx`, phone (no matchMedia):**
    - one `navigation` named `Main` with links `Library`, `Scan`, `Covers` and buttons `Add`, `More`;
    - on `#/inbox` the `Add` button has `aria-current="page"`;
    - **Add chooser:** `Add` opens dialog `Add books` with links `Type it in` → `#/add`, `Photos` → `#/inbox`, `Import` → `#/import`; clicking one closes it; Escape closes it and focuses `Add`.
    - **More:** `More` opens dialog `More`, holding in order `Reading history` (reading available), `Tag suggestions` (tagging available), `Edition labels`, `Import`, `Photos`, the email, the invite code `abc123`, and `Sign out`. Sign out calls `onSignOut`.
    - **Covers tab states:**
      - with the finder available and `reviewCount` 3, link `Covers, 3 to review` → `#/covers`;
      - with 0, link `Covers` and no badge;
      - with the finder unavailable, link `Covers` still present.
  - **`nav.test.tsx`, desktop (a `matchMedia` stub matching `(min-width: 640px)`):**
    - no bottom bar;
    - the header holds `Our Library` and `Main` nav with `Add` and `More` as `Menu` buttons (`aria-expanded`);
    - `More` opens a panel with the same items, and Escape closes it and focuses the button;
    - only one `navigation` named `Main` exists.
  - **`MoreMenu.test.tsx`:** today's four `AccountMenu` reading cases, moved to opening `More`: the summary `You've read 2 of 3 (67%)`, no summary without a cache, none when owning nothing, neither when unavailable.
  - **`App.test.tsx` updates:**
    - the navigation `it.each` becomes `[aria-current="page"]` elements, so it finds the buttons too: `#/` Library, `#/scan` Scan, `#/inbox` Add, `#/import` Add, `#/add` Add, `#/book/b1` Library, `#/covers` Covers, `#/tags` More;
    - "follows the route" goes to `#/import` → `Add`;
    - "invite code only there" becomes "the invite code is in More": it is not on the library page body, and it is in More;
    - every `getByRole("button", { name: "Account" })` becomes `More`;
    - the "account menu" describe becomes "More": it opens, Escape closes it, and it signs out.
- [ ] **Step 2: Run them.** `docker compose run --rm app npx vitest run src/components/nav src/lib/router.test.ts src/App.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement** per D3 and D7. The bottom bar's centre `Scan` is a 56px circle (`bg-accent text-on-accent`), raised `-mt-4`, with its label under it.
- [ ] **Step 4: Run them, then the whole suite.** `docker compose run --rm app npm test`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: bottom tab bar, top nav, Add chooser and More`.

### Task 6: Bottom bars, scan layering, Covers unavailable and the Reading history summary

**Files:**
- Create: `src/components/ui/BottomBar.tsx`, `BottomBar.test.tsx`
- Modify: `src/components/library/LibraryPage.tsx` (selection bar → `BottomBar`), `src/components/covers/CoverBatchFooter.tsx`, `src/components/covers/CoverReviewPage.tsx` (footer → `BottomBar`; the unavailable message), `src/components/scan/ScanPage.tsx` (`z-10` → `z-40`), `src/components/scan/TypeIsbnSheet.tsx` (`z-30` → `z-50`), `src/components/reading/ReadingHistoryPage.tsx` (summary)
- Tests: `CoverBatchFooter.test.tsx`, `CoverReviewPage.test.tsx`, `ReadingHistoryPage.test.tsx`

**Interfaces — Produces:**
- `BottomBar(props: { label?: string; children: ReactNode })` renders the D7 classes. With `label`, it gets `role="region" aria-label={label}`, so the library passes `Selection`.

- [ ] **Step 1: Write the failing tests:**
  - **`BottomBar`:** its class list contains `bottom-[var(--nav-bottom)]` and `safe-area-inset-bottom` (**Review Focus 1**, unit half). With `label="Selection"`, it is a region named `Selection`.
  - **`CoverBatchFooter.test.tsx`:** the existing `safe-area-inset-bottom` assertion still passes, now through `BottomBar`.
  - **`CoverReviewPage.test.tsx`:** with the finder unavailable, it shows `The cover finder isn't available yet.` and no rows.
  - **`ReadingHistoryPage.test.tsx`:** with 2 of 3 owned books read, the page starts with `You've read 2 of 3 (67%)`; with nothing owned there is no such line.
  - **`ScanPage.test.tsx`:** while scanning, the scan view's root has class `z-40` (D8).
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement.** The selection bar keeps its content and names (`N selected`, `Clear`, `Done`, `Edit`).
- [ ] **Step 4: Run the whole suite.** Expected: PASS (`ScanPage.test.tsx` included).
- [ ] **Step 5: Commit** `feat: bottom bars sit above the tab bar; camera covers it; covers and reading notes`.

### Task 7: PR 1 e2e, visual and accessibility checks, and the PR

**Files:**
- Create: `e2e/nav.spec.ts`, `e2e/visual.spec.ts`, `e2e/a11y.ts` (helpers)
- Modify: `e2e/edition-labels.spec.ts`, `e2e/reading-history.spec.ts` (`Account` → `More`), `e2e/scan.spec.ts` (camera covers the bar)

**Interfaces — Produces (e2e helpers, for later tasks):**
```ts
// e2e/a11y.ts
export async function expectTapTargets(page: Page, scope: Locator, min = 44): Promise<void>
  // every visible button, link, [role=tab], select and input[type=checkbox] in scope has a box >= min x min
  // (a checkbox may meet it through its wrapping label); skips links inside <p>
export async function expectFocusRing(page: Page, target: Locator): Promise<void>
  // after keyboard focus: computed outline-style solid, outline-color = rgb(232, 180, 76)
export async function seedShelf(user: TestUser, n: number): Promise<{ id: string; title: string }[]>
  // n invented books ("The <First> <Second> <nnnn>" pattern of e2e/routes.ts), authors from SURNAMES,
  // one copy each, every 5th Deluxe, every 7th Signed; coverUrl `https://covers.invalid/<i>.svg` on two thirds
export async function routeFakeCovers(page: Page): Promise<void>
  // answers https://covers.invalid/* with a generated two-colour SVG gradient
```
`visual.spec.ts`:
- skipped unless `E2E_SCREENSHOTS=1`;
- seeds `seedShelf(user, 36)` and two members;
- for each width in `[390, 1280]` and each named state in its `STATES` list, it calls `page.screenshot({ path: `${dir}/${state}-${width}.png`, fullPage: false })`, where `dir = process.env.E2E_SCREENSHOT_DIR ?? ".superpowers/screenshots/plan9/current"`;
- PR 1's states: `library`, `add-chooser`, `more`, `covers-tab`, `scan-start`, `book`, `reading-history`, `tag-suggestions`, `edition-labels`, `import`, `photos`, `covers-review`, `sign-in` (in a signed-out context).

- [ ] **Step 1: Update the existing specs.** In `edition-labels.spec.ts` and `reading-history.spec.ts`, the `Account` button becomes `More`, and then the same links are clicked. In `scan.spec.ts`, once the camera runs, add a check: `document.elementFromPoint(195, 820)` lies inside the scan view, not the `Main` nav.
- [ ] **Step 2: Write `e2e/nav.spec.ts`** at 390px:
  - every bar item is reachable: `Library`, `Scan` and `Covers` load their routes;
  - **Add:** `Add` → `Type it in` reaches `#/add`;
  - **More:** `More` → `Edition labels` reaches its page;
  - **Covers tab:** with no searches waiting, the tab reads `Covers` and the page shows its empty or unavailable text;
  - **tap targets:** `expectTapTargets` on the bar, and on each of the Add and More sheets;
  - **keyboard:** Tab to `More`, Enter opens it, Tab reaches `Sign out`, Escape closes it and focus is back on `More`, with `expectFocusRing` on it;
  - **reduced motion:** with `page.emulateMedia({ reducedMotion: "reduce" })`, the open More sheet's computed `transition-duration` is `0s` or `1e-05s`.
  - At 1280px: the top nav shows, the bottom bar doesn't, and `More` opens a menu that Escape closes.
- [ ] **Step 3: Run the e2e suite** with the Global Constraints command. Expected: PASS, every existing spec included.
- [ ] **Step 4: Visual check.** Run `visual.spec.ts` with `E2E_SCREENSHOT_DIR=.superpowers/screenshots/plan9/pr1`. Open each screenshot next to the mockups (`palette.html` A, `phone-nav-v3.html` A). Check:
  - no light panel and no unreadable text;
  - the bar is not covering content;
  - the camera view (`scan.spec` run) is full-screen.
  Record anything off in the PR body as a follow-up, or fix it now if it's in PR 1's scope. `git status --short` shows no `.png`.
- [ ] **Step 5: Accessibility check.** Run Lighthouse's accessibility audit (`chrome-devtools-mcp` `lighthouse_audit`, local dev server, a synthetic user signed in) on `#/` at 390px and 1280px. Expected: no `color-contrast`, `button-name`, `link-name` or `aria-*` failures. Note the scores in the PR body. Keyboard pass by hand: More, Add, the sheets, Escape and focus return.
- [ ] **Step 6: Gates.** `npm test`, `npm run lint`, `npm run build`, `check:bundle`, e2e.
- [ ] **Step 7: Commit and open PR 1.**
  - Commit `test: e2e for the new navigation, visual and accessibility helpers`.
  - Push `tshardey/ui-overhaul-design` and open a PR to `main`, titled `UI overhaul 1: dark theme, shared parts and navigation`, left unmerged.
  - **The body** (written to a scratchpad file, passed with `--body-file`) covers:
    - what changed;
    - D1 (PRs 2–4 branch from `main` after this merges);
    - the test and e2e results;
    - the Lighthouse notes;
    - that screenshots were checked locally and aren't committed;
    - `Hard-refresh after merge (Pages caches JS for about 10 minutes).`
  - No AI attribution.

---

## PR 2 — the library page (`tshardey/ui-library-page`, from `origin/main` after PR 1 merges)

### Task 8: `sortBooks` and the cover-size steps

**Files:**
- Create: `src/lib/sort-books.ts`, `src/lib/sort-books.test.ts`, `src/lib/cover-size.ts`, `src/lib/cover-size.test.ts`

**Interfaces — Produces:**
```ts
export type SortKey = "title" | "author" | "added" | "published";
export const SORT_KEYS: readonly SortKey[];
export const SORT_LABELS: Record<SortKey, string>;   // "Title", "Author", "Recently added", "Published (newest first)"
export function authorSortKey(name: string): string;
export function sortBooks(books: BookWithCopies[], sort: SortKey, opts?: { series?: string | null }): BookWithCopies[]  // D5; never mutates
export type CoverSize = "1" | "2" | "3" | "4" | "5";
export const COVER_SIZES: readonly CoverSize[];
export const DEFAULT_COVER_SIZE: CoverSize;  // "4"
export const COVER_STEPS: Record<CoverSize, { phoneCols: number; minPx: number; gapPx: number; showText: boolean }>  // D4 table
```

- [ ] **Step 1: Write the failing tests** (`bookFixture`/`copyFixture` from `flag-fixtures.test-util`; invented names):
  - **`title`:** returns catalogue order unchanged, a new array.
  - **`author`:**
    - `Ines Dravenholt` sorts before `Petra Wynnecombe` (surname order);
    - `authorSortKey("Tobias Quillfeather Jr.")` = `quillfeather`;
    - `Émile Abernathy` sorts with `abernathy` (accent-insensitive);
    - no author goes last;
    - equal surnames are ordered by title.
  - **`added`:** a book whose second copy is newest comes first; a book with no copies uses its own `createdAt`.
  - **`published`:** `2021-05` before `2021-02-10`, before `2021`, before `2019`; `null` last; ties keep catalogue order.
  - **Series:** with `series: "Lantern Cycle"`, every key gives volume order with 2.5 between 2 and 3 and nulls last (**Review Focus 5**, unit half).
  - **Cover size:** `COVER_STEPS["4"]` is `{ phoneCols: 2, minPx: 170, gapPx: 12, showText: true }`, and `COVER_STEPS["1"].showText` is false.
- [ ] **Step 2: Run them.** `docker compose run --rm app npx vitest run src/lib/sort-books.test.ts src/lib/cover-size.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** per D4 and D5.
- [ ] **Step 4: Run them.** Expected: PASS.
- [ ] **Step 5: Commit** `feat: library sort orders and cover size steps`.

### Task 9: `activeFilterChips`

**Files:**
- Create: `src/lib/filter-chips.ts`, `src/lib/filter-chips.test.ts`

**Interfaces — Produces:**
```ts
export interface FilterChip { key: string; label: string; clear: Partial<LibraryView> | "series" }
export interface ChipContext {
  series: string | null;
  members: HouseholdMember[];
  tosTags: TosTag[];
  libraryVocabulary: LibraryTag[];       // [] when tagging is unavailable
  readOptions: { label: string; readStatus: LibraryView["readStatus"] }[] | null;   // readStatusOptions output, or null
  coversAvailable: boolean;
}
export function activeFilterChips(view: LibraryView, ctx: ChipContext): FilterChip[]
export function clearAllPatch(): Partial<LibraryView>   // every filter field at DEFAULT_VIEW, query and ask untouched
```
**Chip order and labels:**
1. owner: `Shared` or the member's `displayName`;
2. `Deluxe`, `Signed`, `Unhauled`;
3. the read status (its `readOptions` label, e.g. `Unread by me`);
4. one per ToS tag (`labelOf`);
5. one per library tag (its vocabulary label);
6. `Series: {name}`;
7. `Edition: {label}`;
8. covers: `No cover` / `Marked for cover` / `Nothing found` (only when `coversAvailable`);
9. `Published {from}–{to}`, `Published from {from}` or `Published to {to}`;
10. `Added {dayLabel(day)}`.

- [ ] **Step 1: Write the failing tests:**
  - `DEFAULT_VIEW` gives `[]`;
  - a view with owner Member B, Deluxe, two ToS tags and a series gives those chips in the order above, with `clear` patches `{ owner: "all" }`, `{ deluxe: false }`, `{ tags: [the other id] }` and `"series"`;
  - a published range of 1990–2000 reads `Published 1990–2000`;
  - **a library tag stored while `libraryVocabulary` is `[]` gives no chip** (the page passes the effective view, but the chip builder is also defensive);
  - **a read status with `readOptions` null gives no chip (Review Focus 3);**
  - `coverFilter: "no_cover"` with `coversAvailable` false gives no chip;
  - `clearAllPatch()` doesn't contain `query` or `ask`.
- [ ] **Step 2–4:** run (FAIL), implement, run (PASS).
- [ ] **Step 5: Commit** `feat: active filter chips from the library view`.

### Task 10: The pinned toolbar, sort and cover size on the library page

**Files:**
- Create: `src/components/library/LibraryToolbar.tsx`, `src/components/library/CoverSizeControl.tsx`, `src/components/library/FilterChipsRow.tsx`; test `src/components/library/LibraryToolbar.test.tsx`
- Modify: `src/components/library/LibraryPage.tsx` (wiring; the series sort moves into `sortBooks`), `src/components/library/CoverWall.tsx` (accepts `size`)

**Interfaces:**
- **Consumes:** Task 8 and Task 9; `useDevicePref`, `useMediaQuery(DESKTOP)`, `Select`, `IconButton`, `Button`, `Badge`, `Chip`, icons.
- **Produces:**
```ts
LibraryToolbar(props: {
  query: string; onQuery(q: string): void;
  ask?: { disabled: boolean; note: string | null; onAsk(): void };
  filtersCount: number; filtersOpen: boolean; onToggleFilters(): void; filtersId: string;
  sort: SortKey; onSort(s: SortKey): void; seriesOrder: boolean;   // seriesOrder → disabled "Series order"
  size: CoverSize; onSize(s: CoverSize): void;
  selecting: boolean; canSelect: boolean; allShownSelected: boolean;
  onSelect(): void; onSelectAll(): void;
})
// Phone row: search, Ask ✨ (IconButton), Filters, Select / Select all. Sort and size are not in the row (they are in the Filters sheet, Task 11).
// Desktop row: search, Ask ✨, Filters, Sort select, CoverSizeControl, Select / Select all.
CoverSizeControl(props: { size: CoverSize; onSize(s: CoverSize): void })   // D4 group
FilterChipsRow(props: { chips: FilterChip[]; count: ReactNode; onRemove(c: FilterChip): void; onClearAll(): void })
// renders the existing count paragraph (passed in, still the page's single p[aria-live=polite]),
// one Chip per filter, and Clear all when chips.length >= 2
CoverWall(props: { books; viewKey; selection?; size?: CoverSize })   // sets .cover-grid vars and data-cover-size
```
- **The pinned block** is `sticky top-[var(--toolbar-top)] z-20 bg-surface/95 border-b border-line`. Use no `backdrop-filter`, because it would trap fixed descendants.
- It holds the toolbar, the chips row and, on the computer, the open panel (Task 11).
- The `Ask ✨` name and `Search books` stay. The note under the search stays.

- [ ] **Step 1: Write the failing tests** (`LibraryToolbar.test.tsx` plus new cases in `LibraryPage.test.tsx`):
  - **Sort (desktop stub):**
    - the `Sort` select lists D5's four labels;
    - choosing `Author` reorders the wall (`[data-book-id]` order) and writes `tpl_library_sort = "author"`;
    - a remount reads it back;
    - **on `#/series/Lantern Cycle` with `author` stored, the wall is in volume order and `Sort` is disabled showing `Series order` (Review Focus 5).**
  - **Cover size (desktop stub):**
    - `Smaller covers` from `4` gives `data-cover-size="3"` with `--cover-cols: 3` and `--cover-min: 120px`, and writes `tpl_cover_size = "3"`;
    - at `1`, `Smaller covers` is disabled and titles are `sr-only`, while still in the link's name;
    - at `5`, `Larger covers` is disabled;
    - a remount restores the stored size;
    - **with `getItem` throwing, the page renders at `4`, and the buttons still change the size for the session. With `tpl_cover_size = "9"`, it's `4` (Review Focus 2).**
  - **Chips:**
    - with Deluxe on, the chips row shows `Deluxe` and the count `N books`;
    - `Remove filter: Deluxe` turns it off, and the count updates;
    - two chips show `Clear all`, which leaves the search text in place;
    - the series chip's remove goes to `#/` (`navigate`);
    - `Filters` reads `Filters, 2 active` with two filters.
  - **The pinned block** has the `sticky` class.
  - **Ask and select:** with Ask results showing, the toolbar stays, and `Select` hides as today.
- [ ] **Step 2: Run them.** `docker compose run --rm app npx vitest run src/components/library src/lib`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - `visible` becomes `sortBooks(filterView(...), sort, { series })`. The inline series sort is removed.
  - `LibraryFilters` is not removed yet (Task 11 replaces it). For this task it renders inside the panel slot, opened by `Filters`, so the suite stays green.
- [ ] **Step 4: Run the whole suite.** Expected: PASS.
- [ ] **Step 5: Commit** `feat: pinned library toolbar with sort, cover size and filter chips`.

### Task 11: The filters panel (computer) and sheet (phone)

**Files:**
- Create: `src/components/library/FiltersPanel.tsx`; test `src/components/library/FiltersPanel.test.tsx`
- Modify: `src/components/library/LibraryPage.tsx`; `src/components/tags/LibraryTagFilter.tsx` (its dialog → `Sheet`)
- Delete: `src/components/library/LibraryFilters.tsx`. Its `YearInput`/`parseYear` move into `FiltersPanel.tsx`, and the ToS tags dialog becomes a `Sheet` labelled `ToS tags`.
- Tests to update: `LibraryPage.test.tsx`, `LibraryPage.ask.test.tsx`, `LibraryPage.covers.test.tsx`, `LibraryPage.select.test.tsx`. Each needs one `openFilters()` helper (click `Filters`) before using a filter control. **No assertion changes otherwise.**

**Interfaces:**
- **Consumes:** Task 9 `clearAllPatch`; Task 10's toolbar; `Sheet`, `Chip`, `Select`.
- **Produces:**
```ts
FiltersPanel(props: Omit<LibraryFiltersProps, "query" | "onQuery" | "ask"> & {
  mode: "panel" | "sheet"; id: string; onClose(): void; onClearAll(): void;
  me: string | null;                         // for the Reading group's For default
  view?: ReactNode;                          // sheet mode only: the View group (Sort + CoverSizeControl)
})
```
`LibraryFiltersProps` is today's `LibraryFilters` `Props`, exported and kept the same.

- [ ] **Step 1: Write the failing tests:**
  - **Panel (desktop stub):**
    - `Filters` has `aria-expanded="false"`; a click shows region `Filters` with the D6 group headings in order (`Reading`, `Owner & Copy`, `Tags & Series`, `Edition, Covers & Dates`), and `aria-expanded="true"`;
    - toggling `Deluxe` (`exact`) narrows the count live while the panel stays open;
    - Escape inside closes it and focuses `Filters`;
    - `Clear all` resets the filters and keeps the search.
  - **Sheet (phone):**
    - `Filters` opens dialog `Filters`, whose first group `View` holds `Sort` and `Cover size`, and `Done` closes it;
    - **with the ToS tags sheet opened from inside it, one Escape closes only `ToS tags`, and focus returns to the `ToS tags` button in the Filters sheet (Review Focus 4).**
  - **Reading group:**
    - `Read status` group buttons `Any`, `Unread`, `Read`, `Did not finish`;
    - `Unread` with For `me` filters like today's `Unread by me` and shows chip `Unread by me`;
    - choosing For `Member B` then `Read` gives chip `Read by Member B`;
    - `For` is hidden with a single member;
    - **pressing Ask after `Unread` sends only those ids** (`LibraryPage.ask.test.tsx`, moved from the select);
    - the group is absent while reading is unavailable.
  - **Hidden filters:** **with library tags stored and tagging unavailable, no chip shows and `Filters` reads `Filters` (Review Focus 3).**
  - **Kept:** every existing `LibraryPage*.test.tsx` case passes after its `openFilters()` step. That covers Date added, published range, Unhauled/Deluxe/Signed, ToS tags focus, covers and the select tests.
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement** per D6. The same `FiltersPanel` renders inside `Sheet` (phone) or the pinned region (computer), so the controls exist once.
- [ ] **Step 4: Run the whole suite.** Expected: PASS.
- [ ] **Step 5: Commit** `feat: filters panel under the toolbar, and a bottom sheet on the phone`.

### Task 12: Cards, the read badge, select outline, and MassEditSheet on `Sheet`

**Files:**
- Modify: `src/components/library/BookCard.tsx`, `CoverWall.tsx`, `MassEditSheet.tsx` (its dialog → `Sheet`, keeping `aria-label="Edit selected books"`), `src/components/edition/EditionPicker.tsx` (→ `Sheet`, keeping its name `Edition label`)
- Tests: `BookCard.test.tsx` (extend), `MassEditSheet*.test.tsx` and `EditionPicker.test.tsx` (should pass unchanged, so fix the part if they don't)

**Interfaces:**
- **Produces:** `BookCard(props: { book; photoUrl?; selection?; readState?: "read" | "dnf"; showText?: boolean })` (both new props optional; `showText` defaults to true).

- [ ] **Step 1: Write the failing tests:**
  - **Read badge:**
    - `readState="read"` shows `✓ Read` inside the link;
    - `"dnf"` shows `DNF`;
    - none shows nothing.
    - From `CoverWall` with reading available, the viewer's read book shows `✓ Read` and another member's read book doesn't.
  - **Flags:** Deluxe and Signed still show, now as cover badges, and `getByText("Deluxe", { exact: true })` inside `[data-book-id]` still finds them.
  - **Text:** `showText={false}` gives a title with class `sr-only`, and the link's name still contains the title.
  - **Select:** a selected card's cover has `ring-accent`, and its checkbox is still named `Select {title}`.
  - **Nested sheets:** in `MassEditSheet`, with `EditionPicker` open, one Escape closes only the picker (**Review Focus 4**).
- [ ] **Step 2–4:** run `docker compose run --rm app npx vitest run src/components/library src/components/edition` (FAIL), implement per D10, run (PASS), then the whole suite.
- [ ] **Step 5: Commit** `feat: cover cards with corner badges, read status and a select outline`.

### Task 13: PR 2 e2e, visual and accessibility checks, and the PR

**Files:**
- Modify: `e2e/mass-edit.spec.ts`, `e2e/reading-history.spec.ts` (Read status is now the panel group plus For), `e2e/scroll-restore.spec.ts`, `e2e/edition-labels.spec.ts` (the `Edition` select is in the panel), `e2e/visual.spec.ts` (states)
- Create: `e2e/library.spec.ts`

- [ ] **Step 1: Update the existing specs.**
  - Add `await page.getByRole("button", { name: /^Filters/ }).click()` before each filter control, and close the panel with `Done` (phone) where the wall is next.
  - Use `{ exact: true }` for `Deluxe`, `All` and `Read`.
  - `scroll-restore.spec.ts`: after the return, assert `getByRole("button", { name: "Remove filter: Deluxe" })` is visible, in place of the `aria-pressed` check. Its 8px place check is unchanged.
  - `reading-history.spec.ts`:
    - `selectOption({ label: "Unread by me" })` becomes the `Read status` group's `Unread` button;
    - `Read by Member A` becomes For `Member A`, then `Read`;
    - `Any read status` becomes `Any`.
- [ ] **Step 2: Write `e2e/library.spec.ts`** at 390px, with `seedShelf(user, 40)`:
  - **Pinned:** scroll to the bottom, and `Search books`, `Filters` and `Select` are all still in the viewport.
  - **Sort:** in the phone sheet, `Author` changes the first card's title; after a reload it is still `Author`.
  - **Cover size:** `Smaller covers` twice gives 4 cards in the first row (by `boundingBox().y`); after a reload it's the same.
  - **Chips:** `Deluxe` gives the chip and count; removing it restores the count.
  - **Bars (Review Focus 1):**
    - in select mode with 3 selected, the `Selection` region's box bottom is ≤ the `Main` nav's box top;
    - after scrolling to the end, the last card's box bottom is ≤ the `Selection` region's top.
    - Repeat with the `No cover` cover filter and the cover batch footer.
  - **Tap targets:** `expectTapTargets` on the pinned block and the Filters sheet.
  - **Keyboard:** Tab reaches `Filters`, Enter opens it, Escape closes it with focus on `Filters`, and `expectFocusRing` passes.
  - **Desktop (1280px):**
    - the panel opens under the toolbar, and the grid's top moves down;
    - `Smaller covers` changes the column count (from 6 at the default);
    - the Sort select is in the toolbar.
- [ ] **Step 3: Run the e2e suite.** Expected: PASS.
- [ ] **Step 4: Visual check.** States `library`, `library-filters-open`, `library-select`, `library-size-1`, `library-size-5` and `library-series`, at 390 and 1280, saved to `.superpowers/screenshots/plan9/pr2`. Compare against `home-layout.html` B, `cards.html` A and `filters.html` A.
- [ ] **Step 5: Accessibility check.** Lighthouse on `#/` with the panel open (1280px) and the sheet open (390px), plus a keyboard pass of the toolbar, panel, chips and select mode. Note the results in the PR body.
- [ ] **Step 6: Gates.** `git fetch origin`, `git rebase origin/main`, `npm test`, `lint`, `build`, `check:bundle`, e2e.
- [ ] **Step 7: Commit, push and open PR 2** (`UI overhaul 2: library toolbar, filters, sort and cover sizes`) against `main`, left unmerged. The body lists:
  - the behaviour kept (the filter model is untouched, D6);
  - the one interaction change: the Read status select becomes a group plus `For`, with the same states;
  - test results and the screenshot and Lighthouse notes.
  No AI attribution.

---

## PR 3 — the book page (`tshardey/ui-book-page`, from `origin/main` after PR 1 merges)

### Task 14: `useYourReading` and `MarkReadButton`

**Files:**
- Create: `src/components/reading/useYourReading.ts`, `src/components/reading/MarkReadButton.tsx`; test `src/components/reading/MarkReadButton.test.tsx`
- Modify: `src/components/reading/YourReadingSection.tsx`. It becomes `YourReadingControl({ reading })` (the markup), plus `YourReadingSection({ bookId })` = `<YourReadingControl reading={useYourReading(bookId)} />`, so `YourReadingSection.test.tsx` stays green unchanged.

**Interfaces — Produces:**
```ts
export interface YourReading {
  available: boolean;                 // false also when userId is null
  shown: { state: ReadState; finishedOn: string | null };
  busy: boolean;
  error: boolean;
  draft: string | null;
  others: { userId: string; line: string }[];   // otherLine() text per other member
  choose(state: ReadState): void;
  changeDate(value: string): void;
  clearDate(): void;
  groupRef: RefObject<HTMLDivElement | null>;  // the "Your reading" group, for focusing
}
export function useYourReading(bookId: string): YourReading   // today's save/queue logic, moved verbatim
YourReadingControl(props: { reading: YourReading }): JSX.Element | null
MarkReadButton(props: { reading: YourReading; onShowReading(): void })   // D9
```

- [ ] **Step 1: Write the failing tests** (the `ReadingContext` mock pattern of `YourReadingSection.test.tsx`):
  - **unread:** `Mark read` calls `setStatus([id], "read", <today local>, false)`, and then the button's name is `Your reading: Read`;
  - **read:** clicking `Your reading: Read` calls `onShowReading` and makes no write;
  - **dnf:** the name is `Your reading: Did not finish`;
  - **busy:** while a save is pending the button is disabled, and a double click sends one write;
  - **unavailable:** nothing renders;
  - **shared instance:** a test harness renders `MarkReadButton` and `YourReadingControl` from one `useYourReading`. A Mark read shows `Read` pressed in the group at once (the same pending state).
- [ ] **Step 2: Run them.** `docker compose run --rm app npx vitest run src/components/reading`. Expected: FAIL.
- [ ] **Step 3: Implement.** Move the logic without changing it. The `mounted`/`queued` refs live in the hook.
- [ ] **Step 4: Run them.** Expected: PASS, with `YourReadingSection.test.tsx` unchanged.
- [ ] **Step 5: Commit** `refactor: share the reading save path; add the Mark read shortcut`.

### Task 15: The two-column book page with tabs

**Files:**
- Modify: `src/components/book/BookDetail.tsx`, `src/components/covers/FindCoverPanel.tsx` (label `Find cover`, Buttons), `src/components/series/SeriesPicker.tsx` and `src/components/tags/LibraryTagPicker.tsx` (dialogs → `Sheet`, same names)
- Tests: `BookDetail.test.tsx` (update and extend), `FindCoverPanel.test.tsx` (`Find a better cover` → `Find cover`), `SeriesPicker.test.tsx` and `LibraryTagsSection.test.tsx` (should pass unchanged)

**Interfaces:**
- **Consumes:** Task 14; `Tabs`, `Menu`, `Button`, `useDevicePref("tpl_book_tab", BOOK_TABS, "overview")`. The two columns are pure CSS (`md:`).
- **Produces:** `export const BOOK_TABS = ["overview", "copies", "tags", "tos"] as const`, exported from `BookDetail.tsx`.
- `useYourReading(id)` is called at the top of `BookDetail`, before the early returns.

- [ ] **Step 1: Write the failing tests:**
  - **Tabs:**
    - tablist `Book sections` with `Overview`, `Copies (2)`, `Tags` and `Tome of Secrets`;
    - Overview is selected by default and holds the synopsis and the `Your reading` group;
    - `Copies (2)` shows the two copies and `Add copy`;
    - `Tags` shows Library tags, or `Library tags aren't available yet.` while tagging is unavailable;
    - `Tome of Secrets` shows `TosTagsSection` with its unavailable text when the tags failed.
  - **Remembered tab:**
    - choosing `Tags` writes `tpl_book_tab = "tags"`, and a fresh render of another book opens on `Tags`;
    - **`tpl_book_tab = "reading"` (unknown) or a throwing `getItem` opens on Overview (Review Focus 2).**
  - **Left column:** `Edit book` swaps in `BookForm` and Cancel restores the tabs; `Find cover` is present when the finder is available; `Mark read` is present when reading is available.
  - **Menu:** `More actions` → `Add copy` selects `Copies (n)` and shows the copy form, and `Delete book` asks to confirm, as today.
  - **Mark read, read state:** clicking `Your reading: Read` from the `Tags` tab selects Overview and focuses the `Your reading` group.
  - **Kept:** every existing `BookDetail.test.tsx` case passes after adding the tab click it needs ("shows Library tags under Tome of Secrets" becomes "Library tags are on the Tags tab"). That covers series save and error, the series link, tags unavailable, no cover finder outside a provider, copy counts and the unhauled note.
- [ ] **Step 2–4:** run `docker compose run --rm app npx vitest run src/components/book src/components/covers src/components/series src/components/tags` (FAIL), implement per D9, run (PASS), then the whole suite.
- [ ] **Step 5: Commit** `feat: two-column book page with tabs, actions and a remembered tab`.

### Task 16: PR 3 e2e, visual and accessibility checks, and the PR

**Files:**
- Create: `e2e/book-page.spec.ts`
- Modify: `e2e/reading-history.spec.ts` (book-page steps stay on Overview; add nothing unless a step needs a tab), `e2e/visual.spec.ts`

- [ ] **Step 1: Write `e2e/book-page.spec.ts`** (invented book with two copies):
  - **Tabs by keyboard:** focus the `Overview` tab, ArrowRight twice reaches `Tags` (selected), and End reaches `Tome of Secrets`. Reload a different book and it opens on `Tome of Secrets`.
  - **Mark read:** on an unread book, `Mark read` shows `Your reading: Read` and the Overview group has `Read` pressed. After a reload it's still read, with today's date in `Finished`.
  - **Menu:** `More actions` opens by Enter, Escape closes it with focus back, and `Add copy` opens the copy form on `Copies (2)`.
  - **Layout at 1280px:** the cover's box is left of the tablist's box (two columns). At 390px the cover is above the tablist.
  - **Tap targets** at 390px on the left-column actions and the tablist.
- [ ] **Step 2: Run the e2e suite.** Expected: PASS.
- [ ] **Step 3: Visual check.** States `book-overview`, `book-copies`, `book-tags`, `book-tos`, `book-editing` and `book-menu`, at 390 and 1280, saved to `.superpowers/screenshots/plan9/pr3`. Compare against `book-page.html` B.
- [ ] **Step 4: Accessibility check.** Lighthouse on a book page at both widths, and a keyboard pass of the tabs, the menu and the pickers' sheets. Record the results.
- [ ] **Step 5: Gates, commit, push and open PR 3** (`UI overhaul 3: book page with tabs`) against `main`, left unmerged. The body notes the `Find a better cover` → `Find cover` relabel and the Tags tab's unavailable text. No AI attribution.

---

## PR 4 — restyle the remaining screens (`tshardey/ui-restyle-screens`, from `origin/main` after PR 1 merges)

**Restyle only (spec §3.7): no flow, copy or behaviour changes.**
- Each screen gets: a `max-w-3xl mx-auto px-4 sm:px-6` container and a page title `h2` in the D3 style.
- Buttons become `Button`/`buttonClass` with the variant matching today's role: a filled stone button becomes `primary`, an underlined action becomes `ghost` or `secondary`, and Delete becomes `danger`.
- Selects become `Select`, and hand-made dialogs become `Sheet` with the same `aria-label`s.
- **Existing tests must pass unchanged.** A test that needs editing is a sign of a behaviour change, so fix the code instead. The only exception is a test asserting a class string; update it to the equivalent part class, and list it in the PR body.

### Task 17: Scan, Photos and Import

**Files:**
- Modify: `src/components/scan/ScanPage.tsx`, `ScanList.tsx`, `TypeIsbnSheet.tsx` (→ `Sheet`); `src/components/inbox/InboxPage.tsx`, `IntakeCard.tsx`, `UploadPanel.tsx`, `BulkConfirmSheet.tsx` (→ `Sheet`); `src/components/import/ImportPage.tsx`, `ImportPreview.tsx`, `ReviewList.tsx`
- Tests: `ScanPage.test.tsx`, `InboxPage.test.tsx`, `BulkConfirmSheet.test.tsx`, `ImportPage.test.tsx`

- [ ] **Step 1: Pin what must not change.** `BulkConfirmSheet.test.tsx` asserts `overflow-y-auto` on the list and `flex-col` on the dialog. Pass `className="flex flex-col"` to `Sheet` and keep `overflow-y-auto` on the list, so the test stays as it is. Task 6's `z-40` scan test must stay green.
- [ ] **Step 2: Run the touched tests before changing anything.** `docker compose run --rm app npx vitest run src/components/scan src/components/inbox src/components/import`. Expected: PASS (baseline).
- [ ] **Step 3: Restyle** per the PR 4 rules. The camera view stays full-screen with `bg-black` (allowed by the guard).
- [ ] **Step 4: Run the whole suite.** Expected: PASS, with no test edited except as allowed above.
- [ ] **Step 5: Commit** `style: Scan, Photos and Import on the shared parts`.

### Task 18: Covers to review, Reading history, Tag suggestions, Edition labels, Sign in and household setup

**Files:**
- Modify: `src/components/covers/CoverReviewPage.tsx`, `ReviewRow.tsx`, `NothingFoundList.tsx`, `CoverStopBanner.tsx`; `src/components/reading/ReadingHistoryPage.tsx`, `ReadingStatsPanel.tsx`, `HistoryUpload.tsx`, `PossibleMatches.tsx`; `src/components/tags/TagSuggestionsPage.tsx`, `TagRunPanel.tsx`, `TagStopBanner.tsx`, `RetagConfirm.tsx`; `src/components/edition/EditionLabelsPage.tsx`; `src/components/auth/SignIn.tsx`; `src/components/household/HouseholdSetup.tsx`, `InviteCode.tsx`; `src/components/book/AddBook.tsx`, `BookForm.tsx`, `CopyForm.tsx`, `CopyList.tsx`
- Tests: their existing tests, unchanged.

- [ ] **Step 1:** Restyle per the PR 4 rules.
  - Banners (`CoverStopBanner`, `TagStopBanner`) use `bg-notice border-notice-line` with a leading icon. Error boxes use `bg-danger-surface text-danger`.
  - Sign in and household setup are a centred `max-w-sm` card on `bg-raised`, with `Our Library` above it.
- [ ] **Step 2: Run the whole suite.** Expected: PASS, with no test edited.
- [ ] **Step 3: Commit** `style: the remaining screens on the shared parts`.

### Task 19: PR 4 e2e, visual and accessibility checks, and the PR

- [ ] **Step 1: Run the e2e suite** (`scan.spec.ts`, `tag-suggestions.spec.ts`, `edition-labels.spec.ts` and `reading-history.spec.ts` especially). Expected: PASS, with no spec edited.
- [ ] **Step 2: Visual check.** Every PR 1 state except `library` and `book`, plus `scan-camera` (via `e2e/fake-camera.ts`), `photos-confirm`, `import-preview`, `household-setup` and `type-isbn`, at 390 and 1280, saved to `.superpowers/screenshots/plan9/pr4`. Check:
  - the widths are comfortable on the computer;
  - no light panel remains;
  - the camera covers the tab bar.
- [ ] **Step 3: Accessibility check.** Lighthouse on `#/scan` (pre-camera), `#/inbox`, `#/import`, `#/covers`, `#/reading`, `#/tags`, `#/editions` and sign-in at 390px. `expectTapTargets` on each page's main actions, in a short `e2e/screens-a11y.spec.ts`. Record the results.
- [ ] **Step 4: Gates, commit, push and open PR 4** (`UI overhaul 4: restyle the remaining screens`) against `main`, left unmerged. The body says no behaviour changed and lists any test whose class assertion moved. No AI attribution.

---

## Task 20: Whole-scope review (most capable model)

Run this once PRs 1–4 are all open (PR 1 may already be merged).

- [ ] **Step 1:** Dispatch one fresh reviewer on the most capable model available (`model: "fable"` on the Agent tool, i.e. `claude-fable-5-1`). Give it the spec, this plan, and the four diffs:
  - PR 1's merged range, or its branch;
  - `git diff origin/main...origin/<branch>` for each of PRs 2–4.

  It checks:
  - **Spec and plan coverage:** every §3 and §5 item against D1–D12, and Review Focus 1–5;
  - **the anti-goals:**
    - a feature lost or made harder to reach (compare today's `AccountMenu`, `CoversBadge`, `TabBar` and `LibraryFilters` against the new nav, More and panel);
    - search, filters or Select scrolling away;
    - a bulk-select path slower than before;
    - low-contrast text;
  - **filter behaviour identity:** `LibraryView`, `FilterOptions` and `ask.ts` are unchanged, and the chips and count come from the effective view;
  - **reading:** `useYourReading` is a verbatim move, and Mark read goes through it;
  - **storage:** every `localStorage` touch goes through `device-prefs`;
  - **accessibility:** focus, targets, names, keyboard for Menu, Sheet and Tabs, and reduced motion;
  - **hygiene:** public-repo hygiene (synthetic data only, no `.png` committed), and no AI attribution in any commit or PR text.
- [ ] **Step 2:** Fix confirmed findings on the PR that owns the code, each as its own commit. Rerun that PR's gates and push. Record findings and outcomes in each PR body. For a finding in merged PR 1, open a small follow-up PR from `origin/main` (`tshardey/ui-overhaul-fixes`).

---

## User checks after each merge

Hard-refresh first (Pages caches JS for about 10 minutes).
1. **PR 1:** every screen is dark and readable. Phone: the bottom bar shows Library, Add, Scan, Covers and More; Covers shows a count when covers wait; More has Reading history, Tag suggestions, Edition labels, Import, Photos and Sign out. The camera is full-screen.
2. **PR 2:** while scrolling the library, search, Filters and Select stay at the top. Smaller covers fit more books, and the size and the sort are still set after a reload. Active filters show as chips.
3. **PR 3:** on the computer, the book page has the cover on the left and tabs on the right. Tagging several books in a row stays on the Tags tab. Mark read marks the book read today.
4. **PR 4:** the other screens look like the rest of the app and work as before.

## Follow-ups (not built)

1. A light mode, if ever wanted (tokens make it a `:root` swap).
2. Read badges for other members on cards (only the viewer's is shown).
3. Netflix-style rows on the home screen (considered and not chosen, §2).

## Open questions for the coordinator

1. **Merge timing.** D1 has PRs 2–4 branch from `main` after Tierra merges PR 1, so nothing needs retargeting. Should builders instead start PRs 2–4 straight away, stacked on `tshardey/ui-overhaul-design` (D1's fallback, with a retarget note in each body)?
   - *2026-11-15 answer (Tierra):* **wait for PR 1 to merge first.** PRs 2–4 start only after PR 1 is merged, each from `origin/main`. The stacking fallback is not used.

## Build notes

**2026-11-16, PR 1 (Tasks 1–7).** Where the build departed from the text above, and why:

1. **Task 1, contrast test:** Vitest returns an empty string for CSS `?raw` imports, so `contrast.test.ts` reads `src/index.css` from disk, resolved relative to the test file.
2. **Task 2, control borders:** the mapping table had no row for a bare `border`. After the sweep, the base rule painted those borders in `line` (about 1.2:1), against D2's "no control relies on `line`". A base-layer rule now gives `button`, `[role=button]` and `a[role=button]` the `field` border. Non-button controls (file-input labels, button-styled links) get `border-field` explicitly. A test pins the rule.
3. **Task 2, palette guard:** it scans `src/**/*.{ts,tsx}` (not only `.tsx`), because class strings also live in `.ts` style files (`button-styles.ts`, `nav-styles.ts`).
4. **Task 3, `buttonClass`:** it lives in `src/components/ui/button-styles.ts` (re-exported from `index.ts`), so `Button.tsx` exports only components (react-refresh lint rule).
5. **Task 3, Chip:** the remove button is `size-11` below `sm` (D11 44px), `sm:size-6`.
6. **Task 6, read summary:** the summary sentence and its omit rule live in one shared `src/components/reading/ReadSummary.tsx`, which both More and Reading history use.
7. **Task 6, InviteCode:** its `Copy` control got a 44px target in PR 1 (not Task 18), because it now sits in the More sheet and Task 7's tap-target check covers that sheet.
8. **Task 7, legacy overlays:** the z-30 tab bar covered the Save/Add buttons of the hand-made sheets on the phone. Seven overlays moved to `z-50`: MassEditSheet, BulkConfirmSheet, EditionPicker, SeriesPicker, LibraryTagPicker, the ToS tags dialog and LibraryTagFilter. Two of them sit inside the sticky filter bar, which is a stacking context, so they are now portalled to `document.body`. All of them still move onto `Sheet` in Tasks 11, 12 and 17.
9. **Whole-PR-1 review fixes:**
   - The library's sticky filter block uses `top-[var(--toolbar-top)]`. Without it, the sticky desktop header hid the search row.
   - `Tabs` scroll horizontally on narrow screens.
   - `Sheet` locks page scroll, nested-safe. It keeps a module-level count of open sheets, because a per-sheet saved value broke when nested sheets mount in the same commit.
   - The bar's Add and More buttons have `aria-haspopup="dialog"`.
   - `expectTapTargets` fails on zero matches.
   - Disabled primary buttons use `disabled:bg-control disabled:text-muted`, not faded accent.
   - ESLint ignores `playwright-report/` and `test-results/`.
10. **Known e2e failure, not PR 1's:** `scan.spec` test 4 ("not found, then a photo…") fails the same way on `main` (1 row expected, 2 found).

**For PRs 2–4:**
- Use `top-[var(--toolbar-top)]` for anything sticky under the desktop header.
- The palette guard covers `.ts` style files too.
- Parked review items:
  - `Menu` doesn't close when focus Tabs out of it.
  - `Sheet`'s `motion-safe:transition` has no start state, so there is no visible motion.
  - Pressed legacy chips in `LibraryFilters` show a grey `field` ring around the accent fill; this goes away when PR 2 moves them onto `Chip`.
  - `Tabs` puts `aria-controls` on panels that aren't rendered.
  - `Sheet` focus return doesn't check `isConnected`.

**2026-11-16, PR 3 (Tasks 14–16).** Where the build departed from the text above, and why:

1. **Task 15, `Find cover` opens in a `Sheet`.** D9 puts the `Find cover` button in the left column. The open request form (reason chips, note, budget copy, buttons) was cramped there: about 134px wide on the phone. The form now opens in a `Sheet` titled `Find cover`. Every field and behaviour is unchanged, including `Angled` pre-ticked for a book with a deluxe copy. The status after a request (`New covers are ready. Review covers`) stays beside the button. Approved by the coordinator for Tierra.
2. **Task 15, actions while editing.** While `Edit book` is open, the tabs are hidden. So `Mark read` (in the read and dnf states) and the menu's `Add copy` are disabled until Save or Cancel. They don't leave edit mode, so unsaved edits are kept. `MarkReadButton` takes an optional `disabled` prop.
3. **Task 15, phone order.** In one column, the left column (the cover and actions) comes before `Back to library`, as D9's column split implies. The mockup's phone note ("cover on top") agrees, and the bottom tab bar's `Library` is always there.
4. **Task 15, tap targets.** D11's 44px rule now also covers the Overview's `Your reading` buttons and `Clear date`, SeriesPicker's `Close`, LibraryTagPicker's `Done`, the Find cover reason chips, and `Try again` / `Remove mark`. The left-column actions sit in a `role="group"` named `Book actions`.
5. **Task 16, icons need a size.** The shared `Svg` has no default size, so an icon rendered without `className` collapses to nothing. `More actions` uses `DotsIcon className="size-5"` and the read check uses `CheckIcon className="size-4"`. Later PRs should always size icons.
6. **Task 16, extra visual states:** `book-read`, `book-find-cover` and `book-find-cover-results`. The last one answers the `cover_searches` read with a synthetic row through `page.route`, with no network or API spend.
7. **Behaviour note:** SeriesPicker on `Sheet` treats a scrim click like Escape, so a valid changed volume draft is saved. Before, an outside click did nothing.
