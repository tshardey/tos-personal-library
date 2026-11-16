import { useEffect, useRef, useState, type FormEvent } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { loadLastEmail } from "@/lib/last-email";
import { signInErrorMessage } from "@/lib/sign-in-error";
import { isSupabaseConfigured } from "@/lib/supabase-config";

/** After a link is sent, Sign in waits this long, since each email spends the hourly allowance. */
const RESEND_COOLDOWN_MS = 60_000;

export default function SignIn() {
  const { signInWithEmail } = useAuth();
  const configured = isSupabaseConfigured();
  const [email, setEmail] = useState(loadLastEmail);
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [error, setError] = useState("");
  const [sentTo, setSentTo] = useState("");
  const [coolingDown, setCoolingDown] = useState(false);
  const cooldownTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (cooldownTimer.current !== null) clearTimeout(cooldownTimer.current);
    },
    [],
  );

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const address = email.trim();
    setStatus("sending");
    setError("");
    try {
      await signInWithEmail(address);
      setSentTo(address);
      setStatus("sent");
      setCoolingDown(true);
      if (cooldownTimer.current !== null) clearTimeout(cooldownTimer.current);
      cooldownTimer.current = setTimeout(() => {
        cooldownTimer.current = null;
        setCoolingDown(false);
      }, RESEND_COOLDOWN_MS);
    } catch (err) {
      setError(signInErrorMessage(err));
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
          disabled={!configured || status === "sending" || coolingDown}
          className="rounded bg-stone-800 px-3 py-2 text-white disabled:opacity-50"
        >
          Sign in
        </button>
      </form>
      {status === "sent" && (
        <p className="mt-3">
          Sent a link to {sentTo}. Check that inbox, and don't request another — each one uses up the hourly
          email allowance.
        </p>
      )}
      {status === "error" && (
        <p role="alert" className="mt-3 text-red-700">
          {error}
        </p>
      )}
    </main>
  );
}
