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

// PostgREST caps responses at 1000 rows by default; page this query if the catalog grows beyond that.
export async function listBooks(householdId: string): Promise<BookWithCopies[]> {
  const { data, error } = await supabase
    .from("books")
    .select("*, copies(*)")
    .eq("household_id", householdId)
    .order("title");
  if (error) throw error;
  return (data ?? []).map((row) => ({
    ...toBook(row),
    copies: (row.copies ?? []).map(toCopy),
  }));
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
