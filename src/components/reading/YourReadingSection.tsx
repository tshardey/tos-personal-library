import type { ReadState } from "@/lib/reading/types";
import { useYourReading, type YourReading } from "./useYourReading";

const STATES: { state: ReadState; label: string }[] = [
  { state: "unread", label: "Unread" },
  { state: "read", label: "Read" },
  { state: "dnf", label: "Did not finish" },
];

export function YourReadingControl({ reading }: { reading: YourReading }) {
  if (!reading.available) return null;
  const { shown, busy, error, draft, others, groupRef } = reading;

  return (
    <section className="space-y-2">
      <h3 className="font-semibold">Your reading</h3>
      <div ref={groupRef} tabIndex={-1} role="group" aria-label="Your reading" className="flex flex-wrap gap-2">
        {STATES.map(({ state, label }) => (
          <button
            key={state}
            type="button"
            aria-pressed={shown.state === state}
            disabled={busy}
            onClick={() => reading.choose(state)}
            className={`min-h-11 rounded border px-3 py-2 text-sm sm:min-h-9 ${
              shown.state === state ? "border-accent bg-accent text-on-accent" : "border-field"
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
              value={draft ?? shown.finishedOn ?? ""}
              onChange={(e) => reading.changeDate(e.target.value)}
              className="rounded border border-field px-2 py-1"
            />
          </label>
          <button type="button" disabled={busy} onClick={reading.clearDate} className="min-h-11 underline sm:min-h-9">
            Clear date
          </button>
        </div>
      )}
      {error && (
        <p role="alert" className="text-danger">
          Couldn't save your reading.
        </p>
      )}
      <ul className="text-sm text-muted">
        {others.map((o) => (
          <li key={o.userId}>{o.line}</li>
        ))}
      </ul>
    </section>
  );
}

export default function YourReadingSection({ bookId }: { bookId: string }) {
  return <YourReadingControl reading={useYourReading(bookId)} />;
}
