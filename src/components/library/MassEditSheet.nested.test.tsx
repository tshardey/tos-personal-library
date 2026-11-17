import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { bookFixture, copyFixture } from "@/lib/flag-fixtures.test-util";
import MassEditSheet from "./MassEditSheet";

describe("MassEditSheet with the edition picker open", () => {
  it("closes only the picker on one Escape, and returns focus to its button", () => {
    const books = [bookFixture("Atlas", [copyFixture({ id: "a1", bookId: "Atlas" })])];
    const onClose = vi.fn();
    render(
      <MassEditSheet
        selected={books}
        catalog={books}
        labels={["Harbor Press"]}
        members={[]}
        refresh={vi.fn().mockResolvedValue(true)}
        onClose={onClose}
        onDone={vi.fn()}
      />,
    );
    const trigger = screen.getByRole("button", { name: "Edition label: no change" });
    trigger.focus();
    fireEvent.click(trigger);
    const picker = screen.getByRole("dialog", { name: "Edition label" });
    fireEvent.keyDown(screen.getByLabelText("Filter editions"), { key: "Escape" });
    expect(picker).not.toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "Edit selected books" })).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    expect(trigger).toHaveFocus();
  });

  it("stays open when the scrim is tapped", () => {
    const books = [bookFixture("Atlas", [copyFixture({ id: "a1", bookId: "Atlas" })])];
    const onClose = vi.fn();
    render(
      <MassEditSheet
        selected={books}
        catalog={books}
        labels={[]}
        members={[]}
        refresh={vi.fn().mockResolvedValue(true)}
        onClose={onClose}
        onDone={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByTestId("sheet-scrim"));
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog", { name: "Edit selected books" })).toBeInTheDocument();
  });
});
