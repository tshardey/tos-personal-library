import { useCoverFinder } from "@/contexts/CoverFinderContext";

/** Header link to the review list; hidden when there is nothing to review or the feature is unavailable. */
export default function CoversBadge() {
  const { available, reviewCount } = useCoverFinder();
  if (!available || reviewCount === 0) return null;
  return (
    <a
      href="#/covers"
      className="rounded-full bg-amber-100 px-3 py-1 text-sm font-medium text-amber-900 hover:bg-amber-200"
    >
      Covers to review ({reviewCount})
    </a>
  );
}
