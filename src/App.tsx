import { lazy, Suspense } from "react";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { HouseholdProvider, useHousehold } from "@/contexts/HouseholdContext";
import { CoverFinderProvider } from "@/contexts/CoverFinderContext";
import SignIn from "@/components/auth/SignIn";
import HouseholdSetup from "@/components/household/HouseholdSetup";
import InviteCode from "@/components/household/InviteCode";
import LibraryPage from "@/components/library/LibraryPage";
import BookDetail from "@/components/book/BookDetail";
import AddBook from "@/components/book/AddBook";
import ImportPage from "@/components/import/ImportPage";
import InboxPage from "@/components/inbox/InboxPage";
import ChunkErrorBoundary from "@/components/common/ChunkErrorBoundary";
import EditionLabelsPage from "@/components/edition/EditionLabelsPage";
import CoverReviewPage from "@/components/covers/CoverReviewPage";
import CoverStopBanner from "@/components/covers/CoverStopBanner";
import CoversBadge from "@/components/covers/CoversBadge";
import AccountMenu from "@/components/nav/AccountMenu";
import TabBar from "@/components/nav/TabBar";
import { useRoute } from "@/lib/router";

// Its own chunk: the scanner, and through it the barcode decoder, load only on #/scan (D1).
const ScanPage = lazy(() => import("@/components/scan/ScanPage"));

function SignedIn() {
  const { user, signOut } = useAuth();
  const { household, loading, error, refresh } = useHousehold();
  const route = useRoute();
  if (loading) return <p className="p-6">Loading…</p>;
  if (!household && error) {
    return (
      <div className="p-6">
        <p role="alert" className="mb-3 text-red-700">
          {error}
        </p>
        <button
          type="button"
          onClick={() => void refresh()}
          className="rounded bg-stone-800 px-3 py-2 text-white"
        >
          Retry
        </button>
      </div>
    );
  }
  if (!household) return <HouseholdSetup />;
  return (
    <CoverFinderProvider>
      <div>
        <header className="flex items-center justify-between gap-2 px-3 py-2 sm:px-4">
          <h1 className="text-lg font-semibold sm:text-xl">
            <a href="#/">Our Library</a>
          </h1>
          <div className="flex items-center gap-2">
            <CoversBadge />
            <AccountMenu email={user?.email} onSignOut={() => void signOut()} />
          </div>
        </header>
        <TabBar route={route} />
        <CoverStopBanner />
        {route.name === "library" && (
          <div className="border-b p-3 sm:p-4">
            <InviteCode />
          </div>
        )}
        {route.name === "book" ? (
          <BookDetail key={route.id} id={route.id} />
        ) : route.name === "add" ? (
          <AddBook />
        ) : route.name === "import" ? (
          <ImportPage />
        ) : route.name === "inbox" ? (
          <InboxPage />
        ) : route.name === "covers" ? (
          <CoverReviewPage />
        ) : route.name === "editions" ? (
          <EditionLabelsPage />
        ) : route.name === "scan" ? (
          <ChunkErrorBoundary>
            <Suspense fallback={<p className="p-6">Loading…</p>}>
              <ScanPage />
            </Suspense>
          </ChunkErrorBoundary>
        ) : (
          <LibraryPage series={route.name === "library" ? route.series : undefined} />
        )}
      </div>
    </CoverFinderProvider>
  );
}

function Shell() {
  const { user, loading } = useAuth();
  if (loading) return <p className="p-6">Loading…</p>;
  if (!user) return <SignIn />;
  return (
    <HouseholdProvider>
      <SignedIn />
    </HouseholdProvider>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <Shell />
    </AuthProvider>
  );
}
