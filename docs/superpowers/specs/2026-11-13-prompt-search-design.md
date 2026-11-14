# Plan 7: Tagging pass and Ask (prompt search) — design

Status: designed with Tierra on 2026-11-13; builder check done and its questions answered. Awaiting Tierra's review of this document.

## 1. Why

Tierra plays Tome of Secrets (ToS) and joins outside reading challenges. Both hand out prompts such as "a red cover", "found family", "contains vampires", "a number or weekday in the title", "starts with B" or "stars on the cover". When a prompt comes up, Tierra wants help **choosing a book from the household shelf to read next** that fits it.

Today the library can't help:

- Search matches only title, author and edition notes (`src/lib/filter-books.ts`). It never looks at descriptions.
- Only 20 of 257 books carry any ToS tag. The ToS vocabulary (48 tags, `assets/data/bookTags.json` in ToS) exists to trigger game items and abilities. It has no general tropes (found family, enemies to lovers), most creatures (vampires, witches) or cover traits.
- Nothing knows what a cover looks like.
- Descriptions are mostly good (247 of 257 books have one, averaging about 1,240 characters), but about 10% are written about a deluxe or special edition rather than the story.
- The app stores no Open Library subjects or Google categories, and those sources are uneven and nearly trope-free anyway.

An inventory of 318 real prompts from Tierra's games and challenges (ToS data, r/Fantasy Bingo 2026, Roll for Reads, a board-game TBR, mission and prompt cards, a seasonal syllabus) shows how prompts get answered:

| How a prompt is answered | Prompts |
|---|---|
| Book content: tropes, themes, creatures, setting, mood, genre | 149 (about 42 already covered by ToS tags) |
| Book facts: page count, publish year, series position | 39 |
| Cover appearance | 22 |
| Title or author rule | 19 |
| Not answerable from the book: reading history, how acquired, author identity | 89 |

## 2. What success looks like

- Common prompts ("vampires", "cozy", "red cover", "YA") become a **free, instant filter**: tap a tag chip.
- Harder prompts ("things aren't what they seem", "an antler on the cover or in the title", "spell R-E-A-D with titles") go to **Ask ✨**. It returns a short ranked list of books that could fit, each with a confidence % and a one-line reason. Tierra decides what to read from there.
- Every book carries pre-filled ToS tags. This especially helps AJ, who doesn't follow the game mechanics closely. Tierra double-checks tags when they review a book in ToS anyway.
- Spending stays small and predictable: about $2 one-time to tag the whole library, then about $1–2 a month for Ask at 10–20 searches.

## 3. Goals, non-goals, anti-goals

**Goals**
- A **tagging pass** over every book, run once and then automatically on new books, that writes:
  - **ToS tags** (into the existing `library.book_tags`) from the book-intrinsic categories only (§5.2).
  - **Library tags**: a separate, wider vocabulary for prompts (tropes, creatures, setting, era, themes, mood, pace, audience, subgenre, cover colour and motifs, and a few less-certain book facts). Starting list in Appendix A.
  - A **book card**: a short "what this book is about" summary plus a cover description. It is Ask's compact input and is what fixes the deluxe-description problem.
- **Ask ✨** on the main search box, reading book cards and returning ranked matches.
- Library tags as **filter chips**, on the **book page** (editable), and in **mass edit**.
- A **tag suggestions** list where Tierra approves or dismisses new tags the tagger proposes.

