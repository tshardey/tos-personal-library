import { randomUUID } from "node:crypto";
import type { Page } from "@playwright/test";

/** The local stack only (global-setup checks the host). No secret or service-role key is used. */
export function supabaseEnv(): { url: string; key: string } {
  return {
    url: process.env.E2E_SUPABASE_URL ?? "http://host.docker.internal:54321",
    key: process.env.E2E_SUPABASE_PUBLISHABLE_KEY ?? "",
  };
}

export interface TestUser {
  email: string;
  userId: string;
  householdId: string;
  displayName: string;
  accessToken: string;
  session: Record<string, unknown>;
}

async function call(path: string, init: RequestInit & { token?: string }): Promise<unknown> {
  const { url, key } = supabaseEnv();
  const headers: Record<string, string> = {
    apikey: key,
    "Content-Type": "application/json",
    ...(init.headers as Record<string, string> | undefined),
  };
  if (init.token) headers.Authorization = `Bearer ${init.token}`;
  const res = await fetch(`${url}${path}`, { ...init, headers });
  const text = await res.text();
  if (!res.ok) throw new Error(`${init.method ?? "GET"} ${path.split("?")[0]} answered ${res.status}: ${text}`);
  return text ? JSON.parse(text) : null;
}

/** A fresh user through the public sign-up API, with a new household from `create_household`. */
export async function newUserWithHousehold(displayName = "Tester"): Promise<TestUser> {
  const email = `e2e-${randomUUID()}@example.test`;
  const password = `pw-${randomUUID()}`;
  const session = (await call("/auth/v1/signup", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  })) as Record<string, unknown> & { access_token: string; user: { id: string } };
  if (!session.access_token) throw new Error("sign-up returned no session (are email confirmations on?)");
  const householdId = (await call("/rest/v1/rpc/create_household", {
    method: "POST",
    token: session.access_token,
    headers: { "Content-Profile": "library" },
    body: JSON.stringify({ p_name: "E2E Household", p_display_name: displayName }),
  })) as string;
  return { email, userId: session.user.id, householdId, displayName, accessToken: session.access_token, session };
}

/** Signs the page in by storing the session where supabase-js looks for it. */
export async function signIn(page: Page, user: TestUser): Promise<void> {
  const { url } = supabaseEnv();
  const storageKey = `sb-${new URL(url).hostname.split(".")[0]}-auth-token`;
  await page.addInitScript(
    ([k, v]) => {
      if (!window.localStorage.getItem(k)) window.localStorage.setItem(k, v);
    },
    [storageKey, JSON.stringify(user.session)] as const,
  );
}

/** A read of the `library` schema as that user (RLS applies). */
export async function rest<T>(user: TestUser, pathAndQuery: string): Promise<T> {
  return (await call(`/rest/v1/${pathAndQuery}`, {
    token: user.accessToken,
    headers: { "Accept-Profile": "library" },
  })) as T;
}
