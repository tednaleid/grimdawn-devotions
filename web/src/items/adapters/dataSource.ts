// ABOUTME: Fetches the skill-items catalogue and the stat-to-tag map for the /items/ page.
// ABOUTME: The only IO in the page; core stays pure and testable without a server.
import { withVersion } from "../../adapters/assetVersion";
import { parseCatalogue, type Catalogue } from "../core/model";

/** Load and parse data/skill-items.json relative to `base` (default the parent dir).
 *  This is the page's one big fetch (3.1 MB): call it once at boot and keep the parsed
 *  Catalogue around, never re-fetch or re-parse per facet change. */
export async function loadCatalogue(base = ".."): Promise<Catalogue> {
  const res = await fetch(withVersion(`${base}/data/skill-items.json`));
  if (!res.ok) throw new Error(`skill-items.json: ${res.status}`);
  return parseCatalogue(await res.json());
}

/** Load data/stat-item-tags.json: the stat id -> game tag map effectLines needs to turn a
 *  modifier block's raw stats into card text (see core/effectText.ts's EffectContext). */
export async function loadStatTags(base = ".."): Promise<Record<string, string>> {
  const res = await fetch(withVersion(`${base}/data/stat-item-tags.json`));
  if (!res.ok) throw new Error(`stat-item-tags.json: ${res.status}`);
  return (await res.json()) as Record<string, string>;
}

/** The skill-icons sprite sheet index: which (col, row) 32px cell of data/skill-icons.png holds
 *  a given skill's icon (see scripts/build_skill_icons.py). */
export interface SkillIconIndex {
  cell: number;
  columns: number;
  icons: Record<string, [number, number]>;
}

/** Load data/skill-icons.json, the index treeView.ts's SVG tree needs to place each skill's icon
 *  from the sprite sheet. */
export async function loadSkillIcons(base = ".."): Promise<SkillIconIndex> {
  const res = await fetch(withVersion(`${base}/data/skill-icons.json`));
  if (!res.ok) throw new Error(`skill-icons.json: ${res.status}`);
  return (await res.json()) as SkillIconIndex;
}
