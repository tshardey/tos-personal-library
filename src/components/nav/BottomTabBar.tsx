import { useState } from "react";
import { LibraryIcon, MoreIcon, PlusIcon, ScanIcon } from "@/components/ui";
import { tabFor, type Route } from "@/lib/router";
import AddChooser from "./AddChooser";
import CoversTab from "./CoversTab";
import MoreMenu from "./MoreMenu";
import { barItemClass } from "./nav-styles";

interface Props {
  route: Route;
  email: string | undefined;
  onSignOut(): void;
}

/** The phone's fixed bottom tab bar (D7): Library, Add, Scan in a raised centre circle, Covers, More. */
export default function BottomTabBar({ route, email, onSignOut }: Props) {
  const tab = tabFor(route);
  const [sheet, setSheet] = useState<"add" | "more" | null>(null);
  const page = (current: boolean) => (current ? ("page" as const) : undefined);
  const close = () => setSheet(null);

  return (
    <>
      <nav
        aria-label="Main"
        data-testid="bottom-tab-bar"
        className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-raised pb-[env(safe-area-inset-bottom)]"
      >
        <div className="mx-auto flex h-14 max-w-lg items-stretch">
          <a href="#/" aria-current={page(tab === "library")} className={barItemClass(tab === "library")}>
            <LibraryIcon className="size-6" />
            Library
          </a>
          <button
            type="button"
            aria-current={page(tab === "add")}
            aria-haspopup="dialog"
            onClick={() => setSheet("add")}
            className={barItemClass(tab === "add")}
          >
            <PlusIcon className="size-6" />
            Add
          </button>
          <a href="#/scan" aria-current={page(tab === "scan")} className={barItemClass(tab === "scan")}>
            <span className="-mt-4 flex size-14 items-center justify-center rounded-full bg-accent text-on-accent shadow-lg">
              <ScanIcon className="size-7" />
            </span>
            Scan
          </a>
          <CoversTab variant="bar" current={tab === "covers"} />
          <button
            type="button"
            aria-current={page(tab === "more")}
            aria-haspopup="dialog"
            onClick={() => setSheet("more")}
            className={barItemClass(tab === "more")}
          >
            <MoreIcon className="size-6" />
            More
          </button>
        </div>
      </nav>
      {sheet === "add" && <AddChooser onClose={close} />}
      {sheet === "more" && <MoreMenu email={email} onSignOut={onSignOut} onClose={close} />}
    </>
  );
}
