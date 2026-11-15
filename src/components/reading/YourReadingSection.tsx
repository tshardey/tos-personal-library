import { useRef, useState } from "react";
import { useHousehold } from "@/contexts/HouseholdContext";
import { useReading } from "@/contexts/ReadingContext";
import { localDay } from "@/lib/date-added";
import type { ReadState } from "@/lib/reading/types";

interface Shown {
  state: ReadState;
  finishedOn: string | null;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** 2026-03-02 -> 2 Mar 2026, without a time zone shift. */
function formatDay(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

/** A real calendar day written YYYY-MM-DD. */
function isCompleteDay(v: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const [y, m, d] = v.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

const STATES: { state: ReadState; label: string }[] = [
  { state: "unread", label: "Unread" },
  { state: "read", label: "Read" },
  { state: "dnf", label: "Did not finish" },
];

function otherLine(name: string, shown: Shown | undefined): string {
  if (shown?.state === "read") {
    return shown.finishedOn ? `${name}: read (${formatDay(shown.finishedOn)})` : `${name}: read`;
  }
  if (shown?.state === "dnf") return `${name}: did not finish`;
  return `${name}: not read`;
}

export default function YourReadingSection({ bookId }: { bookId: string }) {
  const { available, byBook, userId, setStatus } = useReading();
  const { members } = useHousehold();
  // What the member just chose, shown until the save settles.
  const [pending, setPending] = useState<Shown | null>(null);
  const [error, setError] = useState(false);
  // The date being typed, kept here until it is a complete date and the input is committed.
  const [draft, setDraft] = useState<string | null>(null);
  const seq = useRef(0);
  if (!available || userId === null) return null;

  const entries = byBook.get(bookId);
  const stored = entries?.get(userId);
  const shown: Shown = pending ?? { state: stored?.state ?? "unread", finishedOn: stored?.finishedOn ?? null };

  const busy = pending !== null;

  async function save(next: Shown) {
    if (busy) return;
    const mine = ++seq.current;
    setError(false);
    setPending(next);
    try {
      await setStatus([bookId], next.state, next.finishedOn, false);
    } catch (err) {
      console.error("Failed to save reading", err instanceof Error ? err.name : "unknown");
      setError(true);
    } finally {
      if (seq.current === mine) setPending(null);
    }
  }

  function commitDate() {
    const value = draft;
    setDraft(null);
    if (value !== null && isCompleteDay(value) && value !== shown.finishedOn) {
      void save({ state: "read", finishedOn: value });
    }
  }

  function choose(state: ReadState) {
    if (state === shown.state) return;
    if (state === "read") void save({ state, finishedOn: shown.finishedOn ?? localDay(new Date().toISOString()) });
    else void save({ state, finishedOn: null });
  }

  return (
    <section className="space-y-2">
      <h3 className="font-semibold">Your reading</h3>
      <div role="group" aria-label="Your reading" className="flex flex-wrap gap-2">
        {STATES.map(({ state, label }) => (
          <button
            key={state}
            type="button"
            aria-pressed={shown.state === state}
            disabled={busy}
            onClick={() => choose(state)}
            className={`rounded border px-3 py-2 text-sm ${
              shown.state === state ? "border-stone-800 bg-stone-800 text-white" : "border-stone-400"
            }`}
          >
            {label}
          </button>
        ))}
      </div>
      {shown.state === "read" && (
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <label className="flex items-center gap-2">
            Finished
            <input
              type="date"
              disabled={busy}
              value={(busy ? null : draft) ?? shown.finishedOn ?? ""}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={commitDate}
              onKeyDown={(e) => {
                if (e.key === "Enter") commitDate();
              }}
              className="rounded border border-stone-400 px-2 py-1"
            />
          </label>
          <button
            type="button"
            disabled={busy}
            onClick={() => void save({ state: "read", finishedOn: null })}
            className="underline"
          >
            Clear date
          </button>
        </div>
      )}
      {error && (
        <p role="alert" className="text-red-700">
          Couldn't save your reading.
        </p>
      )}
      <ul className="text-sm text-stone-700">
        {members
          .filter((m) => m.userId !== userId)
          .map((m) => (
            <li key={m.userId}>{otherLine(m.displayName, entries?.get(m.userId))}</li>
          ))}
      </ul>
    </section>
  );
}
