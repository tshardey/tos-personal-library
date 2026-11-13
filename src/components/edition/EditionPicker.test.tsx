import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import EditionPicker from "./EditionPicker";

const labels = ["Invented Box", "Other Box"];

function setup(value: string | null = null) {
  const onChange = vi.fn();
  render(<EditionPicker value={value} labels={labels} onChange={onChange} />);
  return onChange;
}
function open() {
  fireEvent.click(screen.getByRole("button", { name: /^Edition:/ }));
}

describe("EditionPicker", () => {
  it("shows Edition: none", () => {
    setup();
    expect(screen.getByRole("button", { name: "Edition: none" })).toBeInTheDocument();
  });
  it("shows the chosen label", () => {
    setup("Other Box");
    expect(screen.getByRole("button", { name: "Edition: Other Box" })).toBeInTheDocument();
  });
  it("filters labels as you type", () => {
    setup();
    open();
    fireEvent.change(screen.getByLabelText("Filter editions"), { target: { value: "inv" } });
    expect(screen.getByRole("button", { name: "Invented Box" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Other Box" })).not.toBeInTheDocument();
  });
  it("adds a new label", () => {
    const onChange = setup();
    open();
    fireEvent.change(screen.getByLabelText("Filter editions"), { target: { value: "Fresh Box" } });
    fireEvent.click(screen.getByRole("button", { name: 'Add "Fresh Box"' }));
    expect(onChange).toHaveBeenCalledWith("Fresh Box");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
  it("offers no Add for an existing label in another case", () => {
    setup();
    open();
    fireEvent.change(screen.getByLabelText("Filter editions"), { target: { value: "invented box" } });
    expect(screen.queryByRole("button", { name: /^Add "/ })).not.toBeInTheDocument();
  });
  it("Enter on a label differing only by case and spaces stores the existing spelling", () => {
    const onChange = setup();
    open();
    fireEvent.change(screen.getByLabelText("Filter editions"), { target: { value: "  oTHER box " } });
    expect(screen.getByRole("button", { name: "Other Box" })).toBeInTheDocument();
    fireEvent.keyDown(screen.getByLabelText("Filter editions"), { key: "Enter" });
    expect(onChange).toHaveBeenCalledWith("Other Box");
  });
  it("None clears the edition", () => {
    const onChange = setup("Other Box");
    open();
    fireEvent.click(screen.getByRole("button", { name: "None" }));
    expect(onChange).toHaveBeenCalledWith(null);
  });
  it("caps the filter at 120 characters", () => {
    setup();
    open();
    const field = screen.getByLabelText("Filter editions");
    expect(field).toHaveAttribute("maxlength", "120");
    fireEvent.change(field, { target: { value: "z".repeat(121) } });
    expect(screen.getByText("Labels are at most 120 characters.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Add "/ })).not.toBeInTheDocument();
  });
  it("closes on Escape and uses buttons for options", () => {
    setup();
    open();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Invented Box" })).toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
  it("Enter in the filter picks instead of submitting the surrounding form", () => {
    const onSubmit = vi.fn((e: React.FormEvent) => e.preventDefault());
    const onChange = vi.fn();
    render(
      <form onSubmit={onSubmit}>
        <EditionPicker value={null} labels={labels} onChange={onChange} />
      </form>,
    );
    open();
    const field = screen.getByLabelText("Filter editions");
    fireEvent.change(field, { target: { value: "Fresh Box" } });
    fireEvent.keyDown(field, { key: "Enter" });
    expect(onChange).toHaveBeenLastCalledWith("Fresh Box");
    open();
    fireEvent.change(screen.getByLabelText("Filter editions"), { target: { value: "other" } });
    fireEvent.keyDown(screen.getByLabelText("Filter editions"), { key: "Enter" });
    expect(onChange).toHaveBeenLastCalledWith("Other Box");
    open();
    fireEvent.change(screen.getByLabelText("Filter editions"), { target: { value: "  " } });
    fireEvent.keyDown(screen.getByLabelText("Filter editions"), { key: "Enter" });
    expect(onChange).toHaveBeenCalledTimes(2);
    expect(onSubmit).not.toHaveBeenCalled();
  });
  it("returns focus to the trigger after Escape and after a pick", () => {
    setup();
    open();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(screen.getByRole("button", { name: /^Edition:/ })).toHaveFocus();
    open();
    fireEvent.click(screen.getByRole("button", { name: "Other Box" }));
    expect(screen.getByRole("button", { name: /^Edition:/ })).toHaveFocus();
  });
});
