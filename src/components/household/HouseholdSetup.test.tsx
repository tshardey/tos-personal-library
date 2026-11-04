import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const repo = vi.hoisted(() => ({
  createHousehold: vi.fn(),
  joinHousehold: vi.fn(),
}));
const refresh = vi.hoisted(() => vi.fn());

vi.mock("@/lib/household-repo", () => repo);
vi.mock("@/contexts/HouseholdContext", () => ({
  useHousehold: () => ({ household: null, members: [], loading: false, refresh }),
}));

import HouseholdSetup from "./HouseholdSetup";

beforeEach(() => {
  repo.createHousehold.mockReset();
  repo.joinHousehold.mockReset();
  refresh.mockReset();
  refresh.mockResolvedValue(undefined);
});

describe("HouseholdSetup", () => {
  it("creates a household then refreshes", async () => {
    repo.createHousehold.mockResolvedValue("h1");
    render(<HouseholdSetup />);
    fireEvent.change(screen.getByLabelText("Household name"), { target: { value: "Home" } });
    fireEvent.change(screen.getByLabelText("Your name", { selector: "#create-display-name" }), {
      target: { value: "Tierra" },
    });
    fireEvent.click(screen.getByRole("button", { name: /create household/i }));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(repo.createHousehold).toHaveBeenCalledWith("Home", "Tierra");
  });

  it("joins with an invite code then refreshes", async () => {
    repo.joinHousehold.mockResolvedValue("h1");
    render(<HouseholdSetup />);
    fireEvent.change(screen.getByLabelText("Invite code"), { target: { value: "abc123" } });
    fireEvent.change(screen.getByLabelText("Your name", { selector: "#join-display-name" }), {
      target: { value: "Sam" },
    });
    fireEvent.click(screen.getByRole("button", { name: /join household/i }));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(repo.joinHousehold).toHaveBeenCalledWith("abc123", "Sam");
  });

  it("shows a friendly error for an invalid invite code and does not refresh", async () => {
    repo.joinHousehold.mockRejectedValue(new Error("invalid_invite_code"));
    render(<HouseholdSetup />);
    fireEvent.change(screen.getByLabelText("Invite code"), { target: { value: "nope" } });
    fireEvent.change(screen.getByLabelText("Your name", { selector: "#join-display-name" }), {
      target: { value: "Sam" },
    });
    fireEvent.click(screen.getByRole("button", { name: /join household/i }));
    expect(await screen.findByText("That invite code didn't match a household.")).toBeInTheDocument();
    expect(refresh).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /join household/i })).toBeEnabled();
  });
});
