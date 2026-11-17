import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui";
import { useAuth } from "@/contexts/AuthContext";
import { useHousehold } from "@/contexts/HouseholdContext";
import { createHousehold, joinHousehold } from "@/lib/household-repo";

const INPUT = "min-h-11 sm:min-h-9 rounded-md border border-field bg-control px-3 text-sm text-fg";

function joinMessage(err: unknown): string {
  if (err instanceof Error && err.message === "invalid_invite_code") {
    return "That invite code didn't match a household.";
  }
  console.error("Failed to join household", err);
  return "Couldn't join the household. Try again.";
}

export default function HouseholdSetup() {
  const { refresh } = useHousehold();
  const { user, signOut } = useAuth();
  const email = user?.email;
  const [name, setName] = useState("");
  const [createName, setCreateName] = useState("");
  const [code, setCode] = useState("");
  const [joinName, setJoinName] = useState("");
  const [busy, setBusy] = useState(false);
  const [createError, setCreateError] = useState("");
  const [joinError, setJoinError] = useState("");

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setCreateError("");
    let created = false;
    try {
      await createHousehold(name.trim(), createName.trim());
      created = true;
    } catch (err) {
      console.error("Failed to create household", err);
      setCreateError("Couldn't create the household. Try again.");
    } finally {
      setBusy(false);
    }
    // A failed refresh is surfaced by the household context's retry state, not as a create error.
    if (created) await refresh().catch(() => {});
  }

  async function onJoin(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setJoinError("");
    let joined = false;
    try {
      await joinHousehold(code.trim(), joinName.trim());
      joined = true;
    } catch (err) {
      setJoinError(joinMessage(err));
    } finally {
      setBusy(false);
    }
    if (joined) await refresh().catch(() => {});
  }

  return (
    <main className="px-4 py-8 sm:px-6">
      <h1 className="mb-4 text-center text-2xl font-semibold text-fg-strong">Our Library</h1>
      <div className="flex flex-col gap-8 mx-auto max-w-sm rounded-xl border border-line bg-raised p-6">
        <p className="rounded-md border border-line bg-surface p-3">
          {email ? (
            <>
              You're signed in as <strong>{email}</strong>. This email isn't part of a household yet.
            </>
          ) : (
            "This account isn't part of a household yet."
          )}{" "}
          Already have a library?{" "}
          <Button variant="ghost" size="sm" onClick={() => void signOut()} className="underline">
            Sign out
          </Button>{" "}
          and use the email you set it up with.
        </p>
        <section>
          <h2 className="mb-3 text-xl font-semibold text-fg-strong">Create a household</h2>
          <form onSubmit={onCreate} className="flex flex-col gap-3">
            <label className="flex flex-col gap-1">
              Household name
              <input required value={name} onChange={(e) => setName(e.target.value)} className={INPUT} />
            </label>
            <label className="flex flex-col gap-1">
              Your name
              <input
                id="create-display-name"
                required
                value={createName}
                onChange={(e) => setCreateName(e.target.value)}
                className={INPUT}
              />
            </label>
            <Button type="submit" variant="primary" disabled={busy}>
              Create household
            </Button>
            {createError && (
              <p role="alert" className="rounded-md bg-danger-surface p-3 text-danger">
                {createError}
              </p>
            )}
          </form>
        </section>
        <section>
          <h2 className="mb-3 text-xl font-semibold text-fg-strong">Join with an invite code</h2>
          <form onSubmit={onJoin} className="flex flex-col gap-3">
            <label className="flex flex-col gap-1">
              Invite code
              <input
                required
                value={code}
                onChange={(e) => setCode(e.target.value)}
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
                className={INPUT}
              />
            </label>
            <label className="flex flex-col gap-1">
              Your name
              <input
                id="join-display-name"
                required
                value={joinName}
                onChange={(e) => setJoinName(e.target.value)}
                className={INPUT}
              />
            </label>
            <Button type="submit" variant="primary" disabled={busy}>
              Join household
            </Button>
            {joinError && (
              <p role="alert" className="rounded-md bg-danger-surface p-3 text-danger">
                {joinError}
              </p>
            )}
          </form>
        </section>
      </div>
    </main>
  );
}
