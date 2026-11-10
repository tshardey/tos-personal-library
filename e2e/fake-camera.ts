import type { Page } from "@playwright/test";

export type CameraVariant = "normal" | "deny" | "torch";

/**
 * An init script that replaces `navigator.mediaDevices.getUserMedia` with a `canvas.captureStream`
 * stream. The canvas draws whatever `window.__fakeCamera.show(url | null)` last set, on white,
 * inside the scanner's centre guide band. `tracks()` lists every track handed out.
 *
 * - `deny`: getUserMedia rejects with NotAllowedError.
 * - `torch`: the track reports `{ torch: true }` and records each `applyConstraints` call.
 */
function install(variant: CameraVariant) {
  const W = 640;
  const H = 480;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d")!;
  let image: HTMLImageElement | null = null;
  const tracks: MediaStreamTrack[] = [];
  const applied: unknown[] = [];

  const draw = () => {
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, W, H);
    // A frame counter in the corner, outside the guide band, so every frame differs.
    ctx.fillStyle = "#eee";
    ctx.fillRect(0, 0, (Date.now() / 10) % 40, 4);
    if (image) {
      // The guide band is the centre 90% × 35% (168 px here); keep the bars well inside it.
      const w = 520;
      const h = 120;
      ctx.drawImage(image, (W - w) / 2, (H - h) / 2, w, h);
    }
  };
  draw();
  setInterval(draw, 50);

  const api = {
    show(url: string | null): Promise<void> {
      if (url === null) {
        image = null;
        draw();
        return Promise.resolve();
      }
      return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
          image = img;
          draw();
          resolve();
        };
        img.onerror = () => reject(new Error("fake camera image failed to load"));
        img.src = url;
      });
    },
    tracks: () => tracks.map((t) => ({ readyState: t.readyState })),
    applied: () => applied,
  };
  (window as unknown as { __fakeCamera: typeof api }).__fakeCamera = api;

  const md = navigator.mediaDevices;
  if (!md) return;
  md.getUserMedia = async () => {
    if (variant === "deny") throw new DOMException("Permission denied", "NotAllowedError");
    const stream = canvas.captureStream(15);
    const track = stream.getVideoTracks()[0];
    if (variant === "torch") {
      track.getCapabilities = () => ({ torch: true }) as MediaTrackCapabilities;
      track.applyConstraints = async (c?: MediaTrackConstraints) => {
        applied.push(JSON.parse(JSON.stringify(c ?? null)));
      };
    } else {
      track.getCapabilities = () => ({}) as MediaTrackCapabilities;
    }
    tracks.push(track);
    return stream;
  };
}

export async function installFakeCamera(page: Page, variant: CameraVariant = "normal"): Promise<void> {
  await page.addInitScript(install, variant);
}

export async function show(page: Page, url: string | null): Promise<void> {
  await page.evaluate((u) => (window as unknown as { __fakeCamera: { show(u: string | null): Promise<void> } }).__fakeCamera.show(u), url);
}

export async function cameraTracks(page: Page): Promise<{ readyState: string }[]> {
  return page.evaluate(() =>
    (window as unknown as { __fakeCamera: { tracks(): { readyState: string }[] } }).__fakeCamera.tracks(),
  );
}

export async function torchCalls(page: Page): Promise<unknown[]> {
  return page.evaluate(() => (window as unknown as { __fakeCamera: { applied(): unknown[] } }).__fakeCamera.applied());
}
