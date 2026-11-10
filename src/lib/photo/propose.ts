import { authorsOverlap, baseTitleKey, titleKey } from "../libib/match-keys";
import { canonicalIsbns, isbn10To13, normalizeIsbn10, normalizeIsbn13 } from "../libib/isbn";
import type { BookWithCopies } from "../types";
import { agrees } from "./lookup";
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
  | { kind: "new_book" }
  /** The photo is removed and nothing is written; only ever chosen by a person. */
  | { kind: "discard" };
export interface Proposal {
  query: { title: string; authors: string[]; isbns: string[] };
  candidates: Candidate[];
  ambiguous: boolean;
  inBatchTwins: string[];
  defaultAction: IntakeAction;
  needsTitle: boolean;
  /** D9: the photo's scanned ISBN resolved to a book whose title disagrees with what Claude read. */
  isbnConflict: boolean;
  /** D9: a same-batch ISBN twin where either item is a deliberate extra copy. */
  repeatScan: boolean;
}
export interface ProposeInput {
  item: IntakeItem;
  catalog: BookWithCopies[];
  openItems: IntakeItem[];
  titleOverride?: string;
  authorsOverride?: string[];
}
export type Confidence = "high" | "medium" | "low";

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

/** A found ISBN lookup (D7); a not-found one has `agrees: false`. */
function isbnLookup(item: IntakeItem) {
  const l = item.lookup;
  return l !== null && l.byIsbn === true && l.agrees && l.title !== null ? l : null;
}

/**
 * D9: the title and authors an item stands for without any typing: what Claude read, else what its
 * scanned ISBN resolved to. Shared by the query and by twin detection, so twins stay symmetric.
 */
function ownTitle(item: IntakeItem): { title: string; authors: string[] } {
  const ex = item.extraction;
  const byIsbn = isbnLookup(item);
  const title = ex?.title?.trim() ? ex.title : (byIsbn?.title ?? "");
  const authors = ex && ex.authors.length > 0 ? ex.authors : (byIsbn?.authors ?? []);
  return { title, authors };
}

/** The item's own ISBNs (scanned first, then a checksum-valid extraction ISBN), normalized. */
function ownIsbns(item: IntakeItem): string[] {
  const raw = [item.scannedIsbn, item.extraction?.isbn];
  return [...new Set(raw.map(toIsbn13).filter((v): v is string => v !== null))];
}

