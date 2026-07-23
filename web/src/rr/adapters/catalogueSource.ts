// ABOUTME: Fetches the committed RR catalogue JSON and parses it into RrSource rows.
// ABOUTME: The only I/O for RR data; base points at the dir holding data/ (".." from the subfolder page).
import { parseCatalogue, type RrSource } from "../core/model";

/** Load and parse data/resistance-reduction.json relative to `base` (default the parent dir).
 *  Returns both the sources and the catalogue meta (game version/build) for the About panel. */
export async function loadCatalogue(base = ".."): Promise<{ sources: RrSource[]; meta: Record<string, unknown> }> {
  const res = await fetch(`${base}/data/resistance-reduction.json`);
  if (!res.ok) throw new Error(`RR catalogue fetch failed: ${res.status}`);
  const { sources, meta } = parseCatalogue(await res.json());
  return { sources, meta };
}
