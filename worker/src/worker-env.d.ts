// ABOUTME: Ambient type augmentation for the Cloudflare Workers Cache API.
// ABOUTME: The Workers runtime adds a `default` cache to CacheStorage; lib.dom.d.ts does not know it.
export {};

declare global {
  interface CacheStorage {
    /** The Workers runtime's shared edge cache, keyed by request. */
    default: Cache;
  }
}
