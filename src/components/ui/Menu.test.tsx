import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Menu } from "./Menu";

function renderMenu(current?: boolean) {
  return render(
    <div>
      <button>Outside</button>
      <Menu label="Browse" button="Browse" current={current}>
        {(close) => (
          <a href="#x" onClick={close}>
            Series
          </a>
        )}
      </Menu>
    </div>,
  );
}

describe("Menu", () => {
  it("toggles aria-expanded and shows the panel", () => {
    renderMenu();
    const btn = screen.getByRole("button", { name: "Browse" });
    expect(btn).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("link", { name: "Series" })).toBeNull();
    fireEvent.click(btn);
    expect(btn).toHaveAttribute("aria-expanded", "true");
    const panel = screen.getByRole("link", { name: "Series" }).parentElement!;
    expect(btn.getAttribute("aria-controls")).toBe(panel.id);
  });

  it("Escape closes and focuses the button", () => {
    renderMenu();
    const btn = screen.getByRole("button", { name: "Browse" });
    fireEvent.click(btn);
    fireEvent.keyDown(screen.getByRole("link", { name: "Series" }), { key: "Escape" });
    expect(screen.queryByRole("link", { name: "Series" })).toBeNull();
    expect(btn).toHaveAttribute("aria-expanded", "false");
    expect(btn).toHaveFocus();
  });

  it("closes on an outside pointerdown", () => {
    renderMenu();
    fireEvent.click(screen.getByRole("button", { name: "Browse" }));
    fireEvent.pointerDown(screen.getByRole("link", { name: "Series" }));
    expect(screen.getByRole("link", { name: "Series" })).toBeInTheDocument();
    fireEvent.pointerDown(screen.getByRole("button", { name: "Outside" }));
    expect(screen.queryByRole("link", { name: "Series" })).toBeNull();
  });

  it("close() from a child link closes it", () => {
    renderMenu();
    fireEvent.click(screen.getByRole("button", { name: "Browse" }));
    fireEvent.click(screen.getByRole("link", { name: "Series" }));
    expect(screen.queryByRole("link", { name: "Series" })).toBeNull();
  });

  it("current sets aria-current=page", () => {
    renderMenu(true);
    expect(screen.getByRole("button", { name: "Browse" })).toHaveAttribute("aria-current", "page");
  });
});
