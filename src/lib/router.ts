import { useEffect, useState } from "react";

export type Route =
  | { name: "library"; series?: string }
  | { name: "book"; id: string }
  | { name: "add" }
  | { name: "import" }
  | { name: "inbox" }
  | { name: "scan" }
  | { name: "covers" }
  | { name: "editions" }
  | { name: "tags" };

export function parseHash(hash: string): Route {
  const path = hash.replace(/^#/, "");
  if (path === "/add") return { name: "add" };
  if (path === "/import") return { name: "import" };
  if (path === "/inbox") return { name: "inbox" };
  if (path === "/scan") return { name: "scan" };
  if (path === "/covers") return { name: "covers" };
  if (path === "/editions") return { name: "editions" };
  if (path === "/tags") return { name: "tags" };
  const sm = /^\/series\/(.+)$/.exec(path);
  if (sm) {
    try {
      return { name: "library", series: decodeURIComponent(sm[1]) };
    } catch {
      return { name: "library" };
    }
  }
  const m = /^\/book\/(.+)$/.exec(path);
  if (m) {
    try {
      return { name: "book", id: decodeURIComponent(m[1]) };
    } catch {
      return { name: "library" };
    }
  }
  return { name: "library" };
}

export function routeToHash(route: Route): string {
  switch (route.name) {
    case "add":
      return "#/add";
    case "import":
      return "#/import";
    case "inbox":
      return "#/inbox";
    case "scan":
      return "#/scan";
    case "covers":
      return "#/covers";
    case "editions":
      return "#/editions";
    case "tags":
      return "#/tags";
    case "book":
      return `#/book/${encodeURIComponent(route.id)}`;
    case "library":
      return route.series ? `#/series/${encodeURIComponent(route.series)}` : "#/";
    default:
      return "#/";
  }
}

export function navigate(route: Route): void {
  window.location.hash = routeToHash(route);
}

export function useRoute(): Route {
  const [hash, setHash] = useState(() => window.location.hash);
  useEffect(() => {
    const onChange = () => setHash(window.location.hash);
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  return parseHash(hash);
}

export type Tab = "library" | "scan" | "inbox" | "import";

/** The nav tab a route belongs to: book detail, Add and the cover review count as Library. */
export function tabFor(route: Route): Tab {
  switch (route.name) {
    case "scan":
    case "inbox":
    case "import":
      return route.name;
    default:
      return "library";
  }
}
