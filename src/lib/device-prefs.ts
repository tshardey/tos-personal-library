import { useState } from "react";

/** Reads a per-device preference. Blocked storage or a stale value gives the fallback. */
export function readPref<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  try {
    const v = window.localStorage.getItem(key);
    return allowed.find((a) => a === v) ?? fallback;
  } catch {
    return fallback;
  }
}

export function writePref(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // blocked storage: the preference lasts for this session only
  }
}

export function useDevicePref<T extends string>(
  key: string,
  allowed: readonly T[],
  fallback: T,
): [T, (v: T) => void] {
  const [value, setValue] = useState<T>(() => readPref(key, allowed, fallback));
  const set = (v: T) => {
    setValue(v);
    writePref(key, v);
  };
  return [value, set];
}
