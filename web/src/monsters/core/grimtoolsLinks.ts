// ABOUTME: Matches our monster rows to grimtools monsterdb ids, one per difficulty.
// ABOUTME: Pure: scripts/gt_monster_links.ts supplies grimtools' data and writes the table.
import { DAMAGE_TYPES, DIFFICULTIES, type Difficulty } from "./facets";
import type { Resistances } from "./model";

export interface GtMonster {
  id: number;
  nameTag: string;
  classification: string;
  difficulties: Difficulty[];
  inline: Resistances;
}

export interface LinkRow {
  id: string;
  nameTag: string;
  classification: string;
  /** The row's own record values: resistances minus passive grants. */
  inline: Resistances;
}

export type LinkTable = Record<string, Partial<Record<Difficulty, number>>>;

const sameInline = (a: Resistances, b: Resistances) => DAMAGE_TYPES.every((t) => a[t] === b[t]);

/** For each row and difficulty, the grimtools entry sharing name tag and classification
 *  that exists in that difficulty; among several, the one whose inline values equal the
 *  row's, then the lowest id. */
export function matchLinks(rows: LinkRow[], gt: GtMonster[]): { links: LinkTable; unmatched: string[] } {
  const byKey = new Map<string, GtMonster[]>();
  for (const g of gt) {
    const key = `${g.nameTag}|${g.classification}`;
    byKey.set(key, [...(byKey.get(key) ?? []), g]);
  }
  const links: LinkTable = {};
  const unmatched: string[] = [];
  for (const r of rows) {
    const candidates = byKey.get(`${r.nameTag}|${r.classification}`) ?? [];
    const perDiff: Partial<Record<Difficulty, number>> = {};
    for (const d of DIFFICULTIES) {
      const inDiff = candidates.filter((g) => g.difficulties.includes(d)).sort((a, b) => a.id - b.id);
      const pick = inDiff.find((g) => sameInline(g.inline, r.inline)) ?? inDiff[0];
      if (pick) perDiff[d] = pick.id;
    }
    if (Object.keys(perDiff).length) links[r.id] = perDiff;
    else unmatched.push(r.id);
  }
  return { links, unmatched };
}

export function grimtoolsMonsterUrl(id: number): string {
  return `https://www.grimtools.com/monsterdb/${id}`;
}
