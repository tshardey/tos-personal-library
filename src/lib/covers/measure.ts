export interface ImageSize {
  width: number;
  height: number;
}

/** Null on error or timeout. */
export type MeasureImage = (url: string) => Promise<ImageSize | null>;

const MEASURE_TIMEOUT_MS = 8000;

/** Loads the image to read its natural size. Never throws. */
export const browserMeasure: MeasureImage = (url) =>
  new Promise((resolve) => {
    let done = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = (size: ImageSize | null) => {
      if (done) return;
      done = true;
      if (timer !== undefined) clearTimeout(timer);
      resolve(size);
    };
    try {
      const img = new Image();
      img.onload = () => finish({ width: img.naturalWidth, height: img.naturalHeight });
      img.onerror = () => finish(null);
      timer = setTimeout(() => finish(null), MEASURE_TIMEOUT_MS);
      img.src = url;
    } catch {
      finish(null);
    }
  });

export const MIN_SHORT_EDGE = 250;
export const MIN_RATIO = 1.15;
export const MAX_RATIO = 1.9;

export function sizeOk(s: ImageSize): boolean {
  if (s.width <= 0 || s.height <= 0) return false;
  if (Math.min(s.width, s.height) < MIN_SHORT_EDGE) return false;
  const ratio = s.height / s.width;
  return ratio >= MIN_RATIO && ratio <= MAX_RATIO;
}
