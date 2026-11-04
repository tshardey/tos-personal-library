import { afterEach, describe, expect, it, vi } from "vitest";
import { isSupabaseConfigured } from "./supabase-config";

describe("isSupabaseConfigured", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("is false for the placeholder key", () => {
    vi.stubEnv("VITE_SUPABASE_URL", "http://127.0.0.1:54321");
    vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "public-anon-placeholder");
    expect(isSupabaseConfigured()).toBe(false);
  });

  it("is false for an empty key", () => {
    vi.stubEnv("VITE_SUPABASE_URL", "http://127.0.0.1:54321");
    vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "");
    expect(isSupabaseConfigured()).toBe(false);
  });

  it("is true when url and a real key are set", () => {
    vi.stubEnv("VITE_SUPABASE_URL", "http://127.0.0.1:54321");
    vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_real");
    expect(isSupabaseConfigured()).toBe(true);
  });
});
