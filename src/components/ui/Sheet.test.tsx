import { fireEvent, render, screen } from "@testing-library/react";
import { createRef, useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { Sheet } from "./Sheet";

describe("Sheet", () => {
  it("portals a labelled modal dialog into document.body", () => {
    const { container } = render(
      <Sheet label="Filters" title="Filters" onClose={() => {}}>
        <button>One</button>
      </Sheet>,
    );
    const dialog = screen.getByRole("dialog", { name: "Filters" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(document.body.contains(dialog)).toBe(true);
    expect(container.contains(dialog)).toBe(false);
    expect(screen.getByRole("heading", { level: 2, name: "Filters" })).toBeInTheDocument();
  });

  it("focuses the first focusable by default", () => {
    render(
      <Sheet label="S" onClose={() => {}}>
        <button>One</button>
        <button>Two</button>
      </Sheet>,
    );
    expect(screen.getByRole("button", { name: "One" })).toHaveFocus();
  });

  it("focuses initialFocus when given", () => {
    const ref = createRef<HTMLButtonElement>();
    render(
      <Sheet label="S" onClose={() => {}} initialFocus={ref}>
        <button>One</button>
        <button ref={ref}>Two</button>
      </Sheet>,
    );
    expect(screen.getByRole("button", { name: "Two" })).toHaveFocus();
  });

  it("wraps Tab and Shift+Tab inside the dialog", () => {
    render(
      <Sheet label="S" onClose={() => {}} footer={<button>Last</button>}>
        <button>First</button>
      </Sheet>,
    );
    const dialog = screen.getByRole("dialog");
    const first = screen.getByRole("button", { name: "First" });
    const last = screen.getByRole("button", { name: "Last" });
    last.focus();
    fireEvent.keyDown(dialog, { key: "Tab" });
    expect(first).toHaveFocus();
    fireEvent.keyDown(dialog, { key: "Tab", shiftKey: true });
    expect(last).toHaveFocus();
  });

  it("Escape closes and focus returns to the opener on unmount", () => {
    const onClose = vi.fn();
    function Host() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button onClick={() => setOpen(true)}>Open</button>
          {open && (
            <Sheet
              label="S"
              onClose={() => {
                onClose();
                setOpen(false);
              }}
            >
              <button>Inside</button>
            </Sheet>
          )}
        </>
      );
    }
    render(<Host />);
    const opener = screen.getByRole("button", { name: "Open" });
    opener.focus();
    fireEvent.click(opener);
    expect(screen.getByRole("button", { name: "Inside" })).toHaveFocus();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(opener).toHaveFocus();
  });

  it("closes on a scrim click but not a click inside", () => {
    const onClose = vi.fn();
    render(
      <Sheet label="S" onClose={onClose}>
        <button>Inside</button>
      </Sheet>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Inside" }));
    fireEvent.click(screen.getByRole("dialog"));
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId("sheet-scrim"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("Escape in a nested sheet closes only the inner one", () => {
    const outer = vi.fn();
    const inner = vi.fn();
    render(
      <Sheet label="Outer" onClose={outer}>
        <button>Outer button</button>
        <Sheet label="Inner" onClose={inner}>
          <button>Inner button</button>
        </Sheet>
      </Sheet>,
    );
    fireEvent.keyDown(screen.getByRole("dialog", { name: "Inner" }), { key: "Escape" });
    expect(inner).toHaveBeenCalledTimes(1);
    expect(outer).not.toHaveBeenCalled();
    // control: Escape on the outer dialog still reaches the outer onClose
    fireEvent.keyDown(screen.getByRole("dialog", { name: "Outer" }), { key: "Escape" });
    expect(outer).toHaveBeenCalledTimes(1);
  });
});
