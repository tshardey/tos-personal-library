import { describe, expect, it, vi } from "vitest";

const rpc = vi.hoisted(() => vi.fn());
vi.mock("@/lib/supabase", () => ({ supabase: { rpc } }));

import { joinHousehold } from "./household-repo";

describe("joinHousehold", () => {
  it("maps an RPC error containing invalid_invite_code to Error('invalid_invite_code')", async () => {
    rpc.mockResolvedValue({
      data: null,
      error: { message: "P0001: invalid_invite_code (while joining)" },
    });
    await expect(joinHousehold("nope", "Sam")).rejects.toThrow(new Error("invalid_invite_code"));
  });

  it("rethrows other errors", async () => {
    const error = { message: "boom" };
    rpc.mockResolvedValue({ data: null, error });
    await expect(joinHousehold("x", "Sam")).rejects.toBe(error);
  });
});
