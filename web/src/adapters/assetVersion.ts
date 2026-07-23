// ABOUTME: The build-stamped content version for runtime-fetched assets, and a ?v= URL tagger.
// ABOUTME: A deploy that changes any data/i18n file changes this token, so returning visitors never
// ABOUTME: serve a stale cached catalog: the fetch URL differs, misses cache, and pulls the new file.
// __ASSET_V__ is injected by scripts/bundle.ts (a hash over the deployed JSON); "dev" in tests/unbundled.
declare const __ASSET_V__: string;

export const assetVersion = typeof __ASSET_V__ === "string" ? __ASSET_V__ : "dev";

/** Append the asset version as a cache-busting query param, preserving any existing query. */
export function withVersion(url: string): string {
  return `${url}${url.includes("?") ? "&" : "?"}v=${assetVersion}`;
}
