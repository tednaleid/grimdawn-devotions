// ABOUTME: The Cloudflare worker's base URL, substituted at build time by web/scripts/bundle.ts.
// ABOUTME: Unbundled runs (tests) fall back to `just worker-dev`'s local address.
declare const __IMPORT_API__: string;

export const workerApi = typeof __IMPORT_API__ === "string" ? __IMPORT_API__ : "http://localhost:8787";
