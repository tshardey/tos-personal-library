import { useTagging } from "@/contexts/TaggingContext";

/** Stub until Plan 7 Task 13 builds the page. */
export default function TagSuggestionsPage() {
  const { available } = useTagging();
  return (
    <section className="p-3 sm:p-4">
      <h2 className="text-lg font-semibold">Tag suggestions</h2>
      {!available && <p>Tagging isn't available yet.</p>}
    </section>
  );
}
