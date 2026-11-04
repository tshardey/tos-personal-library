import { useState, type FormEvent } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useHousehold } from "@/contexts/HouseholdContext";
import { createHousehold, joinHousehold } from "@/lib/household-repo";

const INPUT = "rounded border px-2 py-1";
const BUTTON = "rounded bg-stone-800 px-3 py-2 text-white disabled:opacity-50";

function joinMessage(err: unknown): string {
  if (err instanceof Error && err.message === "invalid_invite_code") {
    return "That invite code didn't match a household.";
  }
  console.error("Failed to join household", err);
  return "Couldn't join the household. Try again.";
}

export default function HouseholdSetup() {
  const { refresh } = useHousehold();
  const { signOut } = useAuth();
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
    <main className="mx-auto flex max-w-sm flex-col gap-8 p-6">
      <div className="flex justify-end">
        <button type="button" onClick={() => void signOut()} className="underline">
          Sign out
        </button>
      </div>
      <section>
        <h2 className="mb-3 text-xl font-semibold">Create a household</h2>
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
          <button type="submit" disabled={busy} className={BUTTON}>
            Create household
          </button>
          {createError && (
            <p role="alert" className="text-red-700">
              {createError}
            </p>
          )}
        </form>
      </section>
      <section>
        <h2 className="mb-3 text-xl font-semibold">Join with an invite code</h2>
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
          <button type="submit" disabled={busy} className={BUTTON}>
            Join household
          </button>
          {joinError && (
            <p role="alert" className="text-red-700">
              {joinError}
            </p>
          )}
        </form>
      </section>
    </main>
  );
}
