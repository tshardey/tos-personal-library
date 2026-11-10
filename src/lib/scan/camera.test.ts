import { describe, expect, it, vi } from "vitest";
import { CAMERA_CONSTRAINTS, CameraError, grabGuideFrame, startCamera } from "./camera";

function fakeTrack(caps: Record<string, unknown> | null = {}) {
  return {
    stop: vi.fn(),
    applyConstraints: vi.fn(async () => {}),
    getCapabilities: caps === null ? undefined : vi.fn(() => caps),
  };
}

function fakeStream(tracks = [fakeTrack()]) {
  return {
    getTracks: () => tracks,
    getVideoTracks: () => tracks,
  } as unknown as MediaStream;
}

function fakeVideo() {
  return {
    srcObject: null as MediaStream | null,
    playsInline: false,
    muted: false,
    autoplay: false,
    setAttribute: vi.fn(),
    play: vi.fn(async () => {}),
  };
}

const named = (name: string) => Object.assign(new Error(name), { name });

function md(getUserMedia: (c: MediaStreamConstraints) => Promise<MediaStream>) {
  return { getUserMedia: vi.fn(getUserMedia) } as unknown as MediaDevices & {
    getUserMedia: ReturnType<typeof vi.fn>;
  };
}

describe("startCamera (D11)", () => {
  it("asks for D11's constraints and wires the video for iOS", async () => {
    expect(CAMERA_CONSTRAINTS).toEqual({
      audio: false,
      video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } },
    });
    const stream = fakeStream();
    const devices = md(async () => stream);
    const video = fakeVideo();
    await startCamera(video as unknown as HTMLVideoElement, devices);
    expect(devices.getUserMedia).toHaveBeenCalledWith(CAMERA_CONSTRAINTS);
    expect(video.srcObject).toBe(stream);
    expect(video.playsInline && video.muted && video.autoplay).toBe(true);
    expect(video.setAttribute).toHaveBeenCalledWith("playsinline", "");
    expect(video.play).toHaveBeenCalled();
  });

  it("retries once with { video: true } after OverconstrainedError", async () => {
    const stream = fakeStream();
    const devices = md(async (c) => {
      if (c !== CAMERA_CONSTRAINTS) return stream;
      throw named("OverconstrainedError");
    });
    await startCamera(fakeVideo() as unknown as HTMLVideoElement, devices);
    expect(devices.getUserMedia).toHaveBeenCalledTimes(2);
    expect(devices.getUserMedia).toHaveBeenLastCalledWith({ video: true });
  });

  it.each([
    ["NotAllowedError", "denied"],
    ["SecurityError", "denied"],
    ["NotFoundError", "no_camera"],
    ["NotReadableError", "busy"],
    ["TypeError", "unknown"],
  ])("maps %s to %s", async (name, code) => {
    const devices = md(async () => {
      throw named(name);
    });
    const err = await startCamera(fakeVideo() as unknown as HTMLVideoElement, devices).catch((e) => e);
    expect(err).toBeInstanceOf(CameraError);
    expect((err as CameraError).code).toBe(code);
  });

  it("is unsupported without mediaDevices", async () => {
    const err = await startCamera(fakeVideo() as unknown as HTMLVideoElement, undefined).catch((e) => e);
    expect((err as CameraError).code).toBe("unsupported");
  });

  it("follows the torch capability and toggles it", async () => {
    const track = fakeTrack({ torch: true });
    const cam = await startCamera(fakeVideo() as unknown as HTMLVideoElement, md(async () => fakeStream([track])));
    expect(cam.torchSupported).toBe(true);
    await cam.setTorch(true);
    expect(track.applyConstraints).toHaveBeenCalledWith({ advanced: [{ torch: true }] });

    for (const caps of [{}, null]) {
      const t = fakeTrack(caps);
      const c = await startCamera(fakeVideo() as unknown as HTMLVideoElement, md(async () => fakeStream([t])));
      expect(c.torchSupported).toBe(false);
    }
  });

  it("stops every track", async () => {
    const tracks = [fakeTrack(), fakeTrack()];
    const video = fakeVideo();
    const cam = await startCamera(video as unknown as HTMLVideoElement, md(async () => fakeStream(tracks)));
    cam.stop();
    expect(tracks.every((t) => t.stop.mock.calls.length === 1)).toBe(true);
    expect(video.srcObject).toBeNull();
  });
});

describe("grabGuideFrame", () => {
  it("reads the center 90% × 35% band at native resolution", () => {
    const image = { width: 1728, height: 378 } as ImageData;
    const ctx = { drawImage: vi.fn(), getImageData: vi.fn(() => image) };
    const canvas = { width: 0, height: 0, getContext: vi.fn(() => ctx) };
    const video = { videoWidth: 1920, videoHeight: 1080 };
    const out = grabGuideFrame(video as HTMLVideoElement, canvas as unknown as HTMLCanvasElement);
    expect(out).toBe(image);
    expect(canvas.getContext).toHaveBeenCalledWith("2d", { willReadFrequently: true });
    expect(ctx.drawImage).toHaveBeenCalledWith(video, 96, 351, 1728, 378, 0, 0, 1728, 378);
    expect(ctx.getImageData).toHaveBeenCalledWith(0, 0, 1728, 378);
    expect([canvas.width, canvas.height]).toEqual([1728, 378]);
  });

  it("is null before the video has a size", () => {
    const canvas = { width: 0, height: 0, getContext: vi.fn() };
    const video = { videoWidth: 0, videoHeight: 0 };
    expect(grabGuideFrame(video as HTMLVideoElement, canvas as unknown as HTMLCanvasElement)).toBeNull();
    expect(canvas.getContext).not.toHaveBeenCalled();
  });
});
