import { ChevronDownIcon, Menu } from "@/components/ui";
import { tabFor, type Route } from "@/lib/router";
import { AddLinks } from "./AddChooser";
import CoversTab from "./CoversTab";
import { MoreContent } from "./MoreMenu";
import { topLabelClass, topLinkClass } from "./nav-styles";

interface Props {
  route: Route;
  email: string | undefined;
  onSignOut(): void;
}

/** The computer's nav row in the sticky header (D7): Library, Add ▾, Scan, Covers, More ▾. */
export default function TopNav({ route, email, onSignOut }: Props) {
  const tab = tabFor(route);
  const page = (current: boolean) => (current ? ("page" as const) : undefined);
  const menuButton = (label: string, current: boolean) => (
    <>
      <span className={topLabelClass(current)}>{label}</span>
      <ChevronDownIcon className="size-4 text-muted" />
    </>
  );

  return (
    <nav aria-label="Main" className="flex items-center gap-1 text-sm">
      <a href="#/" aria-current={page(tab === "library")} className={topLinkClass}>
        <span className={topLabelClass(tab === "library")}>Library</span>
      </a>
      <Menu label="Add" current={tab === "add"} button={menuButton("Add", tab === "add")}>
        {(close) => <AddLinks onNavigate={close} />}
      </Menu>
      <a href="#/scan" aria-current={page(tab === "scan")} className={topLinkClass}>
        <span className={topLabelClass(tab === "scan")}>Scan</span>
      </a>
      <CoversTab variant="top" current={tab === "covers"} />
      <Menu label="More" align="end" current={tab === "more"} button={menuButton("More", tab === "more")}>
        {(close) => (
          <div className="w-64">
            <MoreContent email={email} onSignOut={onSignOut} onNavigate={close} />
          </div>
        )}
      </Menu>
    </nav>
  );
}
