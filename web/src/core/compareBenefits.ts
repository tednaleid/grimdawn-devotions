// ABOUTME: Builds the baseline-vs-current Benefits comparison view-model (per-part base/now/delta).
// ABOUTME: Pure: turns two star selections into grouped subjects with formatted values and verdicts.
import type { DevotionModel, StarId } from "./types";
import { sumBonuses, sumPetBonuses, racialTargets } from "./aggregate";
import { condensedRows, classify, type CondensedPart, type StatGroup } from "./statFormat";

export type Verdict = "up" | "down" | "same";
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
  // Condense each side independently, then index every part by its id so we can union them.
  const sides: { groups: CompareGroup[]; partVal: Map<string, string> }[] = [baseMap, nowMap].map((m) => {
    const groups = condensedRows(m, { racialTarget: racial });
    const partVal = new Map<string, string>();
    for (const g of groups) for (const s of g.subjects) for (const p of s.parts) partVal.set(p.id, p.value);
    return { groups: groups as unknown as CompareGroup[], partVal };
  });
  const [baseSide, nowSide] = sides as [(typeof sides)[0], (typeof sides)[0]];

  // The subject/part skeleton (group, subject text, key, dim) comes from the union of both
  // condensed structures; values+verdicts come from the raw maps.
  type Meta = { group: StatGroup; subject: string; key: string; dim: CondensedPart["dim"] };
  const subjMeta = new Map<string, { group: StatGroup; subject: string; ids: string[] }>();
  const partMeta = new Map<string, Meta & { subjKey: string }>();
  for (const m of [baseMap, nowMap]) {
    for (const g of condensedRows(m, { racialTarget: racial })) {
      for (const s of g.subjects) {
        if (!subjMeta.has(s.key)) subjMeta.set(s.key, { group: g.group, subject: s.subject, ids: [] });
        const sm = subjMeta.get(s.key)!;
        for (const p of s.parts) {
          if (!partMeta.has(p.id)) {
            partMeta.set(p.id, { group: g.group, subject: s.subject, key: p.id, dim: p.dim, subjKey: s.key });
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
      const meta = partMeta.get(id)!;
      const base = baseSide.partVal.get(id) ?? DASH;
      const now = nowSide.partVal.get(id) ?? DASH;
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
      return { id, label: DIM_LABEL[meta.dim], base, now, delta, verdict };
    });
    const verdict: Verdict = parts.every((p) => p.verdict === "same")
      ? "same"
      : parts.some((p) => p.verdict === "up") && !parts.some((p) => p.verdict === "down")
        ? "up"
        : parts.some((p) => p.verdict === "down") && !parts.some((p) => p.verdict === "up")
          ? "down"
          : "same";
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
