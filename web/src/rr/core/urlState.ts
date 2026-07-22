// ABOUTME: The RR page ViewState (every view-changing control) and its default; hash codec added in Task 6.
// ABOUTME: ViewState is the single source of view state; main.ts round-trips it through the URL hash.

export interface ViewState {
  q: string;
  fType: string;
  fRR: string;
  fCat: string;
  fPar: string;
  fTrig: string;
  sortKey: string;
  sortDir: 1 | -1;
  group: "none" | "mastery" | "constellation" | "item";
  sel: Set<string>;
  r0: number;
}

export const DEFAULT_VIEW: ViewState = {
  q: "",
  fType: "",
  fRR: "",
  fCat: "",
  fPar: "",
  fTrig: "",
  sortKey: "rr",
  sortDir: 1,
  group: "none",
  sel: new Set(),
  r0: 100,
};

const GROUPS = new Set(["none", "mastery", "constellation", "item"]);

/** Encode the full view into a `key=value&...` hash body (no leading '#'); empties are omitted. */
export function encodeHash(view: ViewState): string {
  const parts: string[] = [];
  const put = (k: string, v: string) => {
    if (v) parts.push(`${k}=${encodeURIComponent(v)}`);
  };
  put("q", view.q);
  put("type", view.fType);
  put("rr", view.fRR);
  put("cat", view.fCat);
  put("par", view.fPar);
  put("trig", view.fTrig);
  parts.push(`sort=${encodeURIComponent(view.sortKey)}:${view.sortDir}`);
  if (view.group !== "none") parts.push(`group=${view.group}`);
  if (view.r0 !== DEFAULT_VIEW.r0) parts.push(`r0=${view.r0}`);
  if (view.sel.size) parts.push(`sel=${[...view.sel].map(encodeURIComponent).join(",")}`);
  return parts.join("&");
}

/** Decode a hash body onto DEFAULT_VIEW; tolerates garbage and drops sel ids not in knownIds. */
export function decodeHash(hash: string, knownIds: Set<string>): ViewState {
  const v: ViewState = { ...DEFAULT_VIEW, sel: new Set() };
  const body = hash.startsWith("#") ? hash.slice(1) : hash;
  for (const pair of body.split("&")) {
    const eq = pair.indexOf("=");
    if (eq < 0) continue;
    const key = pair.slice(0, eq);
    let val: string;
    try {
      val = decodeURIComponent(pair.slice(eq + 1));
    } catch {
      continue;
    }
    switch (key) {
      case "q":
        v.q = val;
        break;
      case "type":
        v.fType = val;
        break;
      case "rr":
        v.fRR = val;
        break;
      case "cat":
        v.fCat = val;
        break;
      case "par":
        v.fPar = val;
        break;
      case "trig":
        v.fTrig = val;
        break;
      case "sort": {
        const [k, d] = val.split(":");
        if (k) v.sortKey = k;
        v.sortDir = d === "-1" ? -1 : 1;
        break;
      }
      case "group":
        if (GROUPS.has(val)) v.group = val as ViewState["group"];
        break;
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
