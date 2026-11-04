import type { ReactNode } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({
  user: null as { email: string } | null,
  household: null as { id: string; name: string; inviteCode: string; createdAt: string } | null,
  error: null as string | null,
}));
const refresh = vi.hoisted(() => vi.fn());

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
    error: auth.error,
    refresh,
  }),
}));

vi.mock("@/hooks/useCatalog", () => ({
  useCatalog: () => ({ books: [], loading: false, error: null, reload: vi.fn() }),
}));

import App from "./App";

beforeEach(() => {
  auth.household = null;
  auth.error = null;
  refresh.mockReset();
});

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
    render(<App />);
    expect(screen.getByRole("button", { name: /create household/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /join household/i })).toBeInTheDocument();
  });

  it("shows a retry state instead of setup when the household lookup failed", () => {
    auth.user = { email: "a@b.co" };
    auth.error = "Couldn't load your household.";
    render(<App />);
    expect(screen.queryByRole("button", { name: /create household/i })).not.toBeInTheDocument();
    expect(screen.getByText("Couldn't load your household.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /retry/i }));
    expect(refresh).toHaveBeenCalled();
  });
});
