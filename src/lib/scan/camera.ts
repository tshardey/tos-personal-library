export type CameraErrorCode = "denied" | "no_camera" | "busy" | "unsupported" | "unknown";

export class CameraError extends Error {
  code: CameraErrorCode;
  constructor(code: CameraErrorCode) {
    super(`camera ${code}`);
    this.name = "CameraError";
    this.code = code;
  }
}

export interface CameraHandle {
  torchSupported: boolean;
  setTorch(on: boolean): Promise<void>;
  /** Stops every track (which also turns the torch off) and detaches the stream. */
  stop(): void;
}

/** D11. */
export const CAMERA_CONSTRAINTS: MediaStreamConstraints = {
  audio: false,
  video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } },
};

const errorName = (err: unknown) => (typeof err === "object" && err !== null ? (err as { name?: string }).name : "");

function toCameraError(err: unknown): CameraError {
  switch (errorName(err)) {
    case "NotAllowedError":
    case "SecurityError":
      return new CameraError("denied");
    case "NotFoundError":
      return new CameraError("no_camera");
    case "NotReadableError":
      return new CameraError("busy");
    default:
      return new CameraError("unknown");
  }
}

/** Starts the back camera into `video`. The wake lock is the caller's (holdWakeLock, D11). */
export async function startCamera(
  video: HTMLVideoElement,
  md: MediaDevices | undefined = typeof navigator === "undefined" ? undefined : navigator.mediaDevices,
): Promise<CameraHandle> {
  if (!md || typeof md.getUserMedia !== "function") throw new CameraError("unsupported");

  let stream: MediaStream;
  try {
    stream = await md.getUserMedia(CAMERA_CONSTRAINTS);
  } catch (err) {
    if (errorName(err) !== "OverconstrainedError") throw toCameraError(err);
    try {
      stream = await md.getUserMedia({ video: true });
    } catch (retryErr) {
      throw toCameraError(retryErr);
    }
  }

  // iOS needs all three, and the attribute form of playsinline for older Safari.
  video.playsInline = true;
  video.muted = true;
  video.autoplay = true;
  video.setAttribute("playsinline", "");
  video.srcObject = stream;
  try {
    await video.play();
  } catch {
    // autoplay starts it once it can; a rejected play() is usually an interrupted load.
  }

  const track = stream.getVideoTracks()[0] as MediaStreamTrack | undefined;
  let torchSupported = false;
  try {
    const caps = track?.getCapabilities?.() as (MediaTrackCapabilities & { torch?: boolean }) | undefined;
    torchSupported = caps?.torch === true;
  } catch {
    torchSupported = false;
  }

  return {
    torchSupported,
    async setTorch(on) {
      if (!track) return;
      await track.applyConstraints({ advanced: [{ torch: on } as MediaTrackConstraintSet] });
    },
    stop() {
      for (const t of stream.getTracks()) {
        try {
          t.stop();
        } catch {
          // Already stopped.
        }
      }
      video.srcObject = null;
    },
  };
}

/** The center guide band, 90% of the width by 35% of the height, at native resolution (D11). */
export function grabGuideFrame(video: HTMLVideoElement, canvas: HTMLCanvasElement): ImageData | null {
  const w = video.videoWidth;
  const h = video.videoHeight;
  if (!w || !h) return null;
  const sw = Math.round(w * 0.9);
  const sh = Math.round(h * 0.35);
  const sx = Math.round((w - sw) / 2);
  const sy = Math.round((h - sh) / 2);
  try {
    if (canvas.width !== sw) canvas.width = sw;
    if (canvas.height !== sh) canvas.height = sh;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(video, sx, sy, sw, sh, 0, 0, sw, sh);
    return ctx.getImageData(0, 0, sw, sh);
  } catch {
    return null;
  }
}
