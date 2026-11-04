import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import SignIn from "@/components/auth/SignIn";

function Shell() {
  const { user, loading, signOut } = useAuth();
  if (loading) return <p className="p-6">Loading…</p>;
  if (!user) return <SignIn />;
  return (
    <div>
      <header className="flex items-center justify-between border-b p-4">
        <h1 className="text-xl font-semibold">Our Library</h1>
        <div className="flex items-center gap-3">
          <span>{user.email}</span>
          <button type="button" onClick={() => void signOut()} className="underline">
            Sign out
          </button>
        </div>
      </header>
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <Shell />
    </AuthProvider>
  );
}
