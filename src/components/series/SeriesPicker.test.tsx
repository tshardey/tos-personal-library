import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import SeriesPicker from "./SeriesPicker";

function setup(value: string | null = null, volume: number | null = null) {
  const onChange = vi.fn();
  render(<SeriesPicker value={value} volume={volume} names={["Saga"]} onChange={onChange} />);
  fireEvent.click(screen.getByRole("button", { name: /^Series:/ }));
  return onChange;
}

describe("SeriesPicker", () => {
  it("shows none, or the name with its volume", () => {
    const { unmount } = render(<SeriesPicker value={null} volume={null} names={[]} onChange={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Series: none" })).toBeInTheDocument();
    unmount();
    render(<SeriesPicker value="Saga" volume={2.5} names={[]} onChange={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Series: Saga · Vol. 2.5" })).toBeInTheDocument();
  });

  it("picks the existing name for typed text in another case, with no duplicate Add", () => {
    const onChange = setup();
    fireEvent.change(screen.getByLabelText("Filter series"), { target: { value: "saga" } });
    expect(screen.queryByRole("button", { name: /^Add/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Saga" }));
    expect(onChange).toHaveBeenCalledWith("Saga", null);
  });

  it("adds a new series", () => {
    const onChange = setup();
    fireEvent.change(screen.getByLabelText("Filter series"), { target: { value: "New Saga" } });
    fireEvent.click(screen.getByRole("button", { name: 'Add "New Saga"' }));
    expect(onChange).toHaveBeenCalledWith("New Saga", null);
  });

  it("passes the volume along", () => {
    const onChange = setup();
    fireEvent.change(screen.getByLabelText("Volume"), { target: { value: "2.5" } });
    fireEvent.click(screen.getByRole("button", { name: "Saga" }));
    expect(onChange).toHaveBeenCalledWith("Saga", 2.5);
  });

  it("saves a changed volume once when the sheet is closed", () => {
    const onChange = setup("Saga", 1);
    fireEvent.change(screen.getByLabelText("Volume"), { target: { value: "2.5" } });
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith("Saga", 2.5);
  });

  it("clears with None", () => {
    const onChange = setup("Saga", 1);
    fireEvent.click(screen.getByRole("button", { name: "None" }));
    expect(onChange).toHaveBeenCalledWith(null, null);
  });
});

describe("SeriesPicker volume edits", () => {
  it("saves once when the volume is edited and a name is then picked", () => {
    const onChange = setup("Saga", 1);
    const input = screen.getByLabelText("Volume");
    fireEvent.change(input, { target: { value: "3" } });
    fireEvent.blur(input, { relatedTarget: null });
    fireEvent.click(screen.getByRole("button", { name: "None" }));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(null, null);
  });

  it("saves the edited volume on Escape", () => {
    const onChange = setup("Saga", 1);
    const input = screen.getByLabelText("Volume");
    fireEvent.change(input, { target: { value: "4" } });
    fireEvent.keyDown(input, { key: "Escape" });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith("Saga", 4);
  });

  it("keeps the saved volume when the typed one is out of range", () => {
    const onChange = setup("Saga", 1);
    const input = screen.getByLabelText("Volume");
    fireEvent.change(input, { target: { value: "10000" } });
    expect(screen.getByRole("alert")).toHaveTextContent("Volume must be between 0 and 9999.5.");
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onChange).not.toHaveBeenCalled();
  });
});
