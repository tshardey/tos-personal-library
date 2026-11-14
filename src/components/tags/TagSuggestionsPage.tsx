import { useId, useMemo, useRef, useState } from "react";
import { useTagging } from "@/contexts/TaggingContext";
import { useCatalog } from "@/hooks/useCatalog";
import { formatUsd } from "@/lib/covers/cost";
import { NEW_TAGS_PER_BOOK_ESTIMATE_MICRO, TAG_PER_BOOK_ESTIMATE_MICRO } from "@/lib/tagging/cost";
import { newTagsEligible, runEligible, runProgress } from "@/lib/tagging/eligibility";
import { tagIdFromLabel } from "@/lib/tagging/slug";
import { LIBRARY_TAG_CATEGORIES, type LibraryTagCategory, type TagSuggestion } from "@/lib/tagging/types";
import TagRunPanel from "./TagRunPanel";

const categoryLabel = (c: LibraryTagCategory) => LIBRARY_TAG_CATEGORIES.find((x) => x.id === c)?.label ?? c;
const input = "mt-1 block w-full rounded border p-2";

function CategorySelect({ value, onChange }: { value: LibraryTagCategory; onChange(c: LibraryTagCategory): void }) {
  return (
    <label className="block text-sm">
      Category
      <select value={value} onChange={(e) => onChange(e.target.value as LibraryTagCategory)} className={input}>
        {LIBRARY_TAG_CATEGORIES.map((c) => (
          <option key={c.id} value={c.id}>
            {c.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function SuggestionItem({
  suggestion: s,
  titles,
  approve,
  dismiss,
}: {
  suggestion: TagSuggestion;
  titles: Map<string, string>;
  approve(id: string, label: string, category: LibraryTagCategory): Promise<number>;
  dismiss(id: string): Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [label, setLabel] = useState(s.label);
  const [category, setCategory] = useState<LibraryTagCategory>(s.category);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const busy = useRef(false);

  async function act(run: () => Promise<unknown>, failure: string) {
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    setError(null);
    try {
      await run();
    } catch (err) {
      console.error("Tag suggestion action failed", err instanceof Error ? err.name : "unknown");
      setError(failure);
    } finally {
      busy.current = false;
      setPending(false);
    }
  }

  const books = s.books.filter((b) => titles.has(b.bookId));
  return (
    <li aria-label={s.label} className="rounded border p-3">
      <p className="font-medium">{s.label}</p>
      <p className="text-sm text-stone-600">{categoryLabel(s.category)}</p>
      <ul className="mt-1 space-y-1 text-sm">
        {books.map((b) => (
          <li key={b.bookId}>
            <a href={`#/book/${b.bookId}`} className="underline">
              {titles.get(b.bookId)}
            </a>
            {b.why && <span className="text-stone-700">{` — ${b.why}`}</span>}
          </li>
        ))}
      </ul>
      {editing ? (
        <div className="mt-2 space-y-2">
          <label className="block text-sm">
            Label
            <input type="text" value={label} onChange={(e) => setLabel(e.target.value)} className={input} />
          </label>
          <CategorySelect value={category} onChange={setCategory} />
          <div className="flex gap-2">
            <button
              type="button"
              disabled={pending || label.trim() === ""}
              onClick={() => void act(() => approve(s.id, label.trim(), category), "Couldn't approve the tag.")}
              className="min-h-10 rounded bg-stone-800 px-3 text-white disabled:opacity-50"
            >
              Confirm
            </button>
            <button type="button" disabled={pending} onClick={() => setEditing(false)} className="min-h-10 rounded border px-3">
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-2 flex gap-2">
          <button
            type="button"
            disabled={pending}
            onClick={() => setEditing(true)}
            className="min-h-10 rounded bg-stone-800 px-3 text-white disabled:opacity-50"
          >
            Approve
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={() => void act(() => dismiss(s.id), "Couldn't dismiss the suggestion.")}
            className="min-h-10 rounded border px-3 disabled:opacity-50"
          >
            Dismiss
          </button>
        </div>
      )}
      {error && (
        <p role="alert" className="mt-1 text-sm text-red-700">
          {error}
        </p>
      )}
    </li>
  );
}

function AddTagForm({ createTag }: { createTag(label: string, category: LibraryTagCategory): Promise<"added" | "exists"> }) {
  const headingId = useId();
  const [label, setLabel] = useState("");
  const [category, setCategory] = useState<LibraryTagCategory>(LIBRARY_TAG_CATEGORIES[0].id);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  const busy = useRef(false);

  async function add() {
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    setMessage(null);
    const text = label.trim();
    try {
      const out = await createTag(text, category);
      if (out === "exists") {
        setMessage({ text: "That tag already exists.", error: true });
      } else {
        setMessage({ text: `Added ${text}.`, error: false });
        setLabel("");
      }
    } catch (err) {
      console.error("Failed to add tag", err instanceof Error ? err.name : "unknown");
      setMessage({ text: "Couldn't add the tag.", error: true });
    } finally {
      busy.current = false;
      setPending(false);
    }
  }

  return (
    <section aria-labelledby={headingId} className="rounded border p-3">
      <h3 id={headingId} className="font-medium">
        Add a tag
      </h3>
      <form
        className="mt-1 space-y-2"
        onSubmit={(e) => {
          e.preventDefault();
          void add();
        }}
      >
        <label className="block text-sm">
          Label
          <input
            type="text"
            value={label}
            maxLength={60}
            onChange={(e) => {
              setLabel(e.target.value);
              setMessage(null);
            }}
            className={input}
          />
        </label>
        <CategorySelect value={category} onChange={setCategory} />
        <button
          type="submit"
          disabled={pending || tagIdFromLabel(label) === ""}
          className="min-h-10 rounded bg-stone-800 px-3 text-white disabled:opacity-50"
        >
          Add tag
        </button>
        {message && (
          <p role={message.error ? "alert" : "status"} className={`text-sm ${message.error ? "text-red-700" : "text-stone-700"}`}>
            {message.text}
          </p>
        )}
      </form>
    </section>
  );
}

/** D14: `#/tags` — budget line, Tag all books, Check for new tags, suggestions, Add a tag. */
export default function TagSuggestionsPage() {
  const tagging = useTagging();
  const { books, loading: catalogLoading } = useCatalog();
  const { available, loading, cards, jobs, vocabVersion, budgets, suggestions, runId } = tagging;

  const runIds = useMemo(() => runEligible(books, cards, jobs), [books, cards, jobs]);
  const newIds = useMemo(() => newTagsEligible(cards, vocabVersion, jobs), [cards, vocabVersion, jobs]);
  const progress = useMemo(() => runProgress(jobs, runId), [jobs, runId]);
  const titles = useMemo(() => new Map(books.map((b) => [b.id, b.title])), [books]);

  return (
    <section className="mx-auto max-w-3xl space-y-4 p-3 sm:p-4">
      <h2 className="text-lg font-semibold">Tag suggestions</h2>
      {!loading && !available && <p>Tagging isn't available yet.</p>}
      {available && (
        <>
          {budgets.tagging !== null && budgets.ask !== null && (
            <p className="text-sm text-stone-700">
              {`This month: ${formatUsd(budgets.tagging.spentMicro)} of ${formatUsd(budgets.tagging.budgetMicro)} used for tagging, ${formatUsd(budgets.ask.spentMicro)} of ${formatUsd(budgets.ask.budgetMicro)} for Ask.`}
            </p>
          )}
          {catalogLoading ? (
            <p>Loading…</p>
          ) : (
            <>
              <TagRunPanel
                title="Tag all books"
                eligible={runIds}
                perBookMicro={TAG_PER_BOOK_ESTIMATE_MICRO}
                budget={budgets.tagging}
                actions={[{ label: "Tag all books" }, { label: "Try 10 first", limit: 10 }]}
                emptyText="Every book on the shelf is tagged."
                progress={progress}
                onRun={tagging.tagAll}
              />
              <TagRunPanel
                title="Check for new tags"
                eligible={newIds}
                perBookMicro={NEW_TAGS_PER_BOOK_ESTIMATE_MICRO}
                budget={budgets.tagging}
                actions={[{ label: "Check for new tags" }]}
                emptyText="Every book has been checked against the current tags."
                progress={null}
                onRun={tagging.checkNewTags}
              />
            </>
          )}
          <section aria-label="Suggestions">
            <h3 className="mb-2 font-medium">Suggestions</h3>
            {suggestions.length === 0 ? (
              <p className="text-sm text-stone-700">No suggestions right now.</p>
            ) : (
              <ul className="space-y-2">
                {suggestions.map((s) => (
                  <SuggestionItem
                    key={s.id}
                    suggestion={s}
                    titles={titles}
                    approve={tagging.approve}
                    dismiss={tagging.dismiss}
                  />
                ))}
              </ul>
            )}
          </section>
          <AddTagForm createTag={tagging.createTag} />
        </>
      )}
    </section>
  );
}
