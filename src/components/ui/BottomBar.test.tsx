import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { BottomBar } from "./BottomBar";

describe("BottomBar", () => {
  it("sits above the tab bar and pads for the safe area", () => {
    const { container } = render(<BottomBar>content</BottomBar>);
    const cls = (container.firstChild as HTMLElement).className;
    expect(cls).toContain("bottom-[var(--nav-bottom)]");
    expect(cls).toContain("safe-area-inset-bottom");
    expect(cls).toContain("z-20");
  });

  it("is a named region when given a label", () => {
    render(<BottomBar label="Selection">3 selected</BottomBar>);
    expect(screen.getByRole("region", { name: "Selection" })).toHaveTextContent("3 selected");
  });

  it("is not a region without a label", () => {
    render(<BottomBar>content</BottomBar>);
    expect(screen.queryByRole("region")).toBeNull();
  });
});
