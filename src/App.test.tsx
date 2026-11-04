import type { ReactNode } from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({
  user: null as { email: string } | null,
}));

vi.mock("@/contexts/AuthContext", () => ({
  AuthProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
  useAuth: () => ({
    user: auth.user,
    loading: false,
    signInWithEmail: vi.fn(),
    signOut: vi.fn(),
  }),
}));

import App from "./App";

describe("App", () => {
  it("shows sign-in when signed out", () => {
    auth.user = null;
    render(<App />);
    expect(screen.getByRole("button", { name: /sign in/i })).toBeInTheDocument();
  });

  it("shows the shell with email and sign out when signed in", () => {
    auth.user = { email: "a@b.co" };
    render(<App />);
    expect(screen.getByRole("heading", { name: "Our Library" })).toBeInTheDocument();
    expect(screen.getByText("a@b.co")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /sign out/i })).toBeInTheDocument();
  });
});
