import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Badge, Button, Chip, IconButton, Select, SearchIcon } from ".";

describe("shared parts", () => {
  it("Button defaults to type=button and passes disabled", () => {
    render(<Button variant="primary" disabled>Save</Button>);
    const b = screen.getByRole("button", { name: "Save" });
    expect(b).toHaveAttribute("type", "button");
    expect(b).toBeDisabled();
  });

  it("IconButton is named by label and hides its icon", () => {
    render(<IconButton label="Smaller covers"><SearchIcon /></IconButton>);
    const b = screen.getByRole("button", { name: "Smaller covers" });
    expect(b.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
  });

  it("Chip with onRemove shows a remove button", () => {
    const onRemove = vi.fn();
    render(<Chip label="Deluxe" onRemove={onRemove} />);
    expect(screen.getByText("Deluxe")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Remove filter: Deluxe" }));
    expect(onRemove).toHaveBeenCalled();
  });

  it("Chip with pressed is an aria-pressed toggle", () => {
    render(<Chip label="Owned" pressed onClick={() => {}} />);
    expect(screen.getByRole("button", { name: "Owned" })).toHaveAttribute("aria-pressed", "true");
  });

  it("Badge renders its children", () => {
    render(<Badge tone="success">Read</Badge>);
    expect(screen.getByText("Read")).toBeInTheDocument();
  });

  it("Select is labelled", () => {
    render(<Select label="Sort"><option>A</option></Select>);
    expect(screen.getByLabelText("Sort")).toBeInTheDocument();
  });
});
