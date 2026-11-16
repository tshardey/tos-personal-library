import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { Tabs } from "./Tabs";

const TABS = [
  { id: "a", label: "Alpha" },
  { id: "b", label: "Beta" },
  { id: "c", label: "Gamma" },
] as const;
type Id = (typeof TABS)[number]["id"];

function setup(initial: Id = "a") {
  const onChange = vi.fn();
  function Host() {
    const [v, setV] = useState<Id>(initial);
    return (
      <Tabs
        label="Sections"
        tabs={TABS}
        value={v}
        onChange={(id) => {
          onChange(id);
          setV(id);
        }}
        panel={(id) => <p>Panel {id}</p>}
      />
    );
  }
  render(<Host />);
  return onChange;
}

describe("Tabs", () => {
  it("renders three tabs with the current one selected and roving tabIndex", () => {
    setup("b");
    expect(screen.getByRole("tablist", { name: "Sections" })).toBeInTheDocument();
    expect(screen.getAllByRole("tab")).toHaveLength(3);
    const beta = screen.getByRole("tab", { name: "Beta" });
    expect(beta).toHaveAttribute("aria-selected", "true");
    expect(beta).toHaveAttribute("tabindex", "0");
    const alpha = screen.getByRole("tab", { name: "Alpha" });
    expect(alpha).toHaveAttribute("aria-selected", "false");
    expect(alpha).toHaveAttribute("tabindex", "-1");
  });

  it("ArrowRight from the last wraps to the first and calls onChange", () => {
    const onChange = setup("c");
    fireEvent.keyDown(screen.getByRole("tab", { name: "Gamma" }), { key: "ArrowRight" });
    expect(onChange).toHaveBeenCalledWith("a");
    expect(screen.getByRole("tab", { name: "Alpha" })).toHaveFocus();
  });

  it("ArrowLeft from the first wraps to the last", () => {
    const onChange = setup("a");
    fireEvent.keyDown(screen.getByRole("tab", { name: "Alpha" }), { key: "ArrowLeft" });
    expect(onChange).toHaveBeenCalledWith("c");
  });

  it("End and Home jump", () => {
    const onChange = setup("a");
    fireEvent.keyDown(screen.getByRole("tab", { name: "Alpha" }), { key: "End" });
    expect(onChange).toHaveBeenLastCalledWith("c");
    expect(screen.getByRole("tab", { name: "Gamma" })).toHaveFocus();
    fireEvent.keyDown(screen.getByRole("tab", { name: "Gamma" }), { key: "Home" });
    expect(onChange).toHaveBeenLastCalledWith("a");
    expect(screen.getByRole("tab", { name: "Alpha" })).toHaveFocus();
  });

  it("renders only the current panel, labelled by its tab", () => {
    setup("b");
    const panel = screen.getByRole("tabpanel", { name: "Beta" });
    expect(panel).toHaveTextContent("Panel b");
    expect(panel).toHaveAttribute("tabindex", "0");
    expect(screen.getAllByRole("tabpanel")).toHaveLength(1);
    expect(screen.getByRole("tab", { name: "Beta" }).getAttribute("aria-controls")).toBe(panel.id);
  });

  it("scrolls sideways instead of squeezing the tabs on a narrow screen", () => {
    setup("a");
    expect(screen.getByRole("tablist")).toHaveClass("overflow-x-auto");
    for (const tab of screen.getAllByRole("tab")) {
      expect(tab).toHaveClass("shrink-0", "whitespace-nowrap", "sm:min-h-9");
    }
    // The selected tab keeps its accent underline.
    expect(screen.getByRole("tab", { name: "Alpha" })).toHaveClass("border-accent");
    expect(screen.getByRole("tab", { name: "Beta" })).toHaveClass("border-transparent");
  });
});
