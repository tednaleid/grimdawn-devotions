// ABOUTME: Fetches the committed monsters dataset and parses it into Monster rows.
// ABOUTME: The only I/O for monster data; base points at the dir holding data/ ("..").
import { parseMonsters, type MonsterDoc } from "../core/model";
import { withVersion } from "../../adapters/assetVersion";

/** Load and parse data/monsters.json relative to `base` (default the parent dir). */
export async function loadMonsters(base = ".."): Promise<MonsterDoc> {
  const res = await fetch(withVersion(`${base}/data/monsters.json`));
  if (!res.ok) throw new Error(`monsters dataset fetch failed: ${res.status}`);
  return parseMonsters(await res.json());
}
