interface Sentinel {
  release(): Promise<void>;
}

/** Keeps the screen on while uploading. Does nothing where unsupported; never throws. */
export function holdWakeLock(): { release(): void } {
  let sentinel: Sentinel | null = null;
  let released = false;

  const request = async () => {
    try {
      const wl = (navigator as unknown as { wakeLock?: { request(t: "screen"): Promise<Sentinel> } }).wakeLock;
      if (!wl || released) return;
      const s = await wl.request("screen");
      if (released) {
        void s.release().catch(() => {});
        return;
      }
      sentinel = s;
    } catch {
      // Denied, or the page isn't visible: the upload continues without it.
    }
  };

  const onVisibility = () => {
    if (document.visibilityState === "visible") void request();
  };

  document.addEventListener("visibilitychange", onVisibility);
  void request();

  return {
    release() {
      released = true;
      document.removeEventListener("visibilitychange", onVisibility);
      const s = sentinel;
      sentinel = null;
      if (s) void s.release().catch(() => {});
    },
  };
}
