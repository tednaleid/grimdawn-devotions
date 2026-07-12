// ABOUTME: Port interfaces for data loading in the devotion planner.
// ABOUTME: Defines AssetManifest, LoadedData, and the DataSource contract for adapters.
import type { DevotionModel } from "../core/types";
import type { CoverTable } from "../core/reachability";

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

/** Dataset provenance stamped by the parser; empty strings when the dataset carries no meta. */
export interface DataMeta {
  gameVersion: string; // e.g. "1.2.1.x"
  generatedUtc: string; // ISO extraction timestamp, e.g. "2026-07-01T05:46:25Z"
  steamBuildid: string; // Steam build id captured from the app manifest at parse time; empty when absent
}

export interface LoadedData {
  model: DevotionModel;
  manifest: AssetManifest | null;
  coverTable: CoverTable | null;
  reachWasm: Uint8Array | null; // raw reach.wasm bytes, or null (engine falls back to the TS resolver)
  meta: DataMeta;
}

export interface DataSource {
  load(): Promise<LoadedData>;
}
