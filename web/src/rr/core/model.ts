// ABOUTME: The RrSource type and parseCatalogue, mapping the committed snake_case RR JSON to camelCase.
// ABOUTME: Pure; tolerates a missing/short doc and only throws when the doc is not an object.

export type RrType = "stacking" | "reduced-percent" | "reduced-flat";

/** One atomic RR row: a single (record, resistance-token) source as emitted by scripts/parse_rr.py. */
export interface RrSource {
  id: string;
  name: string;
  parent: string;
  recordPath: string;
  category: string;
  rrType: RrType;
  resistances: "All" | "Elemental" | string[];
  valuesPerRank: number[];
  maxRank: number;
  ultimateRank: number | null;
  valueAtMax: number | null;
  valueAtUltimate: number | null;
  durationSeconds: number | null;
  cooldownSeconds: number | null;
  triggerChancePercent: number | null;
  trigger: string;
  perResistanceValues: Record<string, number> | null;
  notes: string;
}

interface RawSource {
  id: string;
  name: string;
  parent: string;
  record_path: string;
  category: string;
  rr_type: RrType;
  resistances: "All" | "Elemental" | string[];
  values_per_rank: number[];
  max_rank: number;
  ultimate_rank: number | null;
  value_at_max: number | null;
  value_at_ultimate: number | null;
  duration_seconds: number | null;
  cooldown_seconds: number | null;
  trigger_chance_percent: number | null;
  trigger: string;
  per_resistance_values: Record<string, number> | null;
  notes: string;
}

function mapSource(r: RawSource): RrSource {
  return {
    id: r.id,
    name: r.name,
    parent: r.parent,
    recordPath: r.record_path,
    category: r.category,
    rrType: r.rr_type,
    resistances: r.resistances,
    valuesPerRank: r.values_per_rank ?? [],
    maxRank: r.max_rank,
    ultimateRank: r.ultimate_rank,
    valueAtMax: r.value_at_max,
    valueAtUltimate: r.value_at_ultimate,
    durationSeconds: r.duration_seconds,
    cooldownSeconds: r.cooldown_seconds,
    triggerChancePercent: r.trigger_chance_percent,
    trigger: r.trigger,
    perResistanceValues: r.per_resistance_values,
    notes: r.notes ?? "",
  };
}

/** Parse the `{meta, sources}` catalogue doc into camelCase RrSources. Throws only on a non-object. */
export function parseCatalogue(doc: unknown): {
  meta: Record<string, unknown>;
  sources: RrSource[];
} {
  if (typeof doc !== "object" || doc === null) {
    throw new Error("RR catalogue must be an object");
  }
  const d = doc as { meta?: Record<string, unknown>; sources?: RawSource[] };
  const sources = Array.isArray(d.sources) ? d.sources.map(mapSource) : [];
  return { meta: d.meta ?? {}, sources };
}
