import type { ReactNode } from "react";
import { DESKTOP, useMediaQuery } from "@/hooks/useMediaQuery";
import type { Route } from "@/lib/router";
import BottomTabBar from "./BottomTabBar";
import TopNav from "./TopNav";

interface Props {
  route: Route;
  email: string | undefined;
  onSignOut(): void;
  children: ReactNode;
}

/**
 * The signed-in frame (D3, D7). The phone gets a short header that scrolls away and a fixed bottom tab bar;
 * the computer gets a sticky header holding the nav. Only one of the two navs renders, so one `Main` exists.
 */
export default function AppShell({ route, email, onSignOut, children }: Props) {
  const desktop = useMediaQuery(DESKTOP);
  const title = (
    <h1 className="text-lg font-semibold text-fg-strong">
      <a href="#/">Our Library</a>
    </h1>
  );

  return (
    <div>
      {desktop ? (
        <header className="sticky top-0 z-30 flex h-14 items-center gap-6 border-b border-line bg-raised px-6">
          {title}
          <TopNav route={route} email={email} onSignOut={onSignOut} />
        </header>
      ) : (
        <header className="flex h-12 items-center px-4">{title}</header>
      )}
      <main className="pb-[var(--nav-bottom)]">{children}</main>
      {!desktop && <BottomTabBar route={route} email={email} onSignOut={onSignOut} />}
    </div>
  );
}
