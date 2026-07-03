// ABOUTME: The benefit filter tag vocabulary as a discriminated union with one parse/format codec.
// ABOUTME: Canonical strings ("<id>", "pet:<id>", "aff:<dir>:<affinity>") are the wire/DOM/URL form.
import { AFFINITIES, type Affinity } from "./types";

export type BenefitTag =
  | { kind: "player"; statId: string }
  | { kind: "pet"; statId: string }
  | { kind: "affinity"; dir: "grant" | "req"; affinity: Affinity };

const isAffinity = (s: string): s is Affinity => (AFFINITIES as readonly string[]).includes(s);

/** The canonical string form of a tag (the shape stored in selectedBenefits, data-vid, and the URL bitset). */
export function formatTag(tag: BenefitTag): string {
  switch (tag.kind) {
    case "player":
      return tag.statId;
    case "pet":
      return `pet:${tag.statId}`;
    case "affinity":
      return `aff:${tag.dir}:${tag.affinity}`;
  }
}

/** Parse a canonical tag string. Bare ids are player tags, pet: anything is a pet tag; only a
 *  malformed aff:* form (unknown direction or affinity) returns null. */
export function parseTag(s: string): BenefitTag | null {
  if (s.startsWith("aff:")) {
    const rest = s.slice("aff:".length);
    const sep = rest.indexOf(":");
    if (sep < 0) return null;
    const dir = rest.slice(0, sep);
    const affinity = rest.slice(sep + 1);
    if (dir !== "grant" && dir !== "req") return null;
    if (!isAffinity(affinity)) return null;
    return { kind: "affinity", dir, affinity };
  }
  if (s.startsWith("pet:")) return { kind: "pet", statId: s.slice("pet:".length) };
  return { kind: "player", statId: s };
}

/** The pet-scoped tag id for a raw stat id. */
export function petTagId(statId: string): string {
  return formatTag({ kind: "pet", statId });
}

/** The affinity filter tag for a grant/require of one affinity, e.g. `aff:grant:eldritch`. */
export function affinityTagId(dir: "grant" | "req", a: Affinity): string {
  return formatTag({ kind: "affinity", dir, affinity: a });
}
