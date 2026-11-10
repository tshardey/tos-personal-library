import type { ReactNode } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({
  user: null as { email: string } | null,
  household: null as { id: string; name: string; inviteCode: string; createdAt: string } | null,
  error: null as string | null,
}));
const refresh = vi.hoisted(() => vi.fn());
const signOut = vi.hoisted(() => vi.fn());

vi.mock("@/contexts/AuthContext", () => ({
  AuthProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
  useAuth: () => ({
    user: auth.user,
    loading: false,
    signInWithEmail: vi.fn(),
    signOut,
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
  signOut.mockReset();
  window.location.hash = "";
});

function signedIn() {
  auth.user = { email: "a@b.co" };
  auth.household = { id: "h1", name: "Home", inviteCode: "abc123", createdAt: "" };
}

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
    expect(screen.queryByText("a@b.co")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Account" }));
    expect(screen.getByText("a@b.co")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /sign out/i })).toBeInTheDocument();
    expect(screen.getByText("abc123")).toBeInTheDocument();
  });

  describe("navigation", () => {
    const current = () => screen.getAllByRole("link").filter((a) => a.getAttribute("aria-current") === "page");

    it.each([
      ["#/", "Library"],
      ["#/scan", "Scan"],
      ["#/inbox", "Photos"],
      ["#/import", "Import"],
      ["#/add", "Library"],
      ["#/book/b1", "Library"],
    ])("marks the tab for %s as current", (hash, name) => {
      signedIn();
      window.location.hash = hash;
      render(<App />);
      expect(current().map((a) => a.textContent)).toEqual([name]);
    });

    it("follows the route when the hash changes", async () => {
      signedIn();
      render(<App />);
      expect(current().map((a) => a.textContent)).toEqual(["Library"]);
      await act(async () => {
        window.location.hash = "#/import";
        window.dispatchEvent(new HashChangeEvent("hashchange"));
      });
      expect(current().map((a) => a.textContent)).toEqual(["Import"]);
    });

    it("links the title to the library and shows the invite code only there", () => {
      signedIn();
      window.location.hash = "#/inbox";
      render(<App />);
      expect(screen.getByRole("link", { name: "Our Library" })).toHaveAttribute("href", "#/");
      expect(screen.queryByText("abc123")).not.toBeInTheDocument();
      cleanup();
      window.location.hash = "#/";
      render(<App />);
      expect(screen.getByText("abc123")).toBeInTheDocument();
    });
  });

  describe("account menu", () => {
    it("opens, closes on Escape and on an outside click, and signs out", () => {
      signedIn();
      render(<App />);
      const button = screen.getByRole("button", { name: "Account" });
      expect(button).toHaveAttribute("aria-expanded", "false");
      fireEvent.click(button);
      expect(button).toHaveAttribute("aria-expanded", "true");
      fireEvent.keyDown(document, { key: "Escape" });
      expect(screen.queryByRole("button", { name: /sign out/i })).not.toBeInTheDocument();
      expect(button).toHaveFocus();

      fireEvent.click(button);
      fireEvent.pointerDown(document.body);
      expect(screen.queryByRole("button", { name: /sign out/i })).not.toBeInTheDocument();

      fireEvent.click(button);
      fireEvent.pointerDown(screen.getByText("a@b.co"));
      expect(screen.getByRole("button", { name: /sign out/i })).toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: /sign out/i }));
      expect(signOut).toHaveBeenCalledTimes(1);
    });
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
