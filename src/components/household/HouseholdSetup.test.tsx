import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const repo = vi.hoisted(() => ({
  createHousehold: vi.fn(),
  joinHousehold: vi.fn(),
}));
const refresh = vi.hoisted(() => vi.fn());
const signOut = vi.hoisted(() => vi.fn());

vi.mock("@/lib/household-repo", () => repo);
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: { email: "a@b.co" }, loading: false, signOut }),
}));
vi.mock("@/contexts/HouseholdContext", () => ({
  useHousehold: () => ({ household: null, members: [], loading: false, error: null, refresh }),
}));

import HouseholdSetup from "./HouseholdSetup";

beforeEach(() => {
  repo.createHousehold.mockReset();
  repo.joinHousehold.mockReset();
  refresh.mockReset();
  refresh.mockResolvedValue(undefined);
  signOut.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

function fillCreate() {
  fireEvent.change(screen.getByLabelText("Household name"), { target: { value: "Home" } });
  fireEvent.change(screen.getByLabelText("Your name", { selector: "#create-display-name" }), {
    target: { value: "Tierra" },
  });
  fireEvent.click(screen.getByRole("button", { name: /create household/i }));
}

function fillJoin(code: string) {
  fireEvent.change(screen.getByLabelText("Invite code"), { target: { value: code } });
  fireEvent.change(screen.getByLabelText("Your name", { selector: "#join-display-name" }), {
    target: { value: "Sam" },
  });
  fireEvent.click(screen.getByRole("button", { name: /join household/i }));
}

describe("HouseholdSetup", () => {
  it("creates a household then refreshes", async () => {
    repo.createHousehold.mockResolvedValue("h1");
    render(<HouseholdSetup />);
    fillCreate();
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(repo.createHousehold).toHaveBeenCalledWith("Home", "Tierra");
  });

  it("joins with an invite code then refreshes", async () => {
    repo.joinHousehold.mockResolvedValue("h1");
    render(<HouseholdSetup />);
    fillJoin("abc123");
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(repo.joinHousehold).toHaveBeenCalledWith("abc123", "Sam");
  });

  it("shows a friendly error for an invalid invite code and does not refresh", async () => {
    repo.joinHousehold.mockRejectedValue(new Error("invalid_invite_code"));
    render(<HouseholdSetup />);
    fillJoin("nope");
    expect(await screen.findByText("That invite code didn't match a household.")).toBeInTheDocument();
    expect(refresh).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /join household/i })).toBeEnabled();
  });

  it("shows generic copy for other join failures", async () => {
    repo.joinHousehold.mockRejectedValue(new Error("secret db detail"));
    render(<HouseholdSetup />);
    fillJoin("x");
    expect(await screen.findByText("Couldn't join the household. Try again.")).toBeInTheDocument();
    expect(screen.queryByText(/secret db detail/)).not.toBeInTheDocument();
  });

  it("shows generic copy for create failures", async () => {
    repo.createHousehold.mockRejectedValue(new Error("secret db detail"));
    render(<HouseholdSetup />);
    fillCreate();
    expect(await screen.findByText("Couldn't create the household. Try again.")).toBeInTheDocument();
    expect(screen.queryByText(/secret db detail/)).not.toBeInTheDocument();
  });

  it("does not show a create error when the RPC succeeds but refresh fails", async () => {
    repo.createHousehold.mockResolvedValue("h1");
    refresh.mockRejectedValue(new Error("boom"));
    render(<HouseholdSetup />);
    fillCreate();
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByRole("button", { name: /create household/i })).toBeEnabled());
    expect(screen.queryByText(/Couldn't create/)).not.toBeInTheDocument();
  });

  it("offers sign out", () => {
    render(<HouseholdSetup />);
    fireEvent.click(screen.getByRole("button", { name: /sign out/i }));
    expect(signOut).toHaveBeenCalled();
  });
});
