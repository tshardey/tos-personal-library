/**
 * Single source of truth for Supabase env resolution and “configured” detection.
 * Must stay aligned with `createClient` in `supabase.ts` and GitHub Pages build injection.
 */

/** Default URL passed to `createClient` when `VITE_SUPABASE_URL` is missing (local CLI, tests). */
export const SUPABASE_DEFAULT_URL = 'http://127.0.0.1:54321';

/** Default publishable key when `VITE_SUPABASE_PUBLISHABLE_KEY` is missing — not a valid project key. */
export const SUPABASE_PLACEHOLDER_PUBLISHABLE_KEY = 'public-anon-placeholder';

/**
 * Resolved URL and publishable key for `@supabase/supabase-js` `createClient`.
 * Uses Vite `import.meta.env` with the same fallbacks as local dev when vars are unset.
 */
export function getSupabaseClientEnv(): { url: string; publishableKey: string } {
  const urlFromEnv = import.meta.env.VITE_SUPABASE_URL?.trim();
  const keyFromEnv = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim();
  return {
    url: urlFromEnv || SUPABASE_DEFAULT_URL,
    publishableKey: keyFromEnv || SUPABASE_PLACEHOLDER_PUBLISHABLE_KEY,
  };
}

/**
 * True when both Vite env vars are set to non-empty values and the key is not the placeholder.
 * Rejects the same “unconfigured” cases as `campaign-loader` / `createClient` defaults.
 */
export function isSupabaseConfigured(): boolean {
  const url = import.meta.env.VITE_SUPABASE_URL?.trim();
  const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim();
  if (!url || !key) return false;
  if (key === SUPABASE_PLACEHOLDER_PUBLISHABLE_KEY) return false;
  return true;
}
