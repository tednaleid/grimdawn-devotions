// ABOUTME: Port interfaces for data loading in the devotion planner.
// ABOUTME: Defines AssetManifest, LoadedData, and the DataSource contract for adapters.
import type { DevotionModel } from "../core/types";

export interface AssetImage {
  url: string;
  // native texture size; the art <image> is rendered at this size so it aligns
  // with star positions regardless of how much the file was downscaled.
  w: number;
  h: number;
}

export interface AssetManifest {
  // maps a constellation background image name (basename) -> resolved asset
  images: Record<string, AssetImage>;
}

export interface LoadedData {
  model: DevotionModel;
  label: (statId: string) => string;
  manifest: AssetManifest | null;
}

export interface DataSource {
  load(): Promise<LoadedData>;
}
