// ABOUTME: Builds the unified Benefits row-model: one row per value with a label role (subject name,
// ABOUTME: indented sub-label, or bare continuation), and Base/Now/Delta cells when a baseline is given.
import type { DevotionModel, StarId } from "./types";
import { sumBonuses, sumPetBonuses, racialTargets } from "./aggregate";
import { condensedRows, classify, type CondensedPart, type StatGroup } from "./statFormat";

export type Verdict = "up" | "down" | "same" | "mixed";
export type RowRole = "subject" | "sub" | "cont";
export interface BenefitRow {
  role: RowRole;
  subLabel: string; // "duration" | "max" when role === "sub", else ""
  id: string;
  base: string; // "" in regular mode
  now: string; // displayed value (regular: the build's value; compare: current)
  delta: string; // "" in regular mode
  verdict: Verdict | ""; // "" in regular mode
}
export interface BenefitSubject {
  subject: string;
  key: string;
  ids: string[];
  verdict: Verdict | ""; // subject roll-up (compare only)
  rows: BenefitRow[];
}
export interface BenefitGroup {
  group: StatGroup;
  subjects: BenefitSubject[];
}

const DASH = "—";
const DIM_INDEX: Record<CondensedPart["dim"], number> = { flat: 0, pct: 1, max: 2, durFlat: 3, durPct: 4 };

// The displayed (sign-applied) scalar for a stat id, or undefined when absent.
function displayed(map: Record<string, number>, id: string): number | undefined {
  const v = map[id];
  if (v === undefined) return undefined;
  const c = classify(id);
  return c ? c.sign * v : v;
}
function rangeMaxId(id: string): string | null {
  return id.endsWith("Min") ? `${id.slice(0, -3)}Max` : null;
}
function fmtDelta(n: number): string {
  if (n === 0) return DASH;
  const r = Math.round(n * 100) / 100;
  return r > 0 ? `+${r}` : `${r}`;
}
// Row value text: keep the seconds suffix on a flat duration; everything else is the raw condensed
// value. A max-resist is qualified at row-build time: by the "max" sub-label on a later row, or by a
// "max " prefix when it is the subject's first/only row (see maxQualified in buildScope).
function rowValue(dim: CondensedPart["dim"], value: string): string {
  return dim === "durFlat" ? `${value}s` : value;
}

interface PartMeta {
  id: string;
  dim: CondensedPart["dim"];
}
interface SubjMeta {
  group: StatGroup;
  subject: string;
  key: string;
  parts: PartMeta[];
}

// Walk both sides' condensed structures into a per-subject skeleton (union of parts, dim-ordered)
// plus, per part id, the formatted value on each side.
function skeleton(
  baseMap: Record<string, number>,
  nowMap: Record<string, number>,
  racial: string[],
  comparing: boolean,
): { subjects: SubjMeta[]; baseVal: Map<string, string>; nowVal: Map<string, string> } {
  const maps = comparing ? [baseMap, nowMap] : [nowMap];
  const baseVal = new Map<string, string>();
  const nowVal = new Map<string, string>();
  const subjs = new Map<string, SubjMeta>();
  const order: string[] = [];
  for (let side = 0; side < maps.length; side++) {
    for (const g of condensedRows(maps[side]!, { racialTarget: racial })) {
      for (const s of g.subjects) {
        let sm = subjs.get(s.key);
        if (!sm) {
          sm = { group: g.group, subject: s.subject, key: s.key, parts: [] };
          subjs.set(s.key, sm);
          order.push(s.key);
        }
        for (const p of s.parts) {
          if (!sm.parts.some((x) => x.id === p.id)) sm.parts.push({ id: p.id, dim: p.dim });
          const target = comparing && side === 0 ? baseVal : nowVal;
          target.set(p.id, rowValue(p.dim, p.value));
        }
      }
    }
  }
  for (const sm of subjs.values()) sm.parts.sort((a, b) => DIM_INDEX[a.dim] - DIM_INDEX[b.dim]);
  return { subjects: order.map((k) => subjs.get(k)!), baseVal, nowVal };
}

