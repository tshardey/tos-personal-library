import { useEffect, useState } from "react";

export type Route = { name: "library" } | { name: "book"; id: string } | { name: "add" };

export function parseHash(hash: string): Route {
  const path = hash.replace(/^#/, "");
  if (path === "/add") return { name: "add" };
  const m = /^\/book\/(.+)$/.exec(path);
  if (m) return { name: "book", id: decodeURIComponent(m[1]) };
  return { name: "library" };
}

export function routeToHash(route: Route): string {
  switch (route.name) {
    case "add":
      return "#/add";
    case "book":
      return `#/book/${encodeURIComponent(route.id)}`;
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
