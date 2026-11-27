# Series audit, undo dismiss and suggestion order: design

**Date:** 2026-11-22
**Status:** draft for Tierra's review
**Builds on:** `2026-11-17-series-suggestions-design.md` (Plan 10) and `2026-11-19-series-accuracy-design.md` (Plan 11), with their build notes. Everything there still holds unless this document changes it.
**Repos:** Tome of Secrets (migration and `library-tagger`) and the library app (the Series section of `#/tags`).

## 1. Why

Plan 11 stopped new wrong series: no cross-author auto-fill, more evidence, tighter rules, search when unsure. The re-check of every blank book worked well (282 checks for $1.01, then 26 retries for $0.07 after the enum fix). But a re-check only looks at **blank** books: `_apply_series` keeps any series a book already has. About 80 books carry a series that the tagger filled or that Tierra approved, much of it from before the accuracy fixes, and nothing checks those. Tierra: "I can't be sure we caught all of the issues."

Two smaller items join it because they change the same screen: undoing a dismissal, and the order of books inside a suggestion.

## 2. Goals and anti-goals

**Goals**
- Find books whose current series is likely wrong, mainly the **wrong series** (or a series on a standalone), and secondarily a **wrong book number**.
- Let Tierra settle each flagged book in one tap from the Series section.
- Let Tierra take back a dismissal.
- Show a suggestion's books in a predictable order.

**Anti-goals**
- The audit changing any book by itself. It only flags.
- Flagging, or spending on, a series Tierra set by hand.
- Surprise spend: the audit sits behind a confirm with a count and an estimate, like Find series.
- Auditing the same book again and again.
- Splitting one series into two spellings.
- An undo that re-runs a check or spends anything.

## 3. Decisions (Tierra's, 2026-11-22, unless marked)

1. **The flagged-book card is layout A** (mockup in `.superpowers/brainstorm/`): the book and author, a tag ("Wrong series?" or "Wrong number?"), **Now** (current series and number) beside **Audit** (the audit's answer, or "Standalone (no series)"), the audit's one-line reason, and three buttons: **Use audit's answer**, **Keep it**, **Edit…** (opens the series name and number fields).
2. **Wrong series is the focus; wrong numbers are flagged too.** *(Claude's call: wrong-series cards list before wrong-number cards.)*
3. **What's audited:** every book with a series **except** hand-set ones (`user_edited_fields` has `seriesName` or `seriesVolume`). That includes series Tierra approved from a suggestion. Series that come in with a book were to be left alone too, but **no path brings a series in with a book today**: Libib import, photo scan and manual add all create books with no series, and no Tome of Secrets writer sets one (checked in code and history, 2026-11-22). So all of the about 80 books were filled by the tagger or approved, and no source tracking is built. *(If an import ever starts bringing series in, that change adds the tracking.)*
4. **Every decision marks the series as set by Tierra.** Use audit's answer, Keep it and Edit… all add `seriesName` and `seriesVolume` to `user_edited_fields`, so the tagger and later audits leave the book alone. The card then goes away. *(Claude's call; Tierra agreed in chat.)*
5. **An audit that agrees shows nothing and changes nothing.**
6. **Spelling isn't wrong.** If the audit's series is the same series spelled differently (a missing "The", different punctuation or case), it counts as agreeing and nothing is flagged. The household's spelling wins. *(Claude's call.)*
7. **A doubted number isn't flagged unless the audit can name the right one.** *(Claude's call.)*
8. **A blank number is flagged when the audit knows it.** A book with the right series but no number gets a card when the audit names the number (same rule as decision 7: no named number, no card). It uses the `wrong_number` kind; the card's tag reads **"Missing number?"** and Now shows the series with no number. *(Tag wording is Claude's call.)* Missing-number cards list after wrong-number cards.
9. **Undo a dismissal:** a collapsed **"Dismissed (N)"** line at the bottom of the Series section lists each dismissed new series name and each book dismissed from an existing series, newest first *(Claude's call)*, each with **Undo**. Undo puts it back as a pending suggestion exactly as it was. Nothing is re-checked or charged *(Claude's call)*.
10. **Order inside a suggestion:** by book number ascending; books with no number after, by title. Applies to "new" and "Add to your series" cards.

## 4. How it works

