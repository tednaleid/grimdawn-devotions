// ABOUTME: GrimtoolsGateway over our Cloudflare Worker: the only code that knows its URL, routes,
// ABOUTME: contract-version query params and JSON shapes. Maps every HTTP outcome to the port's unions.
import { EXPORT_CONTRACT_VERSION, IMPORT_CONTRACT_VERSION, isSlug } from "../core/grimtools";
import type { ExportBase, FetchBuildResult, GrimtoolsGateway, SaveBuildResult } from "../ports/GrimtoolsGateway";

/**
 * `baseUrl` is the worker's origin with no trailing slash. `fetchImpl` is for tests; the default
 * wraps the global so the call keeps its window binding.
 */
export function makeWorkerGateway(
  baseUrl: string,
  fetchImpl: typeof fetch = ((input: string | URL | Request, init?: RequestInit) =>
    fetch(input, init)) as unknown as typeof fetch,
): GrimtoolsGateway {
  return {
    async fetchBuild(slug: string): Promise<FetchBuildResult> {
      // `v=${IMPORT_CONTRACT_VERSION}` busts only the *browser's* cache for this URL, and only when
      // the worker's response contract actually changes (unlike buildId, which changes on every
      // deploy - see grimtools.ts for why a shared constant is used instead). The worker
      // deliberately ignores this param when building its own edge-cache key, using the same
      // constant on its own side instead - a caller-supplied value there would let anyone inflate
      // the worker's keyspace.
      let res: Response;
      try {
        res = await fetchImpl(`${baseUrl}/?slug=${encodeURIComponent(slug)}&v=${IMPORT_CONTRACT_VERSION}`);
      } catch {
        return { kind: "network" };
      }
      if (res.status === 404) return { kind: "notFound" };
      if (!res.ok) return { kind: "network" };
      let body: { skills?: unknown; dataVersion?: unknown; title?: unknown };
      try {
        body = (await res.json()) as typeof body;
      } catch {
        return { kind: "network" };
      }
      // Tolerant on purpose: a response served from the worker's 24h edge cache can predate a
      // field entirely, and a bundle can be talking to a worker one deploy ahead of it.
      const skills = Array.isArray(body.skills) ? body.skills.filter((s): s is string => typeof s === "string") : [];
      const dataVersion = typeof body.dataVersion === "string" ? body.dataVersion : null;
      const title = typeof body.title === "string" ? body.title : null;
      return { kind: "ok", skills, dataVersion, title };
    },

    async saveBuild(skills: string[], base?: ExportBase): Promise<SaveBuildResult> {
      let res: Response;
      try {
        res = await fetchImpl(`${baseUrl}/export?v=${EXPORT_CONTRACT_VERSION}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(base ? { skills, base } : { skills }),
        });
      } catch {
        return { kind: "network" };
      }
      if (res.status === 429) return { kind: "rateLimited" };
      if (res.status === 502) return { kind: "upstream" };
      if (res.status !== 201) return { kind: "network" };
      let slug: unknown;
      try {
        slug = ((await res.json()) as { slug?: unknown }).slug;
      } catch {
        return { kind: "network" };
      }
      // The worker already validated it; check again here because this string becomes an href.
      if (typeof slug !== "string" || !isSlug(slug)) return { kind: "network" };
      return { kind: "ok", slug };
    },
  };
}
