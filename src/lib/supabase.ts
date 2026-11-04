import { createClient } from "@supabase/supabase-js";
import { getSupabaseClientEnv } from "@/lib/supabase-config";

const { url, publishableKey } = getSupabaseClientEnv();

/**
 * Supabase client scoped to the library schema. The default auth storage key is
 * intentionally left alone: the session is shared with Tome of Secrets on the same origin.
 */
export const supabase = createClient(url, publishableKey, { db: { schema: "library" } });
