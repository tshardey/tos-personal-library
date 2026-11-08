import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { HouseholdProvider, useHousehold } from "@/contexts/HouseholdContext";
import SignIn from "@/components/auth/SignIn";
import HouseholdSetup from "@/components/household/HouseholdSetup";
import InviteCode from "@/components/household/InviteCode";
import LibraryPage from "@/components/library/LibraryPage";
import BookDetail from "@/components/book/BookDetail";
import AddBook from "@/components/book/AddBook";
import ImportPage from "@/components/import/ImportPage";
import { useRoute } from "@/lib/router";

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
    <div>
      <header className="flex items-center justify-between border-b p-4">
        <h1 className="text-xl font-semibold">Our Library</h1>
        <div className="flex items-center gap-3">
          <a href="#/import" className="underline">
            Import
          </a>
          <span>{user?.email}</span>
          <button type="button" onClick={() => void signOut()} className="underline">
            Sign out
          </button>
        </div>
      </header>
      <div className="border-b p-4">
        <InviteCode />
      </div>
      {route.name === "book" ? (
        <BookDetail key={route.id} id={route.id} />
      ) : route.name === "add" ? (
        <AddBook />
      ) : route.name === "import" ? (
        <ImportPage />
      ) : (
        <LibraryPage />
      )}
    </div>
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
