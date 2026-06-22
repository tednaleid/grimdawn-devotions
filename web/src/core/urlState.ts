// ABOUTME: Encodes/decodes planner state (point cap, selected stars, selected benefit tags) to a compact URL hash.
// ABOUTME: Each selection is a trailing-trimmed bitset over a stable canonical id order, base64url-encoded.
import type { DevotionModel, StarId } from "./types";

const MIN_CAP = 1;
const MAX_CAP = 55;

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
 * The benefit-tag ordering for the URL bitset: the player stat ids (unchanged positions) followed
 * by the pet stat ids, each prefixed `pet:`. Because the player block is unchanged, an old
 * player-only `b=` payload decodes identically; pet tags extend the bitset only when present.
 */
export function canonicalBenefitIds(model: DevotionModel): string[] {
  return [...canonicalStatIds(model), ...canonicalPetStatIds(model).map((id) => `pet:${id}`)];
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
): string {
  // p=0 is the uncapped sentinel (0 is otherwise an invalid cap; the real min is 1).
  const cap = Number.isFinite(pointCap) ? pointCap : 0;
  let out = `p=${cap}&s=${encodeBitset(selected, canonical)}`;
  const b = encodeBitset(benefits, statCanonical);
  if (b) out += `&b=${b}`; // only when benefit tags are selected
  return out;
}

/** Decode a hash payload back to state, tolerant of garbage. Returns null if there is nothing to decode. */
export function decodeHash(
  hash: string,
  canonical: StarId[],
  statCanonical: string[] = [],
): { selected: Set<StarId>; pointCap: number; benefits: Set<string> } | null {
  const raw = hash.replace(/^#/, "").trim();
  if (!raw) return null;
  const params = new URLSearchParams(raw);
  if (!params.has("p") && !params.has("s") && !params.has("b")) return null;

  // p=0 restores the uncapped state; any other value clamps to the finite range.
  let pointCap: number;
  if (params.get("p") === "0") {
    pointCap = Infinity;
  } else {
    pointCap = Number(params.get("p"));
    if (!Number.isFinite(pointCap)) pointCap = MAX_CAP;
    pointCap = Math.max(MIN_CAP, Math.min(MAX_CAP, Math.round(pointCap)));
  }

  const selected = decodeBitset(params.get("s") ?? "", canonical);
  const benefits = decodeBitset(params.get("b") ?? "", statCanonical);
  return { selected, pointCap, benefits };
}
