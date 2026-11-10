import { lazy, Suspense } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import ChunkErrorBoundary from "./ChunkErrorBoundary";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("ChunkErrorBoundary", () => {
  it("shows a message and Reload when a lazy import fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const Broken = lazy(() => Promise.reject(new TypeError("Failed to fetch dynamically imported module")));
    const onReload = vi.fn();
    render(
      <ChunkErrorBoundary onReload={onReload}>
        <Suspense fallback={<p>Loading…</p>}>
          <Broken />
        </Suspense>
      </ChunkErrorBoundary>,
    );
    expect(await screen.findByRole("alert")).toHaveTextContent("This page couldn't load.");
    fireEvent.click(screen.getByRole("button", { name: "Reload" }));
    expect(onReload).toHaveBeenCalledTimes(1);
  });

  it("renders its children when nothing fails", () => {
    render(
      <ChunkErrorBoundary>
        <p>Fine</p>
      </ChunkErrorBoundary>,
    );
    expect(screen.getByText("Fine")).toBeInTheDocument();
  });
});
