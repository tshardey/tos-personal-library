import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { HouseholdProvider, useHousehold } from "@/contexts/HouseholdContext";
import SignIn from "@/components/auth/SignIn";
import HouseholdSetup from "@/components/household/HouseholdSetup";
import InviteCode from "@/components/household/InviteCode";

function SignedIn() {
  const { user, signOut } = useAuth();
  const { household, loading, error, refresh } = useHousehold();
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
          <span>{user?.email}</span>
          <button type="button" onClick={() => void signOut()} className="underline">
            Sign out
          </button>
        </div>
      </header>
      <div className="border-b p-4">
        <InviteCode />
      </div>
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
