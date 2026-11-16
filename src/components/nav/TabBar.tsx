import { tabFor, type Route, type Tab } from "@/lib/router";

const TABS: { tab: Tab; href: string; label: string }[] = [
  { tab: "library", href: "#/", label: "Library" },
  { tab: "scan", href: "#/scan", label: "Scan" },
  { tab: "inbox", href: "#/inbox", label: "Photos" },
  { tab: "import", href: "#/import", label: "Import" },
];

export default function TabBar({ route }: { route: Route }) {
  const current = tabFor(route);
  return (
    <nav aria-label="Main" className="flex border-b">
      {TABS.map((t) => {
        const active = t.tab === current;
        return (
          <a
            key={t.tab}
            href={t.href}
            aria-current={active ? "page" : undefined}
            className={`flex min-h-10 flex-1 items-center justify-center border-b-2 px-2 text-sm ${
              active ? "border-accent font-semibold text-fg-strong" : "border-transparent text-muted"
            }`}
          >
            {t.label}
          </a>
        );
      })}
    </nav>
  );
}
