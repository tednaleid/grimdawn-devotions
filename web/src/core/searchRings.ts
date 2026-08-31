// ABOUTME: Pure ring assignment for concurrent searches: which selected benefit tags ring stars,
// ABOUTME: in canonical order (so colors derive from URL state alone), and the per-star ring lists.
import type { StarId } from "./types";
import { parseTag } from "./benefitTag";

/**
 * The selected benefit tags that ring stars (player and pet tags; affinity tags filter
 * constellations instead), ordered by canonical bitset position - the same canonical list the
 * URL's `b=` bitset uses. This fixes a star's arc order and gives reconcileRingSlots a
 * deterministic seeding order on a fresh page load. Tags missing from the canonical list
 * (stale links) are dropped.
 */
export function benefitRingOrder(selected: Iterable<string>, benefitCanonical: readonly string[]): string[] {
  const pos = new Map<string, number>();
  benefitCanonical.forEach((id, i) => {
    pos.set(id, i);
  });
  return [...selected]
    .filter((k) => pos.has(k) && parseTag(k)?.kind !== "affinity")
    .sort((a, b) => pos.get(a)! - pos.get(b)!);
}

/**
 * Reassigns palette slots to the active tags while keeping every surviving tag's slot untouched,
 * so colors stay stable as tags toggle: removing a tag frees only its own slot, and a new tag
 * takes the least-used slot (lowest index on ties - so a freed color is reused before any
 * doubling, and beyond slotCount concurrent tags slots repeat). Seeding from an empty map (a
 * fresh page load) walks `active` in order, which callers pass canonically - a reloaded link may
 * therefore wear different hues than the session that made it, but never mid-session.
 */
export function reconcileRingSlots(
  current: ReadonlyMap<string, number>,
  active: readonly string[],
  slotCount: number,
): Map<string, number> {
  const out = new Map<string, number>();
  const usage = new Array<number>(slotCount).fill(0);
  for (const tag of active) {
    const slot = current.get(tag);
    if (slot !== undefined) {
      out.set(tag, slot);
      usage[slot % slotCount]!++;
    }
  }
  for (const tag of active) {
    if (out.has(tag)) continue;
    const slot = usage.indexOf(Math.min(...usage));
    out.set(tag, slot);
    usage[slot]!++;
  }
  // Entries in `active` order, so downstream iteration (a star's arc order) never depends on
  // toggle history - only slot numbers carry the stability.
  return new Map(active.map((tag) => [tag, out.get(tag)!]));
}

/**
 * Folds one star set per search into a per-star list of ring values, preserving search order.
 * The ring value is opaque here (the adapter passes color+dash style records). A star matching
 * several searches lists every value; a star matching none is absent.
 */
export function ringMap<T>(searches: { ring: T; stars: ReadonlySet<StarId> }[]): Map<StarId, T[]> {
  const out = new Map<StarId, T[]>();
  for (const { ring, stars } of searches) {
    for (const id of stars) {
      const list = out.get(id);
      if (list) list.push(ring);
      else out.set(id, [ring]);
    }
  }
  return out;
}
