// ABOUTME: Fetches the committed monsters dataset and parses it into Monster rows.
// ABOUTME: Also loads the grimtools link table; base points at the dir holding data/ ("..").
import { parseMonsters, type MonsterDoc } from "../core/model";
import type { LinkTable } from "../core/grimtoolsLinks";
import { withVersion } from "../../adapters/assetVersion";

/** Load and parse data/monsters.json relative to `base` (default the parent dir). */
export async function loadMonsters(base = ".."): Promise<MonsterDoc> {
  const res = await fetch(withVersion(`${base}/data/monsters.json`));
  if (!res.ok) throw new Error(`monsters dataset fetch failed: ${res.status}`);
  return parseMonsters(await res.json());
}

/** grimtools monsterdb ids per row and difficulty; empty when the file is missing or unreadable,
 *  so a deploy without it still renders every row, unlinked. */
export async function loadGrimtoolsLinks(base = ".."): Promise<LinkTable> {
  try {
    const res = await fetch(withVersion(`${base}/data/grimtools-monsters.json`));
    if (!res.ok) return {};
    const doc = (await res.json()) as { links?: LinkTable };
    return doc.links ?? {};
  } catch {
    return {};
  }
}
