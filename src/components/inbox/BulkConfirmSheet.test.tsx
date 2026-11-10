import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import BulkConfirmSheet, { type BulkEntry } from "./BulkConfirmSheet";

const entry = (id: string, title: string): BulkEntry => ({ id, title, authors: ["Ana Vale"], editionNote: "" });

afterEach(cleanup);

describe("BulkConfirmSheet", () => {
  it("says book for one checked entry and books otherwise", () => {
    const onConfirm = vi.fn();
    render(
      <BulkConfirmSheet
        entries={[entry("i1", "Salt Road"), entry("i2", "Glass Orchard")]}
        labels={[]}
        busy={false}
        onConfirm={onConfirm}
        onSetEdition={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: "Add 2 books" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("checkbox", { name: "Glass Orchard" }));
    fireEvent.click(screen.getByRole("button", { name: "Add 1 book" }));
    expect(onConfirm).toHaveBeenCalledWith(["i1"]);
    fireEvent.click(screen.getByRole("checkbox", { name: "Salt Road" }));
    expect(screen.getByRole("button", { name: "Add 0 books" })).toBeDisabled();
  });
});
