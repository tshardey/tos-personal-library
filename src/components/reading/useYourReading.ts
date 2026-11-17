import { useEffect, useRef, useState, type RefObject } from "react";
import { useHousehold } from "@/contexts/HouseholdContext";
import { useReading } from "@/contexts/ReadingContext";
import { localDay } from "@/lib/date-added";
import { formatDay } from "@/lib/reading/format-day";
import type { ReadState } from "@/lib/reading/types";

interface Shown {
  state: ReadState;
  finishedOn: string | null;
}

export interface YourReading {
  available: boolean;
  shown: Shown;
  busy: boolean;
  error: boolean;
  draft: string | null;
  others: { userId: string; line: string }[];
  choose(state: ReadState): void;
  changeDate(value: string): void;
  clearDate(): void;
  groupRef: RefObject<HTMLDivElement | null>;
}

/** A real calendar day written YYYY-MM-DD. */
function isCompleteDay(v: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const [y, m, d] = v.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

function otherLine(name: string, shown: Shown | undefined): string {
  if (shown?.state === "read") {
    return shown.finishedOn ? `${name}: read (${formatDay(shown.finishedOn)})` : `${name}: read`;
  }
  if (shown?.state === "dnf") return `${name}: did not finish`;
  return `${name}: not read`;
}

export function useYourReading(bookId: string): YourReading {
  const { available, byBook, userId, setStatus } = useReading();
  const { members } = useHousehold();
  // What the member just chose, shown until the save settles.
  const [pending, setPending] = useState<Shown | null>(null);
  const [error, setError] = useState(false);
  // The date being typed, kept here until it is a complete date and the input is committed.
  const [draft, setDraft] = useState<string | null>(null);
  const seq = useRef(0);
  const inFlight = useRef(false);
  // The latest date picked while a save was running; sent when that save settles.
  const queued = useRef<string | null>(null);
  const mounted = useRef(true);
  const groupRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const setStatusRef = useRef(setStatus);
  setStatusRef.current = setStatus;

  const entries = byBook.get(bookId);
  const stored = userId === null ? undefined : entries?.get(userId);
  const shown: Shown = pending ?? { state: stored?.state ?? "unread", finishedOn: stored?.finishedOn ?? null };

  const busy = pending !== null;

  // Runs off refs only, so a queued date is still sent after the component unmounts.
  async function save(first: Shown) {
    if (inFlight.current) return;
    inFlight.current = true;
    const mine = ++seq.current;
    let sent = first;
    if (mounted.current) {
      setError(false);
      setPending(sent);
    }
    try {
      for (;;) {
        try {
          await setStatusRef.current([bookId], sent.state, sent.finishedOn, false);
        } catch (err) {
          console.error("Failed to save reading", err instanceof Error ? err.name : "unknown");
          queued.current = null;
          if (mounted.current) setError(true);
          break;
        }
        const q = queued.current;
        queued.current = null;
        if (q === null || q === sent.finishedOn) break;
        sent = { state: "read", finishedOn: q };
        if (mounted.current) setPending(sent);
      }
    } finally {
      inFlight.current = false;
      const last = sent.finishedOn;
      if (mounted.current && seq.current === mine) {
        setPending(null);
        setDraft((d) => (d === last ? null : d));
      }
    }
  }

  function changeDate(value: string) {
    setDraft(value);
    if (!isCompleteDay(value)) return;
    if (inFlight.current) queued.current = value;
    else if (value !== shown.finishedOn) void save({ state: "read", finishedOn: value });
  }

  function choose(state: ReadState) {
    if (state === shown.state) return;
    if (state === "read") void save({ state, finishedOn: shown.finishedOn ?? localDay(new Date().toISOString()) });
    else void save({ state, finishedOn: null });
  }

  function clearDate() {
    void save({ state: "read", finishedOn: null });
  }

  const others = members
    .filter((m) => m.userId !== userId)
    .map((m) => ({ userId: m.userId, line: otherLine(m.displayName, entries?.get(m.userId)) }));

  return {
    available: available && userId !== null,
    shown,
    busy,
    error,
    draft,
    others,
    choose,
    changeDate,
    clearDate,
    groupRef,
  };
}
