import { supabase } from "@/lib/supabase";
import { toBook, toCopy, type BookWithCopies } from "@/lib/types";

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
