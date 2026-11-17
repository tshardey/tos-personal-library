import type { ReactNode } from "react";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({
  user: null as { email: string } | null,
  household: null as { id: string; name: string; inviteCode: string; createdAt: string } | null,
  error: null as string | null,
}));
const refresh = vi.hoisted(() => vi.fn());
const signOut = vi.hoisted(() => vi.fn());

vi.mock("@/contexts/AuthContext", () => ({
  AuthProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
  useAuth: () => ({
    user: auth.user,
    loading: false,
    signInWithEmail: vi.fn(),
    signOut,
  }),
}));

vi.mock("@/contexts/HouseholdContext", () => ({
  HouseholdProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
  useHousehold: () => ({
    household: auth.household,
    members: [],
    loading: false,
    error: auth.error,
    refresh,
  }),
}));

vi.mock("@/hooks/useCatalog", () => ({
  useCatalog: () => ({ books: [], loading: false, error: null, reload: vi.fn() }),
}));

const coverRepo = vi.hoisted(() => ({
  listCoverMarks: vi.fn(async () => new Map()),
  listCoverSearches: vi.fn(async () => []),
  getCoverBudget: vi.fn(async () => null),
  screenSearch: vi.fn(),
}));

vi.mock("@/lib/covers/cover-repo", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/covers/cover-repo")>()),
  ...coverRepo,
}));

// The flush in renderApp lets InboxPage's first-load purge run; keep it off the network.
vi.mock("@/lib/photo/intake-repo", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/photo/intake-repo")>()),
  purgeIntakePhotos: vi.fn(async () => 0),
}));

const taggingRepo = vi.hoisted(() => ({
  listVocabulary: vi.fn(async () => []),
  listLibraryTagsByBook: vi.fn(async () => new Map()),
  listCardMeta: vi.fn(async () => new Map()),
  listTagJobs: vi.fn(async () => []),
  listSuggestions: vi.fn(async () => []),
  getAiBudget: vi.fn(async () => null),
  runTagJob: vi.fn(),
}));

vi.mock("@/lib/tagging/tagging-repo", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tagging/tagging-repo")>()),
  ...taggingRepo,
}));

const readingRepo = vi.hoisted(() => ({
  listReadStatuses: vi.fn(async () => []),
  setReadStatus: vi.fn(async () => []),
}));

vi.mock("@/lib/reading/reading-repo", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/reading/reading-repo")>()),
  ...readingRepo,
}));

import App from "./App";

beforeEach(() => {
  auth.household = null;
  auth.error = null;
  refresh.mockReset();
  signOut.mockReset();
  window.location.hash = "";
});

/** Renders and lets the providers' async loads settle inside act. */
async function renderApp() {
  render(<App />);
  await act(async () => {});
}

function signedIn() {
  auth.user = { email: "a@b.co" };
  auth.household = { id: "h1", name: "Home", inviteCode: "abc123", createdAt: "" };
}

