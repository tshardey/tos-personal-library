import { act, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({
  getSession: vi.fn(async () => ({ data: { session: null } })),
  onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })),
  signOut: vi.fn(async () => ({ error: null })),
}));
vi.mock("@/lib/supabase", () => ({ supabase: { auth } }));

import { AuthProvider, useAuth } from "./AuthContext";

describe("AuthProvider", () => {
  it("keeps the remembered email through sign-out", async () => {
    localStorage.setItem("tpl_last_email", "reader@example.com");
    let signOut: () => Promise<void> = async () => {};
    function Grab() {
      signOut = useAuth().signOut;
      return null;
    }
    render(
      <AuthProvider>
        <Grab />
      </AuthProvider>,
    );
    await act(() => signOut());
    expect(auth.signOut).toHaveBeenCalled();
    expect(localStorage.getItem("tpl_last_email")).toBe("reader@example.com");
  });
});
