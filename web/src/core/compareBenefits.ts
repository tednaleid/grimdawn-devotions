// ABOUTME: Builds the baseline-vs-current Benefits comparison view-model (per-part base/now/delta).
// ABOUTME: Pure: turns two star selections into grouped subjects with formatted values and verdicts.
import type { DevotionModel, StarId } from "./types";
import { sumBonuses, sumPetBonuses, racialTargets } from "./aggregate";
import { condensedRows, classify, type CondensedPart, type StatGroup } from "./statFormat";

// "mixed" only ever applies to a subject roll-up (some parts up, some down); a single part is
// always one of up/down/same.
export type Verdict = "up" | "down" | "same" | "mixed";
export interface ComparePart {
  id: string;
  label: string;
  base: string;
  now: string;
  delta: string;
  verdict: Verdict;
}
export interface CompareSubject {
  subject: string;
  key: string;
  ids: string[];
  verdict: Verdict;
  parts: ComparePart[];
}
export interface CompareGroup {
  group: StatGroup;
  subjects: CompareSubject[];
}

const DASH = "—";
const DIM_LABEL: Record<CondensedPart["dim"], string> = {
  flat: "flat",
  pct: "%",
  max: "max",
  durFlat: "duration",
  durPct: "duration",
};

// The displayed (sign-applied) scalar for a stat id, or undefined when the stat is absent.
function displayed(map: Record<string, number>, id: string): number | undefined {
  const v = map[id];
  if (v === undefined) return undefined;
  const c = classify(id);
  return c ? c.sign * v : v;
}

// Whether a part is a merged flat damage range (id ends in "Min" with a paired "Max").
function rangeMaxId(id: string): string | null {
  return id.endsWith("Min") ? `${id.slice(0, -3)}Max` : null;
}

function fmtDelta(n: number): string {
  if (n === 0) return DASH;
  const r = Math.round(n * 100) / 100;
  return r > 0 ? `+${r}` : `${r}`;
}

function buildScope(baseMap: Record<string, number>, nowMap: Record<string, number>, racial: string[]): CompareGroup[] {
  // Condense each side exactly once. The skeleton (which subjects/parts exist, their dim) comes
  // from the union of both structures; the formatted Base/Now values come from these same groups,
  // indexed by part id.
  const baseGroups = condensedRows(baseMap, { racialTarget: racial });
  const nowGroups = condensedRows(nowMap, { racialTarget: racial });
  const partValOf = (groups: typeof baseGroups): Map<string, string> => {
    const m = new Map<string, string>();
    for (const g of groups) for (const s of g.subjects) for (const p of s.parts) m.set(p.id, p.value);
    return m;
  };
  const basePartVal = partValOf(baseGroups);
  const nowPartVal = partValOf(nowGroups);

  const subjMeta = new Map<string, { group: StatGroup; subject: string; ids: string[] }>();
  const partDim = new Map<string, CondensedPart["dim"]>();
  for (const groups of [baseGroups, nowGroups]) {
    for (const g of groups) {
      for (const s of g.subjects) {
        if (!subjMeta.has(s.key)) subjMeta.set(s.key, { group: g.group, subject: s.subject, ids: [] });
        const sm = subjMeta.get(s.key)!;
        for (const p of s.parts) {
          if (!partDim.has(p.id)) {
            partDim.set(p.id, p.dim);
            sm.ids.push(p.id);
          }
        }
      }
    }
  }

  // Assemble per group, preserving the GROUP_ORDER / subject order from condensedRows of the union map.
  const out: CompareGroup[] = [];
  const byGroup = new Map<StatGroup, CompareSubject[]>();
  for (const [key, sm] of subjMeta) {
    const parts: ComparePart[] = sm.ids.map((id) => {
      const base = basePartVal.get(id) ?? DASH;
      const now = nowPartVal.get(id) ?? DASH;
      const maxId = rangeMaxId(id);
      let delta: string;
      let verdict: Verdict;
      if (maxId && (baseMap[maxId] !== undefined || nowMap[maxId] !== undefined)) {
        // Range: compare min+max sums; no scalar delta number.
        const b = (baseMap[id] ?? 0) + (baseMap[maxId] ?? 0);
        const n = (nowMap[id] ?? 0) + (nowMap[maxId] ?? 0);
        verdict = n > b ? "up" : n < b ? "down" : "same";
        delta = verdict === "same" ? DASH : "";
      } else {
        const b = displayed(baseMap, id) ?? 0;
        const n = displayed(nowMap, id) ?? 0;
        verdict = n > b ? "up" : n < b ? "down" : "same";
        delta = fmtDelta(n - b);
      }
      return { id, label: DIM_LABEL[partDim.get(id)!], base, now, delta, verdict };
    });
    // Subject roll-up: all parts unchanged -> "same"; net better/worse -> "up"/"down"; a subject
    // with parts moving both ways (e.g. traded flat for percent) -> "mixed".
    const hasUp = parts.some((p) => p.verdict === "up");
    const hasDown = parts.some((p) => p.verdict === "down");
    const verdict: Verdict = !hasUp && !hasDown ? "same" : hasUp && hasDown ? "mixed" : hasUp ? "up" : "down";
    const subj: CompareSubject = { subject: sm.subject, key, ids: sm.ids, verdict, parts };
    if (!byGroup.has(sm.group)) byGroup.set(sm.group, []);
    byGroup.get(sm.group)!.push(subj);
  }
  for (const [group, subjects] of byGroup) {
    subjects.sort((a, b) => a.subject.localeCompare(b.subject));
    out.push({ group, subjects });
  }
  return out;
}

export function compareBenefits(
  model: DevotionModel,
  baseSelected: Set<StarId>,
  nowSelected: Set<StarId>,
): { player: CompareGroup[]; pet: CompareGroup[] } {
  const racial = racialTargets(model, nowSelected);
  return {
    player: buildScope(sumBonuses(model, baseSelected), sumBonuses(model, nowSelected), racial),
    pet: buildScope(sumPetBonuses(model, baseSelected), sumPetBonuses(model, nowSelected), []),
  };
}
