// ABOUTME: Encodes/decodes planner state (point cap, selected stars, selected benefit tags) to a compact URL hash.
// ABOUTME: Each selection is a trailing-trimmed bitset over a stable canonical id order, base64url-encoded.
import { AFFINITIES, type DevotionModel, type StarId } from "./types";
import { affinityTagId, petTagId } from "./benefitTag";
import { isFilterableStat } from "./statFormat";

const MIN_CAP = 1;
const MAX_CAP = 55;
const MAX_QUERY = 100; // a shared link carries a search box's worth of text, not a document

/** Every param decodeHash understands. Presence of any one makes a hash ours to decode. */
const KNOWN_PARAMS = ["p", "s", "b", "q", "cs", "cp", "gt"] as const;

/**
 * A point-cap param (`p=` live, `cp=` baseline). Absent, empty, or unparseable all mean the full
 * budget, since a link that does not carry a cap is not a link that asked for a small one; `"0"`
 * is the uncapped sentinel; anything else clamps into range.
 *
 * The absent case must be checked BEFORE parsing: `Number(null)` is `0`, which is finite, so it
 * slips past an isFinite guard and clamps to the 1-point minimum.
 */
function decodeCap(raw: string | null): number {
  if (raw === "0") return Infinity;
  if (raw === null || raw.trim() === "") return MAX_CAP;
  const n = Number(raw);
  if (!Number.isFinite(n)) return MAX_CAP;
  return Math.max(MIN_CAP, Math.min(MAX_CAP, Math.round(n)));
}

/**
 * The one normal form for a search query: trimmed and capped. Both hash directions apply it, and
 * so must any live in-memory copy, or what the user sees and what a copied link restores diverge.
 */
export function normalizeQuery(q: string): string {
  return q.trim().slice(0, MAX_QUERY);
}

/** Grimtools slug charset, duplicated from core/grimtools.ts deliberately: urlState stays dependency-free. */
const SLUG_RE = /^[A-Za-z0-9_-]{1,24}$/;

/**
 * The one normal form for a source slug: anything outside the charset becomes "".
 *
 * `gt=` is provenance only and is rendered as an outbound link, so a hand-edited hash must not be
 * able to put arbitrary text into that href.
 */
export function normalizeSource(s: string): string {
  const v = s.trim();
  return SLUG_RE.test(v) ? v : "";
}

/** Stable ordering of every star id: constellation insertion order, then star index. */
export function canonicalStarIds(model: DevotionModel): StarId[] {
  const out: StarId[] = [];
  for (const c of model.constellations.values()) for (const id of c.starIds) out.push(id);
  return out;
}

/** Stable ordering of every raw bonus stat id that appears anywhere in the model. */
export function canonicalStatIds(model: DevotionModel): string[] {
  const set = new Set<string>();
  for (const s of model.stars.values()) for (const k of Object.keys(s.bonuses)) set.add(k);
  return [...set].sort();
}

/** Stable ordering of every raw pet bonus stat id that appears anywhere in the model. */
export function canonicalPetStatIds(model: DevotionModel): string[] {
  const set = new Set<string>();
  for (const s of model.stars.values()) if (s.petBonuses) for (const k of Object.keys(s.petBonuses)) set.add(k);
  return [...set].sort();
}

/**
 * Recognized celestial-power stat ids that are NOT already player-bonus ids. These extend the benefit
 * vocabulary so powers' debuff/CC/RR subjects become filterable. "Other" (ability-meta) ids are excluded.
 */
export function canonicalPowerStatIds(model: DevotionModel): string[] {
  const bonus = new Set(canonicalStatIds(model));
  const set = new Set<string>();
  for (const s of model.stars.values()) {
    const p = s.celestialPower;
    if (!p) continue;
    for (const k of Object.keys(p.stats)) if (!bonus.has(k) && isFilterableStat(k)) set.add(k);
  }
  return [...set].sort();
}

/** The 10 affinity filter tags (each affinity x grant/require), in a stable order. */
function canonicalAffinityIds(): string[] {
  return AFFINITIES.flatMap((a) => [affinityTagId("grant", a), affinityTagId("req", a)]);
}

/**
 * The benefit-tag ordering for the URL bitset: the player stat ids (unchanged positions), then the
 * pet stat ids prefixed `pet:`, then the 10 affinity tags, then the recognized power-only stat ids.
 * Each block is appended after the last, so an older player/pet/affinity `b=` payload decodes
 * identically; a later block extends the bitset only when one of its tags is set.
 */
