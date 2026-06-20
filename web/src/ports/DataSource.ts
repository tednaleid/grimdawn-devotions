// ABOUTME: Port interfaces for data loading in the devotion planner.
// ABOUTME: Defines AssetManifest, LoadedData, and the DataSource contract for adapters.
import type { DevotionModel } from "../core/types";

export interface AssetManifest {
  // maps a constellation background image name (basename) -> resolved asset URL
  images: Record<string, string>;
}

export interface LoadedData {
  model: DevotionModel;
  label: (statId: string) => string;
  manifest: AssetManifest | null;
}

export interface DataSource {
  load(): Promise<LoadedData>;
}
