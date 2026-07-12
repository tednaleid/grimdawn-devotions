// ABOUTME: HTTP adapter for the DataSource port; fetches devotions.json, the asset manifest, and the cover blob.
// ABOUTME: Uses relative base paths and a shared ?v=<buildId> so the data files stay a coherent, cache-busted pair.
import { buildModel, type DevotionsDoc } from "../core/model";
import { buildReachCons, type CoverTable, type ReachCon } from "../core/reachability";
import { decodeCoverBlob } from "./coverTableBlob";
import type { AssetManifest, DataMeta, DataSource, LoadedData } from "../ports/DataSource";

declare const __BUILD_ID__: string;
const buildId = typeof __BUILD_ID__ === "string" ? __BUILD_ID__ : "dev";

async function getJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

/** The dataset provenance for the info popover; missing fields become empty strings (degrade, never throw). */
export function metaFromDoc(doc: DevotionsDoc): DataMeta {
  return { gameVersion: doc.meta?.game_version ?? "", generatedUtc: doc.meta?.generated_utc ?? "" };
}

/** Decode blob bytes into a CoverTable, or null on any malformed/mismatched input (degrade to no dimming). */
export function coverTableFromBytesOrNull(bytes: Uint8Array, cons: ReachCon[]): CoverTable | null {
  try {
    const { table, buildId: blobId } = decodeCoverBlob(bytes, cons);
    if (buildId !== "dev" && blobId !== buildId) {
      console.warn(`cover blob buildId ${blobId} != bundle ${buildId}; disabling dimming`);
      return null;
    }
    return table;
  } catch (e) {
    console.warn("cover blob decode failed; disabling dimming", e);
    return null;
  }
}

export function httpDataSource(base = "."): DataSource {
  return {
    async load(): Promise<LoadedData> {
      const v = `?v=${buildId}`;
      const doc = await getJson<DevotionsDoc>(`${base}/data/devotions.json${v}`);
      if (!doc) throw new Error("failed to load data/devotions.json");
      const manifest = await getJson<AssetManifest>(`${base}/assets/devotions/manifest.json`);
      const model = buildModel(doc);
      let coverTable: CoverTable | null = null;
      try {
        const res = await fetch(`${base}/data/cover-table.bin${v}`);
        if (res.ok)
          coverTable = coverTableFromBytesOrNull(new Uint8Array(await res.arrayBuffer()), buildReachCons(model));
        else console.warn(`cover blob fetch ${res.status}; disabling dimming`);
      } catch (e) {
        console.warn("cover blob fetch failed; disabling dimming", e);
      }
      let reachWasm: Uint8Array | null = null;
      try {
        const res = await fetch(`${base}/data/reach.wasm${v}`);
        if (res.ok) reachWasm = new Uint8Array(await res.arrayBuffer()); // absent -> TS resolver
      } catch (e) {
        console.warn("reach.wasm fetch failed; using the TS resolver", e);
      }
      return { model, manifest, coverTable, reachWasm, meta: metaFromDoc(doc) };
    },
  };
}
