import { useCallback, useSyncExternalStore } from "react";

/** The phone/computer layout split. The book page columns at md are CSS only. */
export const DESKTOP = "(min-width: 640px)";

const hasMatchMedia = () => typeof window !== "undefined" && typeof window.matchMedia === "function";

export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (cb: () => void) => {
      if (!hasMatchMedia()) return () => {};
      const mql = window.matchMedia(query);
      mql.addEventListener("change", cb);
      return () => mql.removeEventListener("change", cb);
    },
    [query],
  );
  const get = () => (hasMatchMedia() ? window.matchMedia(query).matches : false);
  return useSyncExternalStore(subscribe, get, () => false);
}
