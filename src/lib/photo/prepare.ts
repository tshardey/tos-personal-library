export const MAX_EDGE = 1280;
export const MIN_SHORT_EDGE = 200;
export const JPEG_QUALITY = 0.85;
const RETRY_QUALITY = 0.7;
export const MAX_BYTES = 2 * 1024 * 1024;

export type PhotoErrorCode = "unreadable" | "too_small" | "too_large";

export class PhotoError extends Error {
  code: PhotoErrorCode;
  constructor(code: PhotoErrorCode) {
    super(code);
    this.name = "PhotoError";
    this.code = code;
  }
}

/** Scales so the long edge is at most `max`; never upscales. */
export function fitWithin(w: number, h: number, max: number): { width: number; height: number } {
  const long = Math.max(w, h);
  if (long <= max) return { width: w, height: h };
  const scale = max / long;
  return { width: Math.round(w * scale), height: Math.round(h * scale) };
}

export interface DecodedImage {
  width: number;
  height: number;
  close(): void;
}

export interface ImageDeps {
  decode(file: Blob): Promise<DecodedImage>;
  encode(bitmap: DecodedImage, width: number, height: number, quality: number): Promise<Blob>;
  sha256Hex(bytes: ArrayBuffer): Promise<string>;
}

export const browserImageDeps: ImageDeps = {
  decode: (file) => createImageBitmap(file, { imageOrientation: "from-image" }),
  async encode(bitmap, width, height, quality) {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("canvas unavailable");
    ctx.drawImage(bitmap as unknown as ImageBitmap, 0, 0, width, height);
    return new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("encode failed"))), "image/jpeg", quality),
    );
  },
  async sha256Hex(bytes) {
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
  },
};

function readBytes(file: Blob): Promise<ArrayBuffer> {
  if (typeof file.arrayBuffer === "function") return file.arrayBuffer();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(file);
  });
}

/** Resizes to JPEG for upload. The hash is of the original bytes, so it is stable across re-picks. */
export async function preparePhoto(
  file: File,
  deps: ImageDeps = browserImageDeps,
): Promise<{ blob: Blob; sourceHash: string }> {
  let bitmap: DecodedImage;
  try {
    bitmap = await deps.decode(file);
  } catch {
    throw new PhotoError("unreadable");
  }
  try {
    if (Math.min(bitmap.width, bitmap.height) < MIN_SHORT_EDGE) throw new PhotoError("too_small");
    const sourceHash = await deps.sha256Hex(await readBytes(file));
    const { width, height } = fitWithin(bitmap.width, bitmap.height, MAX_EDGE);
    let blob = await deps.encode(bitmap, width, height, JPEG_QUALITY);
    if (blob.size > MAX_BYTES) {
      blob = await deps.encode(bitmap, width, height, RETRY_QUALITY);
      if (blob.size > MAX_BYTES) throw new PhotoError("too_large");
    }
    return { blob, sourceHash };
  } finally {
    bitmap.close();
  }
}
