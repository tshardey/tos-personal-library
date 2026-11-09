import type { ImportStore } from "@/lib/libib/apply";
import { supabase } from "@/lib/supabase";
import {
  fromBookPatch,
  fromCopyPatch,
  toBook,
  toCopy,
  type BookInput,
  type BookWithCopies,
  type Copy,
  type CopyInput,
} from "@/lib/types";

// PostgREST caps a response at the project's Max Rows (1000 by default, possibly lower), so a short
// page can't mean the end. Reading stops only on an empty page.
const PAGE_SIZE = 1000;

/** Every row across pages; any page's error rejects, so a partial list is never returned. */
export async function readAllPages<T>(
  readPage: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
): Promise<T[]> {
  const rows: T[] = [];
  for (let offset = 0; ; ) {
    const { data, error } = await readPage(offset, offset + PAGE_SIZE - 1);
    if (error) throw error;
    const page = data ?? [];
    if (page.length === 0) return rows;
    rows.push(...page);
    offset += page.length;
  }
}

export async function listBooks(householdId: string): Promise<BookWithCopies[]> {
  const rows = await readAllPages((from, to) =>
    supabase
      .from("books")
      .select("*, copies(*)")
      .eq("household_id", householdId)
      .order("title")
      .order("id")
      .range(from, to),
  );
  return rows.map((row) => ({
    ...toBook(row),
    copies: (row.copies ?? []).map(toCopy),
  }));
}

export async function listLibibLedger(householdId: string): Promise<Map<string, number>> {
  const rows = await readAllPages((from, to) =>
    supabase
      .from("libib_import_rows")
      .select("libib_id, copies_seen")
      .eq("household_id", householdId)
      .order("libib_id")
      .range(from, to),
  );
  return new Map(rows.map((row) => [row.libib_id, row.copies_seen]));
}

export async function createBook(
  householdId: string,
  input: BookInput,
  firstCopy: CopyInput,
): Promise<BookWithCopies> {
  const { data, error } = await supabase
    .from("books")
    .insert({ ...fromBookPatch(input), household_id: householdId })
    .select()
    .single();
  if (error) throw error;
  const book = toBook(data);
  try {
    const copy = await addCopy(book.id, firstCopy);
    return { ...book, copies: [copy] };
  } catch (err) {
    // Don't leave a copy-less book behind when the first copy fails.
    await supabase.from("books").delete().eq("id", book.id);
    throw err;
  }
}

export async function updateBook(
  id: string,
  patch: Partial<BookInput>,
  editedFields: string[],
): Promise<void> {
  const { error } = await supabase
    .from("books")
    .update({ ...fromBookPatch(patch), user_edited_fields: editedFields })
    .eq("id", id);
  if (error) throw error;
}

export async function deleteBook(id: string): Promise<void> {
  const { error } = await supabase.from("books").delete().eq("id", id);
  if (error) throw error;
}

export async function addCopy(bookId: string, input: CopyInput): Promise<Copy> {
  const { data, error } = await supabase
    .from("copies")
    .insert({ ...fromCopyPatch(input), book_id: bookId, origin: "manual" })
    .select()
    .single();
  if (error) throw error;
  return toCopy(data);
}

export async function updateCopy(
  id: string,
  patch: Partial<CopyInput>,
  editedFields: string[],
): Promise<void> {
  const { error } = await supabase
    .from("copies")
    .update({ ...fromCopyPatch(patch), user_edited_fields: editedFields })
    .eq("id", id);
  if (error) throw error;
}

export async function deleteCopy(id: string): Promise<void> {
  const { error } = await supabase.from("copies").delete().eq("id", id);
  if (error) throw error;
}

export const libibStore: ImportStore = {
  async insertBooks(rows) {
    const { error } = await supabase
      .from("books")
      .insert(rows.map((r) => ({ ...fromBookPatch(r.input), id: r.id, household_id: r.householdId })));
    if (error) throw error;
  },

  async insertCopies(rows) {
    const { error } = await supabase.from("copies").insert(
      rows.map((r) => ({
        book_id: r.bookId,
        owner_user_id: r.ownerUserId,
        edition_note: r.editionNote,
        libib_id: r.libibId,
        origin: "libib",
      })),
    );
    if (error) throw error;
  },

  async linkCopy(copyId, libibId) {
    const { error } = await supabase.from("copies").update({ libib_id: libibId }).eq("id", copyId);
    if (error) throw error;
  },

  async patchBook(bookId, expectedUpdatedAt, patch) {
    const { data, error } = await supabase
      .from("books")
      .update(fromBookPatch(patch))
      .eq("id", bookId)
      .eq("updated_at", expectedUpdatedAt)
      .select("id");
    if (error) throw error;
    return (data ?? []).length > 0;
  },

  async upsertLedger(householdId, rows) {
    const { error } = await supabase.from("libib_import_rows").upsert(
      rows.map((r) => ({ household_id: householdId, libib_id: r.libibId, copies_seen: r.copiesSeen })),
      { onConflict: "household_id,libib_id" },
    );
    if (error) throw error;
  },
};