export function canonicalBenefitIds(model: DevotionModel): string[] {
  return [
    ...canonicalStatIds(model),
    ...canonicalPetStatIds(model).map(petTagId),
    ...canonicalAffinityIds(),
    ...canonicalPowerStatIds(model), // appended LAST so older player/pet/affinity payloads decode unchanged
  ];
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlToBytes(s: string): Uint8Array {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// A trailing-trimmed bitset over `canonical`, base64url-encoded ("" when nothing is set).
function encodeBitset(selected: Set<string>, canonical: string[]): string {
  const bytes = new Uint8Array(Math.ceil(canonical.length / 8));
  canonical.forEach((id, i) => {
    if (selected.has(id)) bytes[i >> 3]! |= 1 << (i & 7);
  });
  let end = bytes.length;
  while (end > 0 && bytes[end - 1] === 0) end--; // trim trailing zero bytes for a short hash
  return bytesToBase64Url(bytes.subarray(0, end));
}

function decodeBitset(s: string, canonical: string[]): Set<string> {
  const out = new Set<string>();
  if (!s) return out;
  let bytes: Uint8Array;
  try {
    bytes = base64UrlToBytes(s);
  } catch {
    return out; // unparseable -> empty
  }
  canonical.forEach((id, i) => {
    if ((bytes[i >> 3] ?? 0) & (1 << (i & 7))) out.add(id);
  });
  return out;
}

/** Encode state into a hash payload like "p=55&s=AAEC&b=BA" (no leading '#'). */
export function encodeHash(
  selected: Set<StarId>,
  pointCap: number,
  canonical: StarId[],
  benefits: Set<string> = new Set(),
  statCanonical: string[] = [],
  baseline: { selected: Set<StarId>; pointCap: number } | null = null,
  query: string = "",
  source: string = "",
): string {
  // p=0 is the uncapped sentinel (0 is otherwise an invalid cap; the real min is 1).
  const cap = Number.isFinite(pointCap) ? pointCap : 0;
  let out = `p=${cap}&s=${encodeBitset(selected, canonical)}`;
  const b = encodeBitset(benefits, statCanonical);
  if (b) out += `&b=${b}`; // only when benefit tags are selected
  if (baseline) {
    // The baseline build rides parallel to the live one; cs= present means "comparison active".
    const bcap = Number.isFinite(baseline.pointCap) ? baseline.pointCap : 0;
    out += `&cs=${encodeBitset(baseline.selected, canonical)}&cp=${bcap}`;
  }
  // Only when a search is active, same as b=; an empty box leaves the hash as it was.
  const q = normalizeQuery(query);
  if (q) out += `&q=${encodeURIComponent(q)}`;
  // Provenance only: the selection above is authoritative, so this never affects what is restored.
  const gt = normalizeSource(source);
  if (gt) out += `&gt=${gt}`;
  return out;
}

/** Decode a hash payload back to state, tolerant of garbage. Returns null if there is nothing to decode. */
export function decodeHash(
  hash: string,
  canonical: StarId[],
  statCanonical: string[] = [],
): {
  selected: Set<StarId>;
  pointCap: number;
  benefits: Set<string>;
  baseline: { selected: Set<StarId>; pointCap: number } | null;
  query: string;
  source: string;
} | null {
  const raw = hash.replace(/^#/, "").trim();
  if (!raw) return null;
  const params = new URLSearchParams(raw);
  // Any recognized param is enough to decode; each one below defaults independently, so a
  // hand-edited or truncated link restores a sensible planner instead of nothing. A hash
  // carrying none of them (a stray fragment, another app's anchor) is still not ours.
  if (!KNOWN_PARAMS.some((k) => params.has(k))) return null;

  const pointCap = decodeCap(params.get("p"));

  const selected = decodeBitset(params.get("s") ?? "", canonical);
  const benefits = decodeBitset(params.get("b") ?? "", statCanonical);

  // Baseline is active only when cs= decodes to a non-empty selection (a stale/empty/malformed
  // cs= simply means "no comparison", matching the tolerance of the other params).
  let baseline: { selected: Set<StarId>; pointCap: number } | null = null;
  const baseSel = decodeBitset(params.get("cs") ?? "", canonical);
  if (baseSel.size > 0) baseline = { selected: baseSel, pointCap: decodeCap(params.get("cp")) };

  // No try/catch here on purpose: URLSearchParams.get() does not throw on a malformed escape,
  // it substitutes U+FFFD (decodeURIComponent is the one that throws, and it is not called).
  // Tolerance comes from the normal form instead: a missing q is "", and an oversized or
  // padded one is trimmed and capped rather than rejected.
  const query = normalizeQuery(params.get("q") ?? "");

  const source = normalizeSource(params.get("gt") ?? "");

  return { selected, pointCap, benefits, baseline, query, source };
}