**Non-goals**
- **Author identity** (AAPI, Black, Latinx, Indigenous or LGBTQIA+ author). It is never inferred or tagged (Tierra: guessing from names is bad, and bios often don't say). Ask's instructions also say not to infer it.
- **Reader-relative prompts** ("read in a park", "recommended by a friend", "unread by me"). "Unread by me" arrives with read status (backlog item 2), not here.
- **Merging library tags into ToS.** Library tags stay library-only for now. A later merge stays possible, and nothing here should block it.
- Debut, banned and similar author-level or external facts as hard fields. Ask may answer them, with a "please verify" reason.
- Open Library subjects or Google categories as a source. Not used (§1).

**Anti-goals** (failure even if it technically works)
- **A tag someone removed by hand coming back.** The pass only ever adds tags. A removal in either app is remembered, and re-runs respect it.
- **Spend that surprises Tierra.** Each feature has its own monthly cap, a full run shows a cost estimate first, and failures never loop and keep billing.
- **Ask results padded with poor fits.** Matches below about 30% confidence are left off.
- **Edition blurbs read as plot.** Text about sprayed edges, foil or "special edition" must not turn into content tags.

## 4. Constraints

- **ToS owns all migrations and Edge Functions.** The schema and functions go in a ToS PR, and the UI goes in a library-app PR. Production `db push`, function deploys and secret changes happen only with Tierra's go-ahead at that moment.
- **API key and budget.** The production `ANTHROPIC_API_KEY` Supabase secret is shared with `library-intake` and `library-covers`. Its workspace is capped at $10 a month. Monthly caps inside that cap (Tierra agreed):
  - covers $5 (existing);
  - **tagging $5 in the first month**, so the full run finishes in one go, then **$2** a month (Tierra's choice; cover finding has cost cents so far, so this stays well inside the $10 cap);
  - **Ask $2**;
  - about $1 of headroom for photo and scan intake.

  Tierra has said the cap can rise if needed, but wants cost kept in mind. Raise it only with a reason.
- **Public repos.** Fixtures, tests and PR text use synthetic titles only. Tag vocabulary is not sensitive.
- **Household.** Two people (Tierra and AJ) share one catalogue. Tags, cards, suggestions and both budgets are household-scoped and shared. Either person can use Ask.
- **Layout.** Phone-first, matching the existing app (Vite, React 19, TypeScript, Tailwind 4).

## 5. How it works (decided)

### 5.1 What the tagger reads

For each book:
- title, authors, series name and volume;
- the description;
- the cover image (fetched from `cover_url`: today 174 Open Library and 81 Google hosts);
- **Claude's own knowledge of the title.** Tierra approved this. It matters most when the description is about the edition.

The tagger must treat edition marketing text as non-content, and treat all book text and cover text as data, never as instructions.

### 5.2 What it writes

**ToS tags** go into `library.book_tags`, applied directly with no review step (Tierra's choice).
- **Allowed categories:** ToS `genre`, `content` and `form`, plus `Award-Winning`, which is a book fact even though ToS files it under provenance.
- **Never auto-applied:**
  - the provenance tags about a copy or reading (Borrowed, Bought Used, Gifted, Inherited, Damaged/Ex-Library, Re-Read, Picked Back Up, On TBR Over a Year);
  - the agency tags;
  - reader-scope tags (`scope: "reader"`, such as New-to-You Author and Author from a New-to-You Country);
  - type-derived tags (`derivedFromType`, such as Audiobook, which the schema already rejects).
- The allowed list is derived from the published `bookTags.json`, not hard-coded, so new ToS tags in those categories become usable.

**Library tags** come from the vocabulary only (Appendix A), and are applied directly.
- **Cover colours:** the 1–2 dominant colours from an 11-colour palette.
- **Less-certain facts** live in a `fact` category: `has-adaptation` (film or TV), `banned-challenged`. They are ordinary tags, so a wrong one is simply removed.

**Book card**, one per book:
- a 2–3 sentence content summary;
- a one-line cover description (colours, objects, style);
- the tagger model;
- the vocabulary version it used;
- when it was written.

The summary is about the story, not the edition. Cards aren't shown in the UI in this plan; they feed Ask. *(Claude's call.)*

**Suggestions:** when the tagger thinks a book needs a tag that isn't in the vocabulary, it records a suggestion: proposed tag, category, the book, and a short why. It doesn't apply it.

### 5.3 When it runs

- **Full run:** a **Tag all books** control (on the Tag suggestions screen, §5.6). It shows a cost estimate and progress, and works through every book without a card. It runs in the open app like the cover finder's batch, and stops cleanly at the monthly cap or when the workspace rejects calls.
- **New books:** a book added by any route (manual, photo, scan, libib import) is queued for tagging automatically. *(Claude's call.)*
- **Changed books:** if a book's description or cover changes, it is queued for a retag. A retag can add tags and replaces the card. It never removes a tag someone added by hand, and it never removes content tags. *(Claude's call.)*
- **Cover tags follow the cover.** Every tag records whether the tagger or a person added it. When the cover changes, the retag replaces the *auto-added* `cover-*` tags with ones for the new image, and hand-added cover tags stay. Books waiting in the cover finder are tagged as normal; their cover tags refresh once the new cover is applied. *(Claude's call: otherwise tags from placeholder or wrong-book images would stick forever.)*
- **New vocabulary.** When the vocabulary grows (approved suggestions or directly added tags), a **Check for new tags** action runs a cheap pass. It sends each book's card (summary and cover description, with no image) and asks only about the tags added since that card's vocabulary version. Retagging every book from scratch is not offered; **Retag this book** covers one-offs. *(Claude's call: keeps re-runs to cents rather than dollars.)*
- **Retag this book:** a button on the book page.

### 5.4 Never re-adding a removed tag

- When anyone removes a ToS tag or a library tag from a book, in the library app or in ToS, the removal is recorded as "removed by hand" for that book and tag.
- The tagger skips any tag recorded that way.
- Adding the tag back by hand clears the record.

The record must be written however the removal happens. A database trigger on delete is the natural fit; the builder decides.

### 5.5 Ask ✨ (layout A, chosen by Tierra)

Mockup: `.superpowers/brainstorm/` in this repo (git-ignored), `ask-layout.html`, option A.

- **Search box.** The existing search box gains an **Ask ✨** button. Typing keeps today's behaviour: instant matching on title, author and notes, with no cost.
- **What Ask sends.** Pressing Ask sends the exact wording of the box to the Ask function, along with the current filter state:
  - Unhauled books are hidden by default, since this is about picking something to read.
  - Whatever filters are active (owner, tags, series and so on) narrow the set. No new filters, such as location, are added in this plan.
- **What Claude reads.** Each book card in the filtered set, along with its title, authors, series, page count, publish year and tags. Claude may open the full description of a few top candidates when it needs to. *(Claude's call; at 257 books, every card fits in one request.)*
- **What comes back.** A ranked list, shown in place of the book list. Each row has the cover, title, a **confidence %** and a **one-line reason**. Matches under about 30% are dropped, and the list is capped at a reasonable length.
  - Tapping a row opens the book as usual.
  - Clearing Ask returns to the normal list.
- **Prompts that can't be answered from the book.** For prompts like author identity or "borrowed from a friend", Ask says so plainly rather than guessing. Title rules ("starts with B", "a number in the title", "spell R-E-A-D") are handled by Ask directly.
- **Cost.** Ask only spends money when the button is pressed. At the cap it says "This month's Ask budget is used up" and spends nothing more.

### 5.6 Tags in the app

- **Filters.** Library tags appear in the filter panel grouped by category, beside the existing ToS tag filter and with the same matching rules.
- **Book page.** Library tags show next to ToS tags and can be added or removed the same way. There is also a **Retag this book** button.
- **Mass edit.** Mass edit can add or remove library tags on the selected books. Removals count as "removed by hand".
- **Tag suggestions** screen, in the account menu next to Edition labels. It lists:
  - pending suggestions, each with **Approve** (adds the tag to the vocabulary and applies it to the books that suggested it) or **Dismiss**;
  - a way to add a vocabulary tag directly;
  - the **Tag all books** control with its estimate and progress.

  Approving a new tag doesn't retag the whole library automatically. A full re-run is a deliberate, estimated action. *(Claude's call.)*

### 5.7 Cost

- **Prices** (checked 2026-11-13):
  - Sonnet 5.5: $2 / $10 per million input / output tokens;
  - Haiku 5.5: $0.10 / $0.50;
  - batch processing is half price.
- **Estimates:**
  - Tagging all 257 books on Sonnet, with a cover image each, comes to about $3 interactively, or about $1.60 as a batch.
  - An Ask over all cards is about 8–10¢ on Sonnet.
- **Tracking:** spend is tracked per household per calendar month and per feature (tagging, Ask), in the same way the cover budget is tracked.
- **Before a run:** the full run shows its estimate first, based on the per-book cost measured at build time.

## 6. Left to the builder

These don't change what Tierra sees. The builder settles each one and records the decision in the plan.

1. **Models.** Measure on a synthetic set before choosing.
   - *Claude's lean:* `claude-sonnet-5-5` for tagging (world knowledge matters for edition-heavy descriptions) and for Ask (judgement and ranking).
   - Use `claude-haiku-5-5` for either if quality holds.
   - Set effort deliberately, and set cost estimates from measurements.
2. **Interactive or batch.** For the full run, either queue-and-drain in the open app (like covers) or the Message Batches API at half price, polled by the open app. There is no scheduler and no elevated server credential, as with `library-intake` and `library-covers`. Either way, it must stay inside the tagging cap (§4). If the full run still reaches the cap, it pauses and resumes the next month, saying so.
3. **Schema.** All household-scoped under RLS, with pgTAP tests:
   - vocabulary table (id, label, category, active), seeded from Appendix A, with a version;
   - book-to-library-tag table, recording who added each tag (tagger or person). `book_tags` needs the same marker for ToS tags (§5.3, cover tags);
   - book cards;
   - suggestions;
   - removed-by-hand records for both tag kinds;
   - monthly usage per feature.

   Tag id format should match `book_tags` (kebab-case, at most 40 characters) to keep a later merge easy.
4. **Functions.** A tagging function and an Ask function, or one function with two actions. Each acts only as the signed-in caller. Cover images are fetched server-side, with size and time limits.
5. **Ask output shape and limits.** Structured output of book ids, confidence and reason. Ids not in the household's set are discarded. Choose the result cap and the threshold behaviour.
6. **Books without a card yet.** Ask still includes them, using title, authors and a trimmed description.
7. **ToS impact.**
   - ToS reads `library.book_tags` for "On our shelf". Confirm that auto-added tags flow there as expected.
   - A removal made from ToS must also be recorded (§5.4).
   - If ToS needs any change, it goes in the same ToS PR.
8. **Vocabulary trimming.** Appendix A is a starting list. The builder may merge near-duplicates, but should keep the families (audience, pace, cover colour) intact.

## 7. Rollout (user-approved steps)

1. Merge the ToS PR (migration, functions, pgTAP).
2. `db push` and the function deploys, each with Tierra's go-ahead.
3. Merge the library-app PR, then hard-refresh (GitHub Pages caches JS for about 10 minutes).
4. Tierra's first run: tag about 10 books, check the tags and the measured cost, then **Tag all books**.
5. Try Ask on a handful of real prompts.

## Appendix A: Starting library-tag vocabulary

Drawn from the 318-prompt inventory, plus a few common tags no prompt named directly but that suit search. Tags already in ToS (cozy, dark, mythology, fae, dragons, multiple POV, non-linear, poetry and so on) are **not** repeated here.

- **Tropes:** morally-grey, bargains, chosen-one-destiny, retelling, secret-identity, found-family, enemies-to-lovers, heist-thieves, quest, romantic-subplot, spies, underdog, magic-awakening, trope-subversion, dark-romance, happy-ending, heartbreak
- **Creatures and beings:** ghosts, monsters, vampires, witches, shapeshifters, undead-zombies, gods-deities, demons-possession, immortals, aliens, supernatural
- **Setting:** wilderness, forest, royalty-courts, hidden-world, space, city-urban, small-town, school-academy, underground, water-setting, farm-rural, gardens, cafe-restaurant, holiday, winter-setting, summer-setting
- **Era:** era-historical, era-contemporary, era-future, era-secondary-world
- **Themes:** death, grief, afterlife, power-ambition, curses, deception, secrets, games-competitions, lost-and-searching, rebirth-resurrection, science-research, survival, transformation, family-expectations, food-cooking, greed-wealth, guardian-protector, healing, immigrant-refugee, music-arts, poison, political-intrigue, rebellion-revolution, self-worth, war, desire-temptation, fire
- **Mood and pace:** pace-fast, pace-slow, gothic, eerie, emotionally-intense, hopeful, humorous, lighthearted, lyrical-prose, psychological, witty-banter
- **Plot elements:** plot-twist, interpersonal-drama, action-battles, journey, memorable-villain, time-travel, balls-parties, based-on-true-story, explorers, first-contact, murder-mystery, ticking-clock, treasure-hunt, unusual-transport
- **Protagonist:** unreliable-narrator, flawed-protagonist, lgbtq-mc, trans-nonbinary-mc, nonhuman-mc, older-mc, child-mc, single-pov
- **Audience and subgenre:** audience-middle-grade, audience-ya, audience-adult, thriller, dystopian, epic-fantasy, memoir, play-drama
- **Cover colour:** cover-red, cover-orange, cover-yellow, cover-green, cover-blue, cover-purple, cover-pink, cover-black, cover-white, cover-brown, cover-gold
- **Cover motifs:** cover-animal, cover-plants, cover-illustrated, cover-figure, cover-landscape, cover-moon-stars, cover-skull, cover-heart, cover-weapon, cover-key-door, cover-book, cover-mushrooms, cover-antlers-horns, cover-fog-mist, cover-geometric
- **Facts (less certain):** has-adaptation, banned-challenged

Not included:
- `cover-foil`: a flat retail image rarely shows foil, so the tagger couldn't judge it reliably.
- per-season and character-age tags: too narrow. Ask covers them.

The full inventory (prompt-by-prompt) is in the coordinator's notes and is not committed, since it quotes third-party challenge text.
