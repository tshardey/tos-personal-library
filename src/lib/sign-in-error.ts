export const RATE_LIMIT_MESSAGE =
  "Too many sign-in emails have been sent in the last hour. Wait up to an hour, then try once.";

/**
 * What the sign-in form says when sending the link fails. Supabase's built-in email sender allows
 * a few emails an hour across the whole project, and its own wording ("email rate limit exceeded")
 * doesn't say what to do.
 */
export function signInErrorMessage(err: unknown): string {
  if (typeof err === "object" && err !== null) {
    const { code, status } = err as { code?: unknown; status?: unknown };
    if (code === "over_email_send_rate_limit" || status === 429) return RATE_LIMIT_MESSAGE;
  }
  return err instanceof Error ? err.message : "Sign-in failed.";
}
