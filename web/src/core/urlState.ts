// ABOUTME: Encodes/decodes planner state (point cap + selected stars) to a compact URL hash.
// ABOUTME: Selected stars are a trailing-trimmed bitset over a stable canonical star-id order, base64url-encoded.
import type { DevotionModel, StarId } from "./types";

const MIN_CAP = 1;
const MAX_CAP = 55;

/** Stable ordering of every star id: constellation insertion order, then star index. */
export function canonicalStarIds(model: DevotionModel): StarId[] {
  const out: StarId[] = [];
  for (const c of model.constellations.values()) for (const id of c.starIds) out.push(id);
  return out;
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

/** Encode state into a hash payload like "p=55&s=AAEC" (no leading '#'). */
export function encodeHash(selected: Set<StarId>, pointCap: number, canonical: StarId[]): string {
  const bytes = new Uint8Array(Math.ceil(canonical.length / 8));
  canonical.forEach((id, i) => {
    if (selected.has(id)) bytes[i >> 3]! |= 1 << (i & 7);
  });
  let end = bytes.length;
  while (end > 0 && bytes[end - 1] === 0) end--; // trim trailing zero bytes for a short hash
  return `p=${pointCap}&s=${bytesToBase64Url(bytes.subarray(0, end))}`;
}

/** Decode a hash payload back to state, tolerant of garbage. Returns null if there is nothing to decode. */
export function decodeHash(hash: string, canonical: StarId[]): { selected: Set<StarId>; pointCap: number } | null {
  const raw = hash.replace(/^#/, "").trim();
  if (!raw) return null;
  const params = new URLSearchParams(raw);
  if (!params.has("p") && !params.has("s")) return null;

  let pointCap = Number(params.get("p"));
  if (!Number.isFinite(pointCap)) pointCap = MAX_CAP;
  pointCap = Math.max(MIN_CAP, Math.min(MAX_CAP, Math.round(pointCap)));

  const selected = new Set<StarId>();
  const sParam = params.get("s") ?? "";
  if (sParam) {
    let bytes: Uint8Array;
    try {
      bytes = base64UrlToBytes(sParam);
    } catch {
      return { selected, pointCap }; // unparseable bitset -> empty selection, keep cap
    }
    canonical.forEach((id, i) => {
      if ((bytes[i >> 3] ?? 0) & (1 << (i & 7))) selected.add(id);
    });
  }
  return { selected, pointCap };
}
