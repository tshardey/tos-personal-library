/**
 * The last email that opened a household on this device, so the sign-in box suggests it after a
 * sign-out. Only the address, never a token. Kept on purpose through sign-out. Blocked storage
 * means an empty box and nothing remembered.
 */
const LAST_EMAIL_KEY = "tpl_last_email";

export function loadLastEmail(): string {
  try {
    return localStorage.getItem(LAST_EMAIL_KEY) ?? "";
  } catch {
    return "";
  }
}

export function saveLastEmail(email: string): void {
  try {
    localStorage.setItem(LAST_EMAIL_KEY, email);
  } catch {
    // Not remembered.
  }
}
