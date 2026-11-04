import { supabase } from "@/lib/supabase";
import type { Household, HouseholdMember } from "@/lib/types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;

function toHousehold(row: Row): Household {
  return { id: row.id, name: row.name, inviteCode: row.invite_code, createdAt: row.created_at };
}

function toMember(row: Row): HouseholdMember {
  return {
    householdId: row.household_id,
    userId: row.user_id,
    displayName: row.display_name,
    createdAt: row.created_at,
  };
}

/**
 * The signed-in user's household. If they belong to several, the earliest-joined wins
 * (one household per person in practice). Returns null when they have none.
 */
export async function getMyHousehold(): Promise<{
  household: Household;
  members: HouseholdMember[];
} | null> {
  const { data: sessionData } = await supabase.auth.getSession();
  const userId = sessionData.session?.user.id;
  if (!userId) return null;

  const { data: mine, error: mineError } = await supabase
    .from("household_members")
    .select("household_id")
    .eq("user_id", userId)
    .order("created_at", { ascending: true })
    .limit(1);
  if (mineError) throw mineError;
  const householdId = mine?.[0]?.household_id as string | undefined;
  if (!householdId) return null;

  const [householdRes, membersRes] = await Promise.all([
    supabase.from("households").select("*").eq("id", householdId).single(),
    supabase
      .from("household_members")
      .select("*")
      .eq("household_id", householdId)
      .order("created_at", { ascending: true }),
  ]);
  if (householdRes.error) throw householdRes.error;
  if (membersRes.error) throw membersRes.error;
  return {
    household: toHousehold(householdRes.data),
    members: (membersRes.data ?? []).map(toMember),
  };
}

export async function createHousehold(name: string, displayName: string): Promise<string> {
  const { data, error } = await supabase.rpc("create_household", {
    p_name: name,
    p_display_name: displayName,
  });
  if (error) throw error;
  return data as string;
}

export async function joinHousehold(inviteCode: string, displayName: string): Promise<string> {
  const { data, error } = await supabase.rpc("join_household", {
    p_invite_code: inviteCode,
    p_display_name: displayName,
  });
  if (error) {
    if (error.message?.includes("invalid_invite_code")) throw new Error("invalid_invite_code");
    throw error;
  }
  return data as string;
}
