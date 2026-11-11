import type { ImportStore } from "../libib/apply";
import { fillPatch } from "../libib/fill-patch";
import { canonicalIsbns, isbn10To13, normalizeIsbn10, normalizeIsbn13 } from "../libib/isbn";
import type { BookWithCopies, CopyInput } from "../types";
import type { confirmItem, discardItem, NewBookInput } from "./intake-repo";
import { bulkEligible, proposeMatch, type IntakeAction } from "./propose";
import type { IntakeItem } from "./types";

export interface ConfirmForm {
  title: string;
  authors: string[];
  copy: CopyInput;
}

export interface ConfirmDeps {
  confirm: typeof confirmItem;
  discard: typeof discardItem;
  patchBook: ImportStore["patchBook"];
  enrich: (books: BookWithCopies[]) => Promise<unknown>;
  catalog: BookWithCopies[];
  purge(): Promise<unknown>;
}

/** The photo ISBN, checksum-valid only, as both forms where it came as ISBN-10. */
function photoIsbns(raw: string | null | undefined): { isbn13: string[]; isbn10: string[] } {
  if (!raw) return { isbn13: [], isbn10: [] };
  const i13 = normalizeIsbn13(raw);
  if (i13) return { isbn13: [i13], isbn10: [] };
  const i10 = normalizeIsbn10(raw);
  return i10 ? { isbn13: [isbn10To13(i10)], isbn10: [i10] } : { isbn13: [], isbn10: [] };
}

/** D9: the scanned ISBN wins; otherwise the photo's checksum-valid ISBN. */
function itemIsbns(item: IntakeItem): { isbn13: string[]; isbn10: string[] } {
  const scanned = item.scannedIsbn === null ? null : normalizeIsbn13(item.scannedIsbn);
  return scanned ? { isbn13: [scanned], isbn10: [] } : photoIsbns(item.extraction?.isbn);
}

/**
 * D8: title and authors as the person left them; ISBNs only from the item itself (its scanned
 * ISBN, else the photo's); stock details only from a lookup that agrees (a byIsbn lookup always
 * does), and never its ISBNs (a title search returns every edition's). The OpenLibrary id is the
 * work id (`OL…W`, without `/works/`), as lookup.ts stores it.
 */
export function lookupAsBookInput(title: string, authors: string[], item: IntakeItem): NewBookInput {
  const { extraction, lookup } = item;
  const ok = lookup?.agrees === true ? lookup : null;
  return {
    title,
    authors,
    synopsis: ok?.synopsis ?? null,
    coverUrl: ok?.coverUrl ?? null,
    ...itemIsbns(item),
    pageCount: ok?.pageCount ?? null,
    publisher: extraction?.publisher ?? null,
    publishDate: ok?.publishDate ?? null,
    openlibraryId: ok?.openlibraryId ?? null,
    googleBooksId: ok?.googleBooksId ?? null,
  };
}

const errName = (e: unknown) => (e instanceof Error ? e.name : "unknown");

async function quietly(label: string, fn: () => Promise<unknown>): Promise<void> {
  try {
    await fn();
  } catch (e) {
    console.error(label, errName(e));
  }
}

/**
 * One person-confirmed write (D7, D14). Only the RPC can reject; the fill-only patch, the
 * enrichment and the purge after it are best-effort and are repeated safely by a retry.
 */
export async function performConfirm(
  item: IntakeItem,
  action: IntakeAction,
  form: ConfirmForm,
  deps: ConfirmDeps,
): Promise<{ bookId: string | null }> {
  if (action.kind === "already_recorded" || action.kind === "discard") {
    await deps.discard(item.id, action.kind === "discard" ? "discarded" : "already_recorded");
    await quietly("intake purge failed", deps.purge);
    return { bookId: null };
  }

  const input = lookupAsBookInput(form.title, form.authors, item);
  let toEnrich: BookWithCopies | null = null;
  let bookId: string;
  if (action.kind === "add_copy") {
    ({ bookId } = await deps.confirm(item.id, { bookId: action.bookId }, form.copy));
    const book = deps.catalog.find((b) => b.id === bookId);
    if (book) {
      const { patch } = fillPatch(book, input);
      if (Object.keys(patch).length > 0) {
        await quietly("intake fill patch failed", () => deps.patchBook(book.id, book.updatedAt, patch));
      }
      if (canonicalIsbns(book).size > 0 || input.isbn13.length > 0) toEnrich = book;
    }
  } else {
    ({ bookId } = await deps.confirm(item.id, { book: input }, form.copy));
    if (input.isbn13.length > 0) {
      const now = new Date().toISOString();
      toEnrich = {
        ...input,
        id: bookId,
        householdId: item.householdId,
        openlibraryId: input.openlibraryId ?? null,
        googleBooksId: input.googleBooksId ?? null,
        seriesName: null,
        seriesVolume: null,
        userEditedFields: [],
        createdAt: now,
        updatedAt: now,
        copies: [],
      };
    }
  }
  await quietly("intake purge failed", deps.purge);
  // Network-bound and fill-only: started, not awaited, so the card doesn't wait on OpenLibrary.
  if (toEnrich) {
    const books = [toEnrich];
    void quietly("intake enrich failed", () => deps.enrich(books));
  }
  return { bookId };
}

/**
 * D7 bulk confirm: before each write, refresh and recompute the proposal against the catalog as
 * the earlier writes left it. Anything no longer eligible is skipped and left on its card. A
 * failed refresh rejects, so nothing is written against a stale catalog.
 */
export async function runBulkConfirm(
  itemIds: string[],
  getState: () => { catalog: BookWithCopies[]; openItems: IntakeItem[] },
  deps: {
    perform: (item: IntakeItem, action: IntakeAction, form: ConfirmForm) => Promise<{ bookId: string | null }>;
    refresh(): Promise<void>;
  },
): Promise<{ confirmed: number; skipped: number }> {
  let confirmed = 0;
  let skipped = 0;
  for (const id of itemIds) {
    await deps.refresh();
    const { catalog, openItems } = getState();
    const item = openItems.find((i) => i.id === id);
    if (!item) {
      skipped += 1;
      continue;
    }
    const input = { item, catalog, openItems };
    const proposal = proposeMatch(input);
    if (!bulkEligible(input, proposal)) {
      skipped += 1;
      continue;
    }
    try {
      // D12: the edition is the item's own label; Claude's clues are only a hint and never prefill it.
      await deps.perform(item, { kind: "new_book" }, {
        title: proposal.query.title,
        authors: proposal.query.authors,
        copy: { ownerUserId: item.ownerUserId, editionNote: item.editionLabel, copyNote: null, location: null },
      });
      confirmed += 1;
    } catch (e) {
      // The RPC is idempotent, so this card can simply be confirmed again by hand.
      console.error("bulk confirm failed", errName(e));
      skipped += 1;
    }
  }
  return { confirmed, skipped };
}
