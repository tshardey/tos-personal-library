import { act, fireEvent, render, screen } from "@testing-library/react";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const signInWithEmail = vi.fn();
const isConfigured = vi.fn();

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: null, loading: false, signInWithEmail, signOut: vi.fn() }),
}));
vi.mock("@/lib/supabase-config", () => ({
  isSupabaseConfigured: () => isConfigured(),
}));

import SignIn from "./SignIn";

const SENT = "Sent a link to reader@example.com. Check that inbox, and don't request another";

function submit(email: string) {
  fireEvent.change(screen.getByLabelText(/email/i), { target: { value: email } });
  fireEvent.click(screen.getByRole("button", { name: /sign in/i }));
}

describe("SignIn", () => {
  beforeEach(() => {
    localStorage.clear();
    signInWithEmail.mockReset().mockResolvedValue(undefined);
    isConfigured.mockReset().mockReturnValue(true);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("submits the email and names the inbox the link went to", async () => {
    render(<SignIn />);
    submit(" reader@example.com ");
    expect(signInWithEmail).toHaveBeenCalledWith("reader@example.com");
    expect(await screen.findByText(new RegExp(`^${SENT}`))).toHaveTextContent(
      "each one uses up the hourly email allowance.",
    );
  });

  it("holds Sign in for a minute after a link is sent", async () => {
    vi.useFakeTimers();
    render(<SignIn />);
    submit("reader@example.com");
    await act(async () => {});
    const button = screen.getByRole("button", { name: /sign in/i });
    expect(button).toBeDisabled();
    act(() => vi.advanceTimersByTime(59_000));
    expect(button).toBeDisabled();
    act(() => vi.advanceTimersByTime(1_000));
    expect(button).toBeEnabled();
  });

  it("drops the cooldown timer when it unmounts", async () => {
    vi.useFakeTimers();
    const { unmount } = render(<SignIn />);
    submit("reader@example.com");
    await act(async () => {});
    expect(vi.getTimerCount()).toBe(1);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("explains the hourly email limit instead of Supabase's wording", async () => {
    signInWithEmail.mockRejectedValue(
      Object.assign(new Error("email rate limit exceeded"), { code: "over_email_send_rate_limit", status: 429 }),
    );
    render(<SignIn />);
    submit("reader@example.com");
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Too many sign-in emails have been sent in the last hour. Wait up to an hour, then try once.",
    );
    expect(screen.queryByText(/rate limit exceeded/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /sign in/i })).toBeEnabled();
  });

  it("shows other errors as before", async () => {
    signInWithEmail.mockRejectedValue(new Error("Unable to validate email address"));
    render(<SignIn />);
    submit("reader@example.com");
    expect(await screen.findByRole("alert")).toHaveTextContent("Unable to validate email address");
  });

  it("starts with the last email that opened a library, and lets you change it", () => {
    localStorage.setItem("tpl_last_email", "reader@example.com");
    render(<SignIn />);
    const input = screen.getByLabelText(/email/i);
    expect(input).toHaveValue("reader@example.com");
    fireEvent.change(input, { target: { value: "other@example.com" } });
    expect(input).toHaveValue("other@example.com");
  });

  it("starts empty when storage is blocked", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("blocked", "SecurityError");
    });
    render(<SignIn />);
    expect(screen.getByLabelText(/email/i)).toHaveValue("");
  });

  it("warns and disables the button when Supabase isn't configured", () => {
    isConfigured.mockReturnValue(false);
    render(<SignIn />);
    expect(screen.getByText(/Supabase isn't configured/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /sign in/i })).toBeDisabled();
  });
});
