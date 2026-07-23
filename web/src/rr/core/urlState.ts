// ABOUTME: The RR page ViewState (every view-changing control) and its default; hash codec added in Task 6.
// ABOUTME: ViewState is the single source of view state; main.ts round-trips it through the URL hash.
import { DAMAGE_TYPES, RR_TYPES, COARSE_CATEGORIES } from "./facets";

export interface ViewState {
  q: string;
  fType: Set<string>;
  fRR: Set<string>;
  fCat: Set<string>;
  sortKey: string;
  sortDir: 1 | -1;
  sel: Set<string>;
  r0: number;
}

export const DEFAULT_VIEW: ViewState = {
  q: "",
  fType: new Set(),
  fRR: new Set(),
  fCat: new Set(),
  sortKey: "rr",
  sortDir: 1,
  sel: new Set(),
  r0: 100,
};

const RR_VALUES = new Set(RR_TYPES);
const CAT_VALUES = new Set(COARSE_CATEGORIES);
const DMG_VALUES = new Set(DAMAGE_TYPES);

function putSet(parts: string[], key: string, set: Set<string>): void {
  if (set.size) parts.push(`${key}=${[...set].map(encodeURIComponent).join(",")}`);
}

function readSet(val: string, allowed: Set<string>): Set<string> {
  const out = new Set<string>();
  for (const raw of val.split(",")) {
    let t: string;
    try {
      t = decodeURIComponent(raw);
    } catch {
      continue;
    }
    if (allowed.has(t)) out.add(t);
  }
  return out;
}

/** Encode the full view into a `key=value&...` hash body (no leading '#'); empties are omitted. */
export function encodeHash(view: ViewState): string {
  const parts: string[] = [];
  const put = (k: string, v: string) => {
    if (v) parts.push(`${k}=${encodeURIComponent(v)}`);
  };
  put("q", view.q);
  putSet(parts, "type", view.fType);
  putSet(parts, "rr", view.fRR);
  putSet(parts, "cat", view.fCat);
  parts.push(`sort=${encodeURIComponent(view.sortKey)}:${view.sortDir}`);
  if (view.r0 !== DEFAULT_VIEW.r0) parts.push(`r0=${view.r0}`);
  if (view.sel.size) parts.push(`sel=${[...view.sel].map(encodeURIComponent).join(",")}`);
  return parts.join("&");
}

/** Decode a hash body onto DEFAULT_VIEW; tolerates garbage and drops sel ids not in knownIds. */
export function decodeHash(hash: string, knownIds: Set<string>): ViewState {
  const v: ViewState = { ...DEFAULT_VIEW, fType: new Set(), fRR: new Set(), fCat: new Set(), sel: new Set() };
  const body = hash.startsWith("#") ? hash.slice(1) : hash;
  for (const pair of body.split("&")) {
    const eq = pair.indexOf("=");
    if (eq < 0) continue;
    const key = pair.slice(0, eq);
    const rawVal = pair.slice(eq + 1);
    // Set-valued keys tolerate per-token decode failures via readSet, so they read rawVal directly
    // rather than sharing the outer decode below (a malformed token would otherwise drop the whole list).
    if (key === "type") {
      v.fType = readSet(rawVal, DMG_VALUES);
      continue;
    }
    if (key === "rr") {
      v.fRR = readSet(rawVal, RR_VALUES);
      continue;
    }
    if (key === "cat") {
      v.fCat = readSet(rawVal, CAT_VALUES);
      continue;
    }
    let val: string;
    try {
      val = decodeURIComponent(rawVal);
    } catch {
      continue;
    }
    switch (key) {
      case "q":
        v.q = val;
        break;
      case "sort": {
        const [k, d] = val.split(":");
        if (k) v.sortKey = k;
        v.sortDir = d === "-1" ? -1 : 1;
        break;
      }
      case "r0": {
        const n = Number(val);
        if (Number.isFinite(n)) v.r0 = n;
        break;
      }
      case "sel":
        for (const id of val.split(",")) if (id && knownIds.has(id)) v.sel.add(id);
        break;
      default:
        break;
    }
  }
  return v;
}
