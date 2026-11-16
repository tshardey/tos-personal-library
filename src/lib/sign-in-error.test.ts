import { describe, expect, it } from "vitest";
import { RATE_LIMIT_MESSAGE, signInErrorMessage } from "./sign-in-error";

/** Shaped like supabase-js's AuthApiError: an Error with `code` and `status`. */
function authError(message: string, extra: { code?: string; status?: number }): Error {
  return Object.assign(new Error(message), extra);
}

describe("signInErrorMessage", () => {
  it("explains Supabase's email rate limit by its code", () => {
    const err = authError("email rate limit exceeded", { code: "over_email_send_rate_limit", status: 429 });
    expect(signInErrorMessage(err)).toBe(RATE_LIMIT_MESSAGE);
  });

  it("explains any 429 the same way", () => {
    expect(signInErrorMessage(authError("Too many requests", { status: 429 }))).toBe(RATE_LIMIT_MESSAGE);
  });

  it("keeps other errors' own message", () => {
    expect(signInErrorMessage(authError("Unable to validate email address", { status: 400 }))).toBe(
      "Unable to validate email address",
    );
  });

  it("falls back for something that isn't an Error", () => {
    expect(signInErrorMessage("nope")).toBe("Sign-in failed.");
    expect(signInErrorMessage(null)).toBe("Sign-in failed.");
  });
});
