import { supabaseEnv } from "./supabase";

const LOCAL_HOSTS = new Set(["host.docker.internal", "127.0.0.1", "localhost"]);

/** Refuses to run against anything but a local Supabase stack. */
export default async function globalSetup(): Promise<void> {
  const { url, key } = supabaseEnv();
  const host = new URL(url).hostname;
  if (!LOCAL_HOSTS.has(host)) {
    throw new Error(`E2E refuses to run: Supabase host "${host}" is not local.`);
  }
  if (!key) throw new Error("E2E needs E2E_SUPABASE_PUBLISHABLE_KEY (the LOCAL stack's publishable key).");
  const res = await fetch(`${url}/auth/v1/health`, { headers: { apikey: key } }).catch((e: unknown) => {
    throw new Error(`Local Supabase at ${url} is unreachable (${e instanceof Error ? e.message : "error"}).`);
  });
  if (!res.ok) throw new Error(`Local Supabase auth health answered ${res.status}.`);
}