function queryOf(input: ProposeInput): Proposal["query"] {
  const { item, titleOverride, authorsOverride } = input;
  const own = ownTitle(item);
  const title = titleOverride?.trim() ? titleOverride : own.title;
  const authors = authorsOverride ?? own.authors;
  // D8: an agreeing lookup contributes ISBNs for matching only. A fuzzy agreement (similar, not
  // equal, title) may be a sibling volume, so its ISBNs would make that sibling the default.
  const lookup = item.lookup;
  const qKey = titleKey(title);
  const exact = lookup !== null && lookup.agrees && lookup.title !== null && qKey !== "" && titleKey(lookup.title) === qKey;
  const raw = [...ownIsbns(item), ...(exact ? lookup.matchIsbns : [])];
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

/** Title twins (P3) plus D9 ISBN twins: open items in any batch sharing a normalized own ISBN. */
function twinsOf(input: ProposeInput, q: Proposal["query"], qKey: string): { twins: string[]; repeatScan: boolean } {
  const { item } = input;
  const mine = new Set(ownIsbns(item));
  const twins: string[] = [];
  let repeatScan = false;
  for (const other of input.openItems) {
    if (other.id === item.id || !OPEN.has(other.status)) continue;
    if (ownIsbns(other).some((i) => mine.has(i))) {
      twins.push(other.id);
      if (other.batchId === item.batchId && (item.extraCopy || other.extraCopy)) repeatScan = true;
      continue;
    }
    if (qKey === "") continue;
    const o = ownTitle(other);
    const oKey = titleKey(o.title);
    if (oKey === "") continue;
    // Either side without authors counts as overlapping: a false twin only costs a manual tap.
    const overlap = q.authors.length === 0 || o.authors.length === 0 || authorsOverlap(q.authors, o.authors);
    if (oKey === qKey || (overlap && trigramSimilarity(qKey, oKey) >= SIMILAR_ANY_AUTHORS)) twins.push(other.id);
  }
  return { twins, repeatScan };
}

/**
 * D9: a photo with a scanned ISBN whose read title disagrees with what the ISBN resolved to: the
 * byIsbn lookup, else the catalog book that owns the scanned ISBN.
 */
function conflictOf(input: ProposeInput, isbnBooks: BookWithCopies[]): boolean {
  const { item } = input;
  const scanned = toIsbn13(item.scannedIsbn);
  const ex = item.extraction;
  if (item.source === "scan" || scanned === null || !ex?.title?.trim()) return false;
  const resolved = isbnLookup(item) ?? isbnBooks.find((b) => canonicalIsbns(b).has(scanned)) ?? null;
  if (resolved === null) return false;
  return !agrees({ title: ex.title, authors: ex.authors }, { title: resolved.title, authors: resolved.authors });
}

/**
 * Only isbn and same_title can be a default; a fuzzy or series candidate never is (Review Focus 3).
 * D9: an extra copy matched by ISBN is another copy by the person's own say-so (Review Focus 5).
 */
function defaultFor(
  top: Candidate | undefined,
  book: BookWithCopies | undefined,
  item: IntakeItem,
): IntakeAction {
  if (!top || !book || (top.reason !== "isbn" && top.reason !== "same_title")) return { kind: "new_book" };
  if (item.extraCopy && top.reason === "isbn") return { kind: "add_copy", bookId: book.id };
  const recorded = book.copies.some((c) => sameOwner(c.ownerUserId, item.ownerUserId));
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
  // D9 "the ISBN wins": among isbn matches, the scanned ISBN's book ranks strictly first.
  const scanned = toIsbn13(input.item.scannedIsbn);
  const ownsScanned = (c: Candidate) =>
    c.reason === "isbn" && scanned !== null && canonicalIsbns(books.get(c.bookId)!).has(scanned) ? 0 : 1;
  // Reason, then the scanned ISBN, then highest score, then oldest book, then id so the order
  // never depends on catalog order.
  found.sort(
    (a, b) =>
      RANK[a.reason] - RANK[b.reason] ||
      ownsScanned(a) - ownsScanned(b) ||
      b.score - a.score ||
      books.get(a.bookId)!.createdAt.localeCompare(books.get(b.bookId)!.createdAt) ||
      a.bookId.localeCompare(b.bookId),
  );
  const candidates = found.slice(0, MAX_CANDIDATES);
  const top = candidates[0];
  const isbnBooks = found.filter((c) => c.reason === "isbn").map((c) => books.get(c.bookId)!);
  const { twins, repeatScan } = twinsOf(input, query, qKey);
  return {
    query,
    candidates,
    ambiguous: found.filter((c) => c.reason === "isbn" || c.reason === "same_title").length > 1,
    inBatchTwins: twins,
    defaultAction: defaultFor(top, top && books.get(top.bookId), input.item),
    needsTitle: qKey === "",
    isbnConflict: conflictOf(input, isbnBooks),
    repeatScan,
  };
}

/** D9: a scan is high only when its ISBN lookup found the book; a photo is capped at medium on a conflict. */
export function itemConfidence(item: IntakeItem, proposal: Proposal): Confidence {
  if (item.source === "scan") return item.lookup?.agrees ? "high" : "low";
  const c = item.extraction?.confidence ?? "low";
  return proposal.isbnConflict && c === "high" ? "medium" : c;
}

/** D7/D9: only a ready, high-confidence, titled item with nothing to compare against may be bulk-added. */
export function bulkEligible(input: ProposeInput, proposal: Proposal): boolean {
  const { item } = input;
  return (
    item.status === "ready" &&
    (item.source === "scan" || item.extraction?.isBook === true) &&
    itemConfidence(item, proposal) === "high" &&
    !proposal.needsTitle &&
    proposal.candidates.length === 0 &&
    proposal.inBatchTwins.length === 0 &&
    !proposal.isbnConflict
  );
}
