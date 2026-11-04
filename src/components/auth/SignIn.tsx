import { useState, type FormEvent } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { isSupabaseConfigured } from "@/lib/supabase-config";

export default function SignIn() {
  const { signInWithEmail } = useAuth();
  const configured = isSupabaseConfigured();
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [error, setError] = useState("");

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setStatus("sending");
    setError("");
    try {
      await signInWithEmail(email.trim());
      setStatus("sent");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign-in failed.");
      setStatus("error");
    }
  }

  return (
    <main className="mx-auto max-w-sm p-6">
      <h1 className="mb-4 text-2xl font-semibold">Our Library</h1>
      {!configured && (
        <p role="alert" className="mb-4 text-red-700">
          Supabase isn't configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY.
        </p>
      )}
      <form onSubmit={onSubmit} className="flex flex-col gap-3">
        <label className="flex flex-col gap-1">
          Email
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="rounded border px-2 py-1"
          />
        </label>
        <button
          type="submit"
          disabled={!configured || status === "sending"}
          className="rounded bg-stone-800 px-3 py-2 text-white disabled:opacity-50"
        >
          Sign in
        </button>
      </form>
      {status === "sent" && <p className="mt-3">Check your email for a sign-in link.</p>}
      {status === "error" && (
        <p role="alert" className="mt-3 text-red-700">
          {error}
        </p>
      )}
    </main>
  );
}
