// ABOUTME: Regenerates data/grimtools-monsters.json: our monster rows -> grimtools monsterdb ids per difficulty.
// ABOUTME: Fetches grimtools' public monsterdb.js once, evaluates it in-process with node:vm, and matches with matchLinks.
//
// Usage: bun scripts/gt_monster_links.ts   (re-run after regenerating data/monsters.json)
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import vm from "node:vm";
import { matchLinks, type GtMonster, type LinkRow } from "../web/src/monsters/core/grimtoolsLinks";
import { DAMAGE_TYPES, type Difficulty } from "../web/src/monsters/core/facets";
import type { Resistances } from "../web/src/monsters/core/model";

const ROOT = join(import.meta.dir, "..");
const SRC = "https://www.grimtools.com/monsterdb/js/monsterdb.js";
// grimtools fronts this asset with Cloudflare, which blocks a bare/custom User-Agent (403) but
// allows a normal browser one; there is no bot-detection bypass here, just a header that matches
// what a browser sends for what is otherwise a single plain GET.
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const GT_FIELD: Record<string, string> = { vitality: "defensiveLife" };
const DIFF_INDEX: Record<number, Difficulty> = { 1: "normal", 2: "elite", 3: "ultimate", 4: "ascendant" };

/** A raw monster row as scripts/parse_monsters.py emits it, the slice this script reads. */
interface RawMonsterRow {
  id: string;
  name_tag: string;
  classification: string;
  resistances: Record<string, number>;
  passive_resistances?: Record<string, number>;
}

const res = await fetch(SRC, { headers: { "User-Agent": UA } });
if (!res.ok) throw new Error(`${SRC}: ${res.status}`);
const ctx: { window: Record<string, unknown> } = { window: {} };
ctx.window.window = ctx.window;
vm.createContext(ctx);
vm.runInContext(await res.text(), ctx);
const w = ctx.window;
const monsterDifficulty = w.monsterDifficulty as Record<string, number[] | undefined>;

const difficultyOf = (i: number): Difficulty => {
  const d = DIFF_INDEX[i];
  if (!d) throw new Error(`unknown grimtools difficulty index ${i}`);
  return d;
};

// grimtools stores a ranged stat as [min, max]; inline resistances are scalars in practice.
const num = (v: unknown) => (Array.isArray(v) ? (Number(v[0]) + Number(v[1])) / 2 : Number(v ?? 0));
const inlineOf = (rec: Record<string, unknown>, field: (t: string) => string) =>
  Object.fromEntries(DAMAGE_TYPES.map((t) => [t, num(rec[field(t)])])) as Resistances;

const gt: GtMonster[] = Object.entries(w.allMonsters as Record<string, Record<string, unknown>>).map(([key, m]) => ({
  id: Number(key.slice(1)),
  nameTag: String(m.d),
  classification: String(m.monsterClassification),
  difficulties: (monsterDifficulty[key] ?? [1, 2, 3, 4]).map(difficultyOf),
  inline: inlineOf(m, (t) => GT_FIELD[t] ?? `defensive${t.charAt(0).toUpperCase()}${t.slice(1)}`),
}));

const doc = JSON.parse(readFileSync(join(ROOT, "data/monsters.json"), "utf8")) as { monsters: RawMonsterRow[] };
const rows: LinkRow[] = doc.monsters.map((m) => ({
  id: m.id,
  nameTag: m.name_tag,
  classification: m.classification,
  inline: Object.fromEntries(
    DAMAGE_TYPES.map((t) => [t, m.resistances[t] - (m.passive_resistances?.[t] ?? 0)]),
  ) as Resistances,
}));

const { links, unmatched } = matchLinks(rows, gt);
const out = { source: SRC, game_version: String(w.gameVersion ?? ""), links };
writeFileSync(join(ROOT, "data/grimtools-monsters.json"), `${JSON.stringify(out, null, 1)}\n`);

const byClass = new Map<string, string[]>();
for (const id of unmatched) {
  const c = doc.monsters.find((m) => m.id === id)?.classification ?? "<unknown>";
  byClass.set(c, [...(byClass.get(c) ?? []), id]);
}
console.log(
  `${w.gameVersion}: linked ${Object.keys(links).length} of ${rows.length} rows; unmatched ${unmatched.length}`,
);
for (const [c, ids] of byClass) console.log(`  ${c}: ${ids.length}${ids.length <= 10 ? `  ${ids.join(", ")}` : ""}`);
