import { useState } from "react";
import { formatDay } from "@/lib/reading/format-day";
import { readingStats } from "@/lib/reading/stats";
import type { ReadStatusMap } from "@/lib/reading/types";
import type { BookWithCopies, HouseholdMember } from "@/lib/types";

interface Props {
  books: BookWithCopies[];
  byBook: ReadStatusMap;
  members: HouseholdMember[];
  me: string | null;
  /** YYYY-MM-DD, the local day. */
  today: string;
}

/** D10 section 1: one block per member, me first, with one shared Since date. */
export default function ReadingStatsPanel({ books, byBook, members, me, today }: Props) {
  const [since, setSince] = useState("");
  const ordered = [...members].sort((a, b) => Number(b.userId === me) - Number(a.userId === me));
  return (
    <section aria-label="Reading" className="space-y-3">
      <h3 className="font-medium">Reading</h3>
      <label className="block text-sm">
        Since
        <input
          type="date"
          value={since}
          onChange={(e) => setSince(e.target.value)}
          className="mt-1 block rounded border p-2"
        />
      </label>
      <ul className="space-y-2">
        {ordered.map((m) => {
          const s = readingStats(books, byBook, m.userId, { today, since: since === "" ? null : since });
          return (
            <li key={m.userId} aria-label={m.displayName} className="rounded border p-3 text-sm">
              <p className="font-medium">{m.displayName}</p>
              {s.owned === 0 ? (
                <p>No books yet</p>
              ) : (
                <>
                  <p>{`Read of owned: ${s.read} of ${s.owned}, ${s.pct}%`}</p>
                  <p>{`Read this year: ${s.readThisYear}`}</p>
                  {s.readSince !== null && <p>{`Read since ${formatDay(since)}: ${s.readSince}`}</p>}
                  <p>{`Did not finish: ${s.dnf}`}</p>
                </>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
