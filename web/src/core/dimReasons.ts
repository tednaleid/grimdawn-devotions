// ABOUTME: Explains a dim verdict: the fewest points a target needs (searched past the cap), the affinity
// ABOUTME: it is short and which constellation sets each need, and the members that need transient affinity.
import type { DevotionModel, StarId } from "./types";
import { BUDGET, type CoverTable, type ReachCon, type ReachState, minCostFrom, selectionSummary } from "./reachability";

/** How far past the game's 55-point cap a dim explanation searches before giving up on a number. */
export const DIM_SEARCH_MAX = BUDGET + 10;

/** One color the target's completed members do not supply for its own requirements. */
export interface AffinityDeficit {
  color: number; // AFFINITIES index
  count: number; // how much more of it the target needs
  sources: string[]; // constellation ids whose requirement sets that need, in map order
}

export interface DimReport {
  /** Fewest points that make the target a legal, constructible build, or null if none within the search bound. */
  needs: number | null;
  deficit: AffinityDeficit[];
  /** Members whose requirement exceeds what the rest of the target supplies: each can only be activated
   *  with transient affinity from outside the build, which is why a build at the cap can be unfinishable. */
  scaffolders: string[];
}

/** `built` (already in map order when it comes from selectionSummary) filtered and re-ordered by the map. */
function inMapOrder(model: DevotionModel, ids: Set<string>): string[] {
  const out: string[] = [];
  for (const id of model.constellations.keys()) if (ids.has(id)) out.push(id);
  return out;
}

export function affinityDeficits(model: DevotionModel, st: ReachState): AffinityDeficit[] {
  const out: AffinityDeficit[] = [];
  for (let i = 0; i < 5; i++) {
    const count = st.target[i]! - st.supplyUncapped[i]!;
    if (count <= 0) continue;
    const sources = new Set<string>();
    for (const m of st.built) if (m.req[i] === st.target[i]) sources.add(m.id);
    out.push({ color: i, count, sources: inMapOrder(model, sources) });
  }
  return out;
}

export function membersNeedingScaffold(model: DevotionModel, st: ReachState): string[] {
  const ids = new Set<string>();
  for (const m of st.built as ReachCon[]) {
    for (let i = 0; i < 5; i++) {
      if (m.req[i]! > st.supplyUncapped[i]! - m.grant[i]!) {
        ids.add(m.id);
        break;
      }
    }
  }
  return inMapOrder(model, ids);
}

/** The full explanation for `target` (a selection plus the constellation or star path being asked about). */
export function dimReport(
  model: DevotionModel,
  cons: ReachCon[],
  table: CoverTable,
  target: Set<StarId>,
  searchMax = DIM_SEARCH_MAX,
): DimReport {
  const st = selectionSummary(model, target);
  return {
    needs: minCostFrom(cons, table, st, searchMax),
    deficit: affinityDeficits(model, st),
    scaffolders: membersNeedingScaffold(model, st),
  };
}
