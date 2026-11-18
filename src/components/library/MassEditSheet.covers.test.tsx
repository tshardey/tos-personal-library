import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { bookFixture, copyFixture } from "@/lib/flag-fixtures.test-util";
import type { BookWithCopies } from "@/lib/types";
import { finderState } from "@/components/covers/testkit";

const h = vi.hoisted(() => ({ state: {} as Record<string, unknown> }));
vi.mock("@/lib/library-repo", () => ({ updateCopyFields: vi.fn(), updateBook: vi.fn() }));
vi.mock("@/lib/tagging/tagging-repo", () => ({ addLibraryTag: vi.fn(), removeLibraryTag: vi.fn() }));
vi.mock("@/contexts/CoverFinderContext", () => ({ useCoverFinder: () => h.state }));
import MassEditSheet from "./MassEditSheet";

const markMany = vi.fn();
const findMany = vi.fn();

function catalog(titles = ["Atlas", "Codex"]): BookWithCopies[] {
  return titles.map((t) => bookFixture(t, [copyFixture({ id: t + "1", bookId: t })]));
}

function renderSheet(books = catalog()) {
  render(
    <MassEditSheet
      selected={books}
      catalog={books}
      labels={[]}
      members={[]}
      refresh={vi.fn().mockResolvedValue(true)}
      onClose={vi.fn()}
      onDone={vi.fn()}
    />,
  );
}

const sheet = () => screen.getByRole("dialog", { name: "Edit selected books" });

beforeEach(() => {
  vi.clearAllMocks();
  markMany.mockResolvedValue({ marked: 2, failed: 0 });
  findMany.mockResolvedValue({ queued: 2, alreadyOpen: 0, nothingFound: 0 });
  h.state = finderState({ markMany, findMany });
});

describe("MassEditSheet Covers", () => {
  it("is hidden when the cover finder isn't available", () => {
    h.state = finderState({ available: false });
    renderSheet();
    expect(within(sheet()).queryByRole("region", { name: "Covers" })).toBeNull();
  });

  it("marks every selected book from the sheet, without touching Save", async () => {
    renderSheet();
    const covers = within(sheet()).getByRole("region", { name: "Covers" });
    fireEvent.click(within(covers).getByRole("button", { name: "Add to batch" }));
    await waitFor(() => expect(markMany).toHaveBeenCalledWith(["Atlas", "Codex"], [], null));
    expect(await within(covers).findByRole("link", { name: "Covers tab" })).toHaveAttribute("href", "#/covers");
    expect(within(sheet()).getByRole("button", { name: "Save" })).toBeDisabled();
  });
});
