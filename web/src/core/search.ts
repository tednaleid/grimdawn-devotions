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

/**
 * Fold like `normalize`, but keep a map from each folded character back to the offset of the
 * original character it came from, plus a trailing sentinel at `text.length`.
 *
 * Folding is not length-preserving: NFD splits an accented character in two before the mark is
 * dropped, and some characters lowercase to several. So an index into the folded string is not an
 * index into the text we render, and highlighting needs the round trip.
 *
 * The per-character loop must produce exactly what `normalize` produces for the whole string, or a
 * highlight lands on the wrong characters; `search.test.ts` pins that agreement.
 */
function foldWithMap(text: string): { folded: string; map: number[] } {
  let folded = "";
  const map: number[] = [];
  let at = 0;
  // Iterate code points, not UTF-16 units, so a surrogate pair is folded as one character.
  for (const ch of text) {
    const f = ch.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "");
    for (let k = 0; k < f.length; k++) {
      folded += f[k];
      map.push(at);
    }
    at += ch.length;
  }
  map.push(text.length); // so a match ending at the last character can address its end
  return { folded, map };
}

/**
 * Where each query term occurs in `text`, as `[start, end)` ranges into the ORIGINAL string,
 * sorted and with overlaps merged. Terms are the same whitespace-split, folded terms `matchQuery`
 * uses, so anything that made a star or constellation match can be shown to the reader.
 *
 * Pure: returns ranges, never markup. Escaping and tag choice belong to the adapter that renders.
 */
export function matchRanges(text: string, query: string): [number, number][] {
  const terms = normalize(query).split(/\s+/).filter(Boolean);
  if (terms.length === 0) return [];
  const { folded, map } = foldWithMap(text);
  const found: [number, number][] = [];
  for (const term of terms) {
    for (let from = 0; ; ) {
      const i = folded.indexOf(term, from);
      if (i < 0) break;
      const start = map[i];
      const end = map[i + term.length];
      if (start !== undefined && end !== undefined && end > start) found.push([start, end]);
      from = i + term.length;
    }
  }
  found.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const merged: [number, number][] = [];
  for (const r of found) {
    const last = merged[merged.length - 1];
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
    else merged.push([r[0], r[1]]);
  }
  return merged;
}
