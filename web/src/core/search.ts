// ABOUTME: Pure text-search corpus and matcher for the devotion map.
// ABOUTME: Builds language-independent Text recipes; an adapter resolves them (core never resolves).
import type { DevotionModel, StarId } from "./types";
import { appT, gameT, joinT, type Text } from "./localization";
import { condensedRows, formatPowerStats } from "./statFormat";

export interface SearchCorpus {
  constellations: Map<string, Text[]>;
  stars: Map<StarId, Text[]>;
}

export interface SearchIndex {
  constellations: Map<string, string>;
  stars: Map<StarId, string>;
}

export interface SearchMatch {
  constellations: Set<string>;
  stars: Set<StarId>;
}

/**
 * Fold text for comparison: lowercase, then drop combining marks so "degats" finds
 * "dégâts". Applied to BOTH corpus and query, so neither side is more lenient.
 */
export function normalize(s: string): string {
  return s.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "");
}

/**
 * Every searchable Text per constellation and per star. Constellation-level text
 * (name, flavour) is kept separate from star-level text (stats, power, weapon
 * requirement) because the two highlight at different granularities: a constellation
 * hit glows the art, a star hit glows the star, and neither implies the other.
 *
 * Values are deliberately not indexed - searching "15" matches noise, not intent.
 */
export function searchCorpus(model: DevotionModel): SearchCorpus {
  const constellations = new Map<string, Text[]>();
  for (const c of model.constellations.values()) {
    const parts: Text[] = [gameT(c.nameTag)];
    if (c.descriptionTag) parts.push(gameT(c.descriptionTag));
    constellations.set(c.id, parts);
  }

  const stars = new Map<StarId, Text[]>();
  for (const s of model.stars.values()) {
    const parts: Text[] = [];
    const opts = s.racialTarget ? { racialTarget: s.racialTarget } : {};
    for (const g of condensedRows(s.bonuses, opts)) for (const sub of g.subjects) parts.push(sub.subject);
    // Pet rows render as bare stat nouns ("Fire Damage"); "Bonus to All Pets" is only a
    // section header. Fold it in so typing "pet" finds them, in every language.
    if (s.petBonuses)
      for (const g of condensedRows(s.petBonuses))
        for (const sub of g.subjects) parts.push(joinT(appT("ui.panel.petBonus"), " ", sub.subject));
    const p = s.celestialPower;
    if (p) {
      parts.push(gameT(p.nameTag));
      if (p.descriptionTag) parts.push(gameT(p.descriptionTag));
      const rows = formatPowerStats(p.stats);
      for (const r of [...rows.rows, ...rows.fallthrough]) parts.push(r.label);
    }
    if (s.weaponRequirement?.descriptionTag) parts.push(gameT(s.weaponRequirement.descriptionTag));
    stars.set(s.id, parts);
  }

  return { constellations, stars };
}

/**
 * Case- and diacritic-insensitive substring match with terms ANDed, so a second word
 * narrows rather than widens. An empty query matches nothing (not everything): with no
 * query there is nothing to emphasize.
 */
export function matchQuery(index: SearchIndex, query: string): SearchMatch {
  const terms = normalize(query).split(/\s+/).filter(Boolean);
  const empty: SearchMatch = { constellations: new Set(), stars: new Set() };
  if (terms.length === 0) return empty;
  const hit = (text: string) => terms.every((t) => text.includes(t));
  const constellations = new Set<string>();
  for (const [id, text] of index.constellations) if (hit(text)) constellations.add(id);
  const stars = new Set<StarId>();
  for (const [id, text] of index.stars) if (hit(text)) stars.add(id);
  return { constellations, stars };
}
