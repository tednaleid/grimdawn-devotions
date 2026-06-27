// ABOUTME: Pure mapping from engine legality (clickable/completable/selected) to the touch popover's
// ABOUTME: Add/Remove button label + enabled state. Mirrors toggleStar/toggleConstellation in rules.ts.
import type { DevotionModel, StarId } from "./types";
import type { ReachView } from "./reachability";

export type CommitTarget = { kind: "star" | "constellation"; id: string };
export interface CommitButton {
  label: "Add" | "Remove";
  enabled: boolean;
}

export function commitButton(
  model: DevotionModel,
  selected: Set<StarId>,
  reach: ReachView,
  target: CommitTarget,
): CommitButton {
  if (target.kind === "star") {
    if (selected.has(target.id)) return { label: "Remove", enabled: true };
    return { label: "Add", enabled: reach.clickable.has(target.id) };
  }
  const con = model.constellations.get(target.id);
  const starIds = con?.starIds ?? [];
  // Mirror toggleConstellation: fully selected removes freely; otherwise it adds, gated by completable.
  if (starIds.length > 0 && starIds.every((id) => selected.has(id))) return { label: "Remove", enabled: true };
  return { label: "Add", enabled: reach.completable.has(target.id) };
}
