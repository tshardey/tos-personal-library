import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const getMyHousehold = vi.hoisted(() => vi.fn());
const auth = vi.hoisted(() => ({ user: { id: "u1", email: "reader@example.com" } as { id: string; email?: string } }));

vi.mock("@/lib/household-repo", () => ({ getMyHousehold }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: auth.user }) }));

import { HouseholdProvider, useHousehold } from "./HouseholdContext";

function Probe() {
  const { household, loading } = useHousehold();
  return <p>{loading ? "loading" : (household?.name ?? "none")}</p>;
}

const HOUSEHOLD = { id: "h1", name: "Maple House", inviteCode: "abc", createdAt: "2026-01-01T00:00:00Z" };

describe("HouseholdProvider", () => {
  beforeEach(() => {
    localStorage.clear();
    getMyHousehold.mockReset();
    auth.user = { id: "u1", email: "reader@example.com" };
  });

  it("remembers the email once it opens a household", async () => {
    getMyHousehold.mockResolvedValue({ household: HOUSEHOLD, members: [] });
    render(
      <HouseholdProvider>
        <Probe />
      </HouseholdProvider>,
    );
    expect(await screen.findByText("Maple House")).toBeInTheDocument();
    expect(localStorage.getItem("tpl_last_email")).toBe("reader@example.com");
  });

  it("doesn't remember an email that has no household", async () => {
    localStorage.setItem("tpl_last_email", "reader@example.com");
    auth.user = { id: "u2", email: "other@example.com" };
    getMyHousehold.mockResolvedValue(null);
    render(
      <HouseholdProvider>
        <Probe />
      </HouseholdProvider>,
    );
    expect(await screen.findByText("none")).toBeInTheDocument();
    expect(localStorage.getItem("tpl_last_email")).toBe("reader@example.com");
  });

  it("still loads the household when storage is blocked", async () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("blocked", "SecurityError");
    });
    getMyHousehold.mockResolvedValue({ household: HOUSEHOLD, members: [] });
    render(
      <HouseholdProvider>
        <Probe />
      </HouseholdProvider>,
    );
    expect(await screen.findByText("Maple House")).toBeInTheDocument();
    vi.restoreAllMocks();
  });
});
