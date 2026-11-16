import { useCoverFinder } from "@/contexts/CoverFinderContext";
import { Badge, CoversIcon } from "@/components/ui";
import { barItemClass, topLabelClass, topLinkClass } from "./nav-styles";

/** Always present (§5.14). Carries the review count, in its name and as a badge, only when covers wait. */
export default function CoversTab({ variant, current }: { variant: "bar" | "top"; current: boolean }) {
  const { available, reviewCount } = useCoverFinder();
  const count = available && reviewCount > 0 ? reviewCount : 0;
  const label = count > 0 ? `Covers, ${count} to review` : undefined;
  const ariaCurrent = current ? "page" : undefined;
  const badge = (className: string) =>
    count > 0 ? (
      <span aria-hidden="true" className={className}>
        <Badge tone="accent" className="min-w-5 justify-center px-1">
          {count}
        </Badge>
      </span>
    ) : null;

  if (variant === "bar") {
    return (
      <a href="#/covers" aria-label={label} aria-current={ariaCurrent} className={barItemClass(current)}>
        <span className="relative">
          <CoversIcon className="size-6" />
          {badge("absolute -right-3 -top-1.5")}
        </span>
        Covers
      </a>
    );
  }
  return (
    <a href="#/covers" aria-label={label} aria-current={ariaCurrent} className={topLinkClass}>
      <span className={topLabelClass(current)}>Covers</span>
      {badge("ml-1.5")}
    </a>
  );
}
