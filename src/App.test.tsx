import type { ReactNode } from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({
  user: null as { email: string } | null,
  household: null as { id: string; name: string; inviteCode: string; createdAt: string } | null,
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

vi.mock("@/contexts/HouseholdContext", () => ({
  HouseholdProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
  useHousehold: () => ({
    household: auth.household,
    members: [],
    loading: false,
    refresh: vi.fn(),
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
    auth.household = { id: "h1", name: "Home", inviteCode: "abc123", createdAt: "" };
    render(<App />);
    expect(screen.getByRole("heading", { name: "Our Library" })).toBeInTheDocument();
    expect(screen.getByText("a@b.co")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /sign out/i })).toBeInTheDocument();
    expect(screen.getByText("abc123")).toBeInTheDocument();
  });

  it("shows household setup when signed in without a household", () => {
    auth.user = { email: "a@b.co" };
    auth.household = null;
    render(<App />);
    expect(screen.getByRole("button", { name: /create household/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /join household/i })).toBeInTheDocument();
  });
});