### 4.1 The audit check (server and tagger)
- **New job kind `audit`** in `tag_jobs`, requested through `request_tagging` with a new reason (e.g. `audit`). Eligible: the book has a series, isn't hand-set, hasn't been audited since its series last changed, and has no active job. A newest failed audit job may be retried, as series checks can now (ToS #161).
- **Once per book:** a marker such as `book_cards.series_audited_at`, set by every audit finish, cleared whenever the book's series name or number changes. *(Builder's call where it lives; it must make a second Audit series press free for books already audited.)*
- **What the model gets:** the same evidence a series check gets (title, authors, description, summary, cover line, same-author household books with their series, Open Library's series data, household series names for spelling), plus the book's **current series and number**. It is asked whether that is right.
- **Neighbours can't vouch for each other** *(Claude's call)*. Each same-author household book in the evidence is marked as set by Tierra (hand-set) or filled by the tagger. The prompt says a tagger-filled neighbour is not evidence: several books by one author that the tagger put in the same wrong series must not confirm one another. Only hand-set neighbours and outside evidence count.
- **Answer:** `agree`, `wrong_series` (with the right series and number, or none for a standalone), `wrong_number` (with the right number), or `unsure`. The same rules as series checks apply (a number in the title isn't proof, a themed set or a loose collection of similar works isn't a series, the household list is for spelling only, page content is data). Decisions 6–8 apply: a spelling-only difference is `agree`, and a number is only flagged with a named number. Enums must reach the API (`_shared/output-format.ts`).
- **Server guard for spelling** *(Claude's call)*: when the proposed name matches the current one after the existing name normalisation (case, punctuation, a leading "The"), the server treats a `wrong_series` as agreeing, so a model slip can't produce a spelling-only card.
- **Search:** two_step like series checks. A tool-less call first; only `unsure` earns one search call (`max_uses` 2). If it's still unsure, nothing is flagged. Search fees are costed as now.
- **Money:** audit jobs settle at true cost like series jobs, under the tagging budget. Reserve: the series reserve (150,000 µ$) unless measurement says otherwise.
- **A flag** is written only for `wrong_series` and `wrong_number`, in a new table (e.g. `library.series_audit_flags`): household, book, kind, the current name and number **as audited**, the proposed name and number (null name for a standalone), the reason (trimmed to 200 characters), status (`pending`, `applied`, `kept`, `edited`), created and decided times. Members can read their household's flags; changes go through RPCs.
- **A stale flag** (the book's series changed after the audit, by hand or otherwise) is not shown and can't be applied. *(Claude's call.)*
- **Cross-author rule:** if the audit proposes a different existing household series, applying it is a decision by Tierra, so the author rule doesn't block it.

### 4.2 Decisions (RPCs)
- `apply_series_audit(flag)`: sets the proposed series and number (or clears the series for a standalone), marks the book hand-set, flag `applied`.
- `keep_series_audit(flag)`: changes nothing on the book except marking it hand-set, flag `kept`.
- Edit… saves through the normal book edit path, which already marks the series hand-set; the flag becomes `edited`. *(Builder's call whether that is an RPC or the edit path plus a flag update.)*
- All refuse a stale or non-pending flag cleanly, and only household members can call them.

### 4.3 Undo a dismissal (server)
- `undo_series_dismissal(...)` for a dismissed new series name (the suggestion goes back to pending with its books) and for one book dismissed from an existing series (that book's row goes back to pending). Books that have since been given a series or been hand-set stay out, as approve already handles. No job is queued.
- The library lists dismissed items with their decided time, newest first.

### 4.4 The library app
- **Series section order** (`#/tags`): the intro and Find series, then **Audit series**, then the suggestions, then **Check these series** (the flag cards: wrong series, then wrong number, then missing number), then the collapsed **Dismissed (N)**.
- **Audit series:** the same confirm as Find series (count, estimate, budget line, Confirm or Cancel), and the same progress line. The estimate constant comes from measurement (§5).
- **Flag cards:** layout A (§3.1). Edit… opens the name and number fields in the card (with the household series list, as the approve card does) and Save or Cancel.
- **Accessibility:** buttons and links meet the 44 px tap target on phones, focus moves to the section heading after a decision with a status message, and the Dismissed list is a real disclosure (button with `aria-expanded`).
- **README:** what the audit does, that it never changes a book by itself, its cost, and undo.

## 5. Measurement

A real-API measurement like Plan 11 Task 6, on **invented books only**, capped at **$0.25** *(Claude's call; Tierra can change it)*, with the key passed via `docker run --env-file` and never opened. It sets the audit estimate and confirms the reserve. Gate: 0 invented books flagged wrongly in each case:
- a correct series (must agree);
- the same series spelled differently (must agree);
- a wrong series;
- a standalone carrying a series;
- a wrong number;
- a **cluster**: three books by one invented author all tagger-filled into the same wrong series, with no hand-set neighbour (each must be flagged, not vouched for by the others);
- an unknown book (must not be flagged);
- a right series with a blank number the book's evidence makes clear (must be flagged with that number);
- a right series with a blank number nothing names (must not be flagged).

## 6. Rollout

ToS PR → production `db push` and `library-tagger` deploy with Tierra's go-ahead → library PR → Tierra runs Audit series. The first audit of about 80 books is expected to cost about 25–40¢. Either side alone is safe: the old app ignores the new table and kind; the new app shows nothing to audit until the server side is live.

## 7. Left to the builder
- Where the audit marker lives and how it's cleared on a series change.
- Table, RPC and constant names.
- How hand-set and tagger-filled neighbours are labelled in the prompt.
- Whether full tag jobs ever audit (default: no; only Audit series does).