describe("App", () => {
  it("shows sign-in when signed out", async () => {
    auth.user = null;
    await renderApp();
    expect(screen.getByRole("button", { name: /sign in/i })).toBeInTheDocument();
  });

  it("does not mount the cover finder when signed out", async () => {
    auth.user = null;
    for (const fn of Object.values(coverRepo)) fn.mockClear();
    await renderApp();
    expect(coverRepo.listCoverMarks).not.toHaveBeenCalled();
    expect(coverRepo.listCoverSearches).not.toHaveBeenCalled();
    expect(coverRepo.getCoverBudget).not.toHaveBeenCalled();
  });

  it("does not mount the tagging provider when signed out", async () => {
    auth.user = null;
    for (const fn of Object.values(taggingRepo)) fn.mockClear();
    await renderApp();
    expect(taggingRepo.listVocabulary).not.toHaveBeenCalled();
    expect(taggingRepo.listTagJobs).not.toHaveBeenCalled();
    expect(taggingRepo.runTagJob).not.toHaveBeenCalled();
  });

  it("does not mount the reading provider when signed out", async () => {
    auth.user = null;
    readingRepo.listReadStatuses.mockClear();
    await renderApp();
    expect(readingRepo.listReadStatuses).not.toHaveBeenCalled();
  });

  it("renders the Reading history page on #/reading, and More links to it", async () => {
    signedIn();
    window.location.hash = "#/reading";
    await renderApp();
    expect(screen.getByRole("heading", { name: "Reading history" })).toBeInTheDocument();
    expect(readingRepo.listReadStatuses).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "More" }));
    expect(screen.getByRole("link", { name: "Reading history" })).toHaveAttribute("href", "#/reading");
  });

  it("renders the tag suggestions page on #/tags, and More links to it", async () => {
    signedIn();
    window.location.hash = "#/tags";
    await renderApp();
    expect(screen.getByRole("heading", { name: "Tag suggestions" })).toBeInTheDocument();
    expect(taggingRepo.listTagJobs).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "More" }));
    expect(screen.getByRole("link", { name: "Tag suggestions" })).toHaveAttribute("href", "#/tags");
  });

  it("before the push: no Tag suggestions link, and #/tags says tagging is not available yet", async () => {
    signedIn();
    window.location.hash = "#/tags";
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    taggingRepo.listTagJobs.mockRejectedValueOnce({ code: "PGRST205" } as never);
    await renderApp();
    expect(screen.getByText("Tagging isn't available yet.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "More" }));
    expect(screen.queryByRole("link", { name: "Tag suggestions" })).not.toBeInTheDocument();
    expect(taggingRepo.runTagJob).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it("renders the covers review page on #/covers", async () => {
    signedIn();
    window.location.hash = "#/covers";
    await renderApp();
    expect(screen.getByRole("heading", { name: "Covers to review" })).toBeInTheDocument();
    expect(coverRepo.listCoverSearches).toHaveBeenCalled();
  });

  it("shows the shell with email and sign out when signed in", async () => {
    auth.user = { email: "a@b.co" };
    auth.household = { id: "h1", name: "Home", inviteCode: "abc123", createdAt: "" };
    await renderApp();
    expect(screen.getByRole("heading", { name: "Our Library" })).toBeInTheDocument();
    expect(screen.queryByText("a@b.co")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "More" }));
    expect(screen.getByText("a@b.co")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /sign out/i })).toBeInTheDocument();
    expect(screen.getByText("abc123")).toBeInTheDocument();
  });

  describe("navigation", () => {
    // Elements, not only links: on the phone Add and More are buttons that carry aria-current too.
    const current = () => Array.from(document.querySelectorAll('[aria-current="page"]'));

    it.each([
      ["#/", "Library"],
      ["#/scan", "Scan"],
      ["#/inbox", "Add"],
      ["#/import", "Add"],
      ["#/add", "Add"],
      ["#/book/b1", "Library"],
      ["#/covers", "Covers"],
      ["#/tags", "More"],
    ])("marks the tab for %s as current", async (hash, name) => {
      signedIn();
      window.location.hash = hash;
      await renderApp();
      expect(current().map((a) => a.textContent)).toEqual([name]);
    });

    it("follows the route when the hash changes", async () => {
      signedIn();
      await renderApp();
      expect(current().map((a) => a.textContent)).toEqual(["Library"]);
      await act(async () => {
        window.location.hash = "#/import";
        window.dispatchEvent(new HashChangeEvent("hashchange"));
      });
      expect(current().map((a) => a.textContent)).toEqual(["Add"]);
    });

    it("links the title to the library, and the invite code is in More", async () => {
      signedIn();
      window.location.hash = "#/";
      await renderApp();
      expect(screen.getByRole("link", { name: "Our Library" })).toHaveAttribute("href", "#/");
      expect(screen.getByRole("main")).not.toHaveTextContent("abc123");
      expect(screen.queryByText("abc123")).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "More" }));
      expect(within(screen.getByRole("dialog", { name: "More" })).getByText("abc123")).toBeInTheDocument();
    });
  });

  describe("More", () => {
    it("opens, closes on Escape with focus back on the button, and signs out", async () => {
      signedIn();
      await renderApp();
      const button = screen.getByRole("button", { name: "More" });
      button.focus(); // a click focuses the button in the browser; fireEvent.click does not
      fireEvent.click(button);
      const dialog = screen.getByRole("dialog", { name: "More" });
      expect(within(dialog).getByRole("button", { name: /sign out/i })).toBeInTheDocument();
      fireEvent.keyDown(dialog, { key: "Escape" });
      expect(screen.queryByRole("dialog", { name: "More" })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /sign out/i })).not.toBeInTheDocument();
      expect(button).toHaveFocus();

      // A tap outside the sheet (on its scrim) closes it too.
      fireEvent.click(button);
      fireEvent.click(screen.getByTestId("sheet-scrim"));
      expect(screen.queryByRole("dialog", { name: "More" })).not.toBeInTheDocument();

      fireEvent.click(button);
      fireEvent.click(screen.getByRole("button", { name: /sign out/i }));
      expect(signOut).toHaveBeenCalledTimes(1);
    });
  });

  it("shows household setup when signed in without a household", async () => {
    auth.user = { email: "a@b.co" };
    await renderApp();
    expect(screen.getByRole("button", { name: /create household/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /join household/i })).toBeInTheDocument();
  });

  it("shows a retry state instead of setup when the household lookup failed", async () => {
    auth.user = { email: "a@b.co" };
    auth.error = "Couldn't load your household.";
    await renderApp();
    expect(screen.queryByRole("button", { name: /create household/i })).not.toBeInTheDocument();
    expect(screen.getByText("Couldn't load your household.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /retry/i }));
    expect(refresh).toHaveBeenCalled();
  });
});
