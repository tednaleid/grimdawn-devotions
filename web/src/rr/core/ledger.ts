// ABOUTME: Pure debuff-ledger resolution: stack sum, then single-highest multiplicative, then flat.
// ABOUTME: Sign-aware multiplicative step cannot cross zero on its own; matches the in-game order.
import type { LogicalSource } from "./aggregate";

/** The ten enemy resistances RR can reduce (Poison & Acid and Vitality are single types). */
export const RESISTANCES = [
  "Fire",
  "Cold",
  "Lightning",
  "Poison & Acid",
  "Vitality",
  "Aether",
  "Chaos",
  "Pierce",
  "Bleeding",
  "Physical",
] as const;

/** The three types "Elemental" expands to inside the ledger. */
export const ELEMENTAL = ["Fire", "Cold", "Lightning"] as const;

export interface LedgerLine {
  resistance: string;
  final: number;
  sumStack: number;
  maxMult: number;
  maxFlat: number;
  bestMult: LogicalSource | null;
  bestFlat: LogicalSource | null;
  stackSources: LogicalSource[];
  // The overridden mult/flat sources hitting this resistance (single-highest wins; these lose).
  multLosers: LogicalSource[];
  flatLosers: LogicalSource[];
}

/** The token a source matches for `resistance` (All / Elemental / the type itself), or null. */
function matchedToken(source: LogicalSource, resistance: string): string | null {
  const res = source.resistances;
  if (res.includes("All")) return "All";
  if (res.includes("Elemental") && (ELEMENTAL as readonly string[]).includes(resistance)) return "Elemental";
  if (res.includes(resistance)) return resistance;
  return null;
}

/** Whether a source reduces `resistance` (with All/Elemental expansion). */
export function sourceHits(source: LogicalSource, resistance: string): boolean {
  return matchedToken(source, resistance) !== null;
}

/** The reduction a source applies to `resistance`, or null when it does not hit it. */
export function sourceValue(source: LogicalSource, resistance: string): number | null {
  const token = matchedToken(source, resistance);
  if (token === null) return null;
  const v = source.perResistance[token];
  return v ?? source.valueAtMax;
}

/** Resolve the final resistance per affected type for a selection and starting value r0. */
export function resolveLedger(selected: LogicalSource[], r0: number): LedgerLine[] {
  const lines: LedgerLine[] = [];
  for (const resistance of RESISTANCES) {
    let sumStack = 0;
    let maxMult = 0;
    let maxFlat = 0;
    let bestMult: LogicalSource | null = null;
    let bestFlat: LogicalSource | null = null;
    const stackSources: LogicalSource[] = [];
    const multSources: LogicalSource[] = [];
    const flatSources: LogicalSource[] = [];
    let affected = false;

    for (const s of selected) {
      const v = sourceValue(s, resistance);
      if (v === null) continue;
      affected = true;
      if (s.rrType === "stacking") {
        sumStack += Math.abs(v);
        stackSources.push(s);
      } else if (s.rrType === "reduced-percent") {
        multSources.push(s);
        if (v > maxMult) {
          maxMult = v;
          bestMult = s;
        }
      } else {
        flatSources.push(s);
        if (v > maxFlat) {
          maxFlat = v;
          bestFlat = s;
        }
      }
    }
    if (!affected) continue;

    const base = r0 - sumStack;
    const sgn = Math.sign(base);
    const afterMult = base * (1 - (sgn * maxMult) / 100);
    const final = afterMult - maxFlat;
    lines.push({
      resistance,
      final,
      sumStack,
      maxMult,
      maxFlat,
      bestMult,
      bestFlat,
      stackSources,
      multLosers: multSources.filter((s) => s !== bestMult),
      flatLosers: flatSources.filter((s) => s !== bestFlat),
    });
  }
  return lines;
}
