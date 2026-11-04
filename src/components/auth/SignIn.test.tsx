import { fireEvent, render, screen } from "@testing-library/react";

import { beforeEach, describe, expect, it, vi } from "vitest";

const signInWithEmail = vi.fn();
const isConfigured = vi.fn();

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: null, loading: false, signInWithEmail, signOut: vi.fn() }),
}));
vi.mock("@/lib/supabase-config", () => ({
  isSupabaseConfigured: () => isConfigured(),
}));

import SignIn from "./SignIn";

describe("SignIn", () => {
  beforeEach(() => {
    signInWithEmail.mockReset().mockResolvedValue(undefined);
    isConfigured.mockReset().mockReturnValue(true);
  });

  it("submits the email and confirms", async () => {
    render(<SignIn />);
    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: "a@b.co" } });
    fireEvent.click(screen.getByRole("button", { name: /sign in/i }));
    expect(signInWithEmail).toHaveBeenCalledWith("a@b.co");
    expect(await screen.findByText("Check your email for a sign-in link.")).toBeInTheDocument();
  });

  it("warns and disables the button when Supabase isn't configured", () => {
    isConfigured.mockReturnValue(false);
    render(<SignIn />);
    expect(screen.getByText(/Supabase isn't configured/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /sign in/i })).toBeDisabled();
  });
});