function buildScope(
  baseMap: Record<string, number>,
  nowMap: Record<string, number>,
  racial: string[],
  comparing: boolean,
): BenefitGroup[] {
  const { subjects, baseVal, nowVal } = skeleton(baseMap, nowMap, racial, comparing);
  const byGroup = new Map<StatGroup, BenefitSubject[]>();
  for (const sm of subjects) {
    let firstDone = false;
    let durLabeled = false;
    const rows: BenefitRow[] = sm.parts.map((part) => {
      const isDur = part.dim === "durFlat" || part.dim === "durPct";
      let role: RowRole;
      let subLabel = "";
      if (!firstDone) role = "subject";
      else if (part.dim === "max") {
        role = "sub";
        subLabel = "max";
      } else if (isDur && !durLabeled) {
        role = "sub";
        subLabel = "duration";
      } else role = "cont";
      if (isDur) durLabeled = true;
      firstDone = true;

      // A max-resist on the subject row has no "max" sub-label to qualify it, so prefix the value.
      const maxFirst = role === "subject" && part.dim === "max";
      const maxQualified = (s: string) => (maxFirst && s !== DASH ? `max ${s}` : s);

      if (!comparing) {
        return {
          role,
          subLabel,
          id: part.id,
          base: "",
          now: maxQualified(nowVal.get(part.id) ?? DASH),
          delta: "",
          verdict: "",
        };
      }
      const base = maxQualified(baseVal.get(part.id) ?? DASH);
      const now = maxQualified(nowVal.get(part.id) ?? DASH);
      const maxId = rangeMaxId(part.id);
      let delta: string;
      let verdict: Verdict;
      if (maxId && (baseMap[maxId] !== undefined || nowMap[maxId] !== undefined)) {
        const b = (baseMap[part.id] ?? 0) + (baseMap[maxId] ?? 0);
        const n = (nowMap[part.id] ?? 0) + (nowMap[maxId] ?? 0);
        verdict = n > b ? "up" : n < b ? "down" : "same";
        delta = verdict === "same" ? DASH : "";
      } else {
        const b = displayed(baseMap, part.id) ?? 0;
        const n = displayed(nowMap, part.id) ?? 0;
        // Verdict ranks goodness, not the displayed order: the raw value IS the goodness score
        // (more of a benefit or more of a reduction is better; a negative raw is a penalty), whereas
        // displayed() applies the reduction sign and would rank "more reduction" as worse. The delta
        // stays the change in the displayed value so base + delta = now still reads consistently.
        const bRaw = baseMap[part.id] ?? 0;
        const nRaw = nowMap[part.id] ?? 0;
        verdict = nRaw > bRaw ? "up" : nRaw < bRaw ? "down" : "same";
        delta = fmtDelta(n - b);
      }
      return { role, subLabel, id: part.id, base, now, delta, verdict };
    });
    const hasUp = rows.some((r) => r.verdict === "up");
    const hasDown = rows.some((r) => r.verdict === "down");
    const verdict: Verdict | "" = !comparing
      ? ""
      : !hasUp && !hasDown
        ? "same"
        : hasUp && hasDown
          ? "mixed"
          : hasUp
            ? "up"
            : "down";
    const subj: BenefitSubject = { subject: sm.subject, key: sm.key, ids: sm.parts.map((p) => p.id), verdict, rows };
    if (!byGroup.has(sm.group)) byGroup.set(sm.group, []);
    byGroup.get(sm.group)!.push(subj);
  }
  // Sort subjects alphabetically within each group so both modes match. condensedRows already sorts,
  // so this is a no-op in regular mode; in compare mode it reorders the base/now union into one order.
  return [...byGroup].map(([group, subjects]) => ({
    group,
    subjects: subjects.sort((a, b) => a.subject.localeCompare(b.subject)),
  }));
}

export function benefitRows(
  model: DevotionModel,
  current: Set<StarId>,
  baseline: Set<StarId> | null,
): { player: BenefitGroup[]; pet: BenefitGroup[] } {
  const comparing = baseline !== null;
  const racial = racialTargets(model, current);
  const baseSel = baseline ?? new Set<StarId>();
  return {
    player: buildScope(sumBonuses(model, baseSel), sumBonuses(model, current), racial, comparing),
    pet: buildScope(sumPetBonuses(model, baseSel), sumPetBonuses(model, current), [], comparing),
  };
}
