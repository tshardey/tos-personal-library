import { authorsOverlap, baseTitleKey, titleKey } from "../libib/match-keys";
import { canonicalIsbns, isbn10To13, normalizeIsbn10, normalizeIsbn13 } from "../libib/isbn";
import type { BookWithCopies } from "../types";
import { trigramSimilarity } from "./similarity";
import type { IntakeItem } from "./types";

export type CandidateReason = "isbn" | "same_title" | "series_sibling" | "similar_title";
export interface Candidate {
  bookId: string;
  reason: CandidateReason;
  /** 1 for isbn and same_title; trigram similarity of the title keys for the other reasons. */
  score: number;
}
export type IntakeAction =
  | { kind: "add_copy"; bookId: string }
  | { kind: "already_recorded"; bookId: string }
  | { kind: "new_book" };
export interface Proposal {
  query: { title: string; authors: string[]; isbns: string[] };
  candidates: Candidate[];
  ambiguous: boolean;
  inBatchTwins: string[];
  defaultAction: IntakeAction;
  needsTitle: boolean;
}
export interface ProposeInput {
  item: IntakeItem;
  catalog: BookWithCopies[];
  openItems: IntakeItem[];
  titleOverride?: string;
  authorsOverride?: string[];
}

/** D6: similar needs 0.5 with authors agreeing (or none read), or 0.8 whatever the authors. Also the twin threshold. */
export const SIMILAR_WITH_AUTHORS = 0.5;
export const SIMILAR_ANY_AUTHORS = 0.8;
const MAX_CANDIDATES = 3;
const OPEN = new Set(["pending", "processing", "ready", "failed"]);
const RANK: Record<CandidateReason, number> = { isbn: 0, same_title: 1, series_sibling: 2, similar_title: 3 };

export function sameOwner(copyOwner: string | null, itemOwner: string | null): boolean {
  return copyOwner === itemOwner;
}

function toIsbn13(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const i13 = normalizeIsbn13(raw);
  if (i13) return i13;
  const i10 = normalizeIsbn10(raw);
  return i10 ? isbn10To13(i10) : null;
}

function queryOf(input: ProposeInput): Proposal["query"] {
  const { item, titleOverride, authorsOverride } = input;
  const title = titleOverride?.trim() ? titleOverride : (item.extraction?.title ?? "");
  const authors = authorsOverride ?? item.extraction?.authors ?? [];
  // D8: an agreeing lookup contributes ISBNs for matching only; its title is never used.
  const raw = [item.extraction?.isbn, ...(item.lookup?.agrees ? item.lookup.matchIsbns : [])];
  const isbns = [...new Set(raw.map(toIsbn13).filter((v): v is string => v !== null))];
  return { title, authors, isbns };
}

function classify(q: Proposal["query"], qKey: string, book: BookWithCopies): Candidate | null {
  if (q.isbns.length > 0) {
    const owned = canonicalIsbns(book);
    if (q.isbns.some((i) => owned.has(i))) return { bookId: book.id, reason: "isbn", score: 1 };
  }
  if (qKey === "") return null;
  const bKey = titleKey(book.title);
  if (bKey === "") return null;
  const overlap = authorsOverlap(q.authors, book.authors);
  if (bKey === qKey && overlap) return { bookId: book.id, reason: "same_title", score: 1 };
  const score = trigramSimilarity(qKey, bKey);
  const base = baseTitleKey(q.title);
  if (base !== "" && base === baseTitleKey(book.title) && bKey !== qKey && overlap) {
    return { bookId: book.id, reason: "series_sibling", score };
  }
  const authorsOk = overlap || q.authors.length === 0;
  if ((score >= SIMILAR_WITH_AUTHORS && authorsOk) || score >= SIMILAR_ANY_AUTHORS) {
    return { bookId: book.id, reason: "similar_title", score };
  }
  return null;
}

function twinsOf(input: ProposeInput, q: Proposal["query"], qKey: string): string[] {
  if (qKey === "") return [];
  const out: string[] = [];
  for (const other of input.openItems) {
    if (other.id === input.item.id || !OPEN.has(other.status) || !other.extraction) continue;
    const oKey = titleKey(other.extraction.title ?? "");
    if (oKey === "") continue;
    // Either side without authors counts as overlapping: a false twin only costs a manual tap.
    const oAuthors = other.extraction.authors;
    const overlap = q.authors.length === 0 || oAuthors.length === 0 || authorsOverlap(q.authors, oAuthors);
    if (oKey === qKey || (overlap && trigramSimilarity(qKey, oKey) >= SIMILAR_ANY_AUTHORS)) out.push(other.id);
  }
  return out;
}

/** Only isbn and same_title can be a default; a fuzzy or series candidate never is (Review Focus 3). */
function defaultFor(top: Candidate | undefined, book: BookWithCopies | undefined, owner: string | null): IntakeAction {
  if (!top || !book || (top.reason !== "isbn" && top.reason !== "same_title")) return { kind: "new_book" };
  const recorded = book.copies.some((c) => sameOwner(c.ownerUserId, owner));
  return { kind: recorded ? "already_recorded" : "add_copy", bookId: book.id };
}

/** Pure: recomputed on every render from the item, the current catalog and the other open items. */
export function proposeMatch(input: ProposeInput): Proposal {
  const query = queryOf(input);
  const qKey = titleKey(query.title);
  const books = new Map(input.catalog.map((b) => [b.id, b]));
  const found: Candidate[] = [];
  for (const book of input.catalog) {
    const c = classify(query, qKey, book);
    if (c) found.push(c);
  }
  // Reason, then highest score, then oldest book, then id so the order never depends on catalog order.
  found.sort(
    (a, b) =>
      RANK[a.reason] - RANK[b.reason] ||
      b.score - a.score ||
      books.get(a.bookId)!.createdAt.localeCompare(books.get(b.bookId)!.createdAt) ||
      a.bookId.localeCompare(b.bookId),
  );
  const candidates = found.slice(0, MAX_CANDIDATES);
  const top = candidates[0];
  return {
    query,
    candidates,
    ambiguous: found.filter((c) => c.reason === "isbn" || c.reason === "same_title").length > 1,
    inBatchTwins: twinsOf(input, query, qKey),
    defaultAction: defaultFor(top, top && books.get(top.bookId), input.item.ownerUserId),
    needsTitle: qKey === "",
  };
}

/** D7: only a ready, high-confidence, titled item with nothing to compare against may be bulk-added. */
export function bulkEligible(input: ProposeInput, proposal: Proposal): boolean {
  const { item } = input;
  return (
    item.status === "ready" &&
    item.extraction?.isBook === true &&
    item.extraction.confidence === "high" &&
    !proposal.needsTitle &&
    proposal.candidates.length === 0 &&
    proposal.inBatchTwins.length === 0
  );
}
