export type CoverSize = "1" | "2" | "3" | "4" | "5";

export const COVER_SIZES: readonly CoverSize[] = ["1", "2", "3", "4", "5"];

export const DEFAULT_COVER_SIZE: CoverSize = "4";

/** D4: phone columns, min card width from 640px, grid gap, and whether title/author show. */
export const COVER_STEPS: Record<CoverSize, { phoneCols: number; minPx: number; gapPx: number; showText: boolean }> = {
  "1": { phoneCols: 5, minPx: 64, gapPx: 8, showText: false },
  "2": { phoneCols: 4, minPx: 88, gapPx: 8, showText: true },
  "3": { phoneCols: 3, minPx: 120, gapPx: 12, showText: true },
  "4": { phoneCols: 2, minPx: 170, gapPx: 12, showText: true },
  "5": { phoneCols: 1, minPx: 240, gapPx: 16, showText: true },
};
