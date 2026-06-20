// ABOUTME: HTTP adapter for the DataSource port; fetches devotions.json, stat_labels.json, and manifest.json.
// ABOUTME: Uses relative base paths so the site works correctly under a GitHub Pages subpath.
import { buildModel, type DevotionsDoc } from "../core/model";
import { makeLabeler } from "../core/labels";
import type { AssetManifest, DataSource, LoadedData } from "../ports/DataSource";

async function getJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export function httpDataSource(base = "."): DataSource {
  return {
    async load(): Promise<LoadedData> {
      const doc = await getJson<DevotionsDoc>(`${base}/data/devotions.json`);
      if (!doc) throw new Error("failed to load data/devotions.json");
      const labels = (await getJson<Record<string, string>>(`${base}/data/stat_labels.json`)) ?? {};
      const manifest = await getJson<AssetManifest>(`${base}/assets/devotions/manifest.json`);
      return { model: buildModel(doc), label: makeLabeler(labels), manifest };
    },
  };
}
