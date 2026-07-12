// ABOUTME: Pure mapping from engine legality (reachableStars/completable/selected) to the touch popover's
// ABOUTME: Add/Remove button label + enabled state. Mirrors toggleStar/toggleConstellation in rules.ts.
import type { DevotionModel, StarId } from "./types";
import type { ReachView } from "./reachability";
import { appT, type Text } from "./localization";

export type CommitTarget = { kind: "star" | "constellation"; id: string };
export interface CommitButton {
  label: Text;
  enabled: boolean;
}

export function commitButton(
  model: DevotionModel,
  selected: Set<StarId>,
  reach: ReachView,
  target: CommitTarget,
): CommitButton {
  if (target.kind === "star") {
    if (selected.has(target.id)) return { label: appT("ui.commit.remove"), enabled: true };
    return { label: appT("ui.commit.add"), enabled: reach.reachableStars.has(target.id) };
  }
  const con = model.constellations.get(target.id);
  const starIds = con?.starIds ?? [];
  // Mirror toggleConstellation (all-in / all-out): any selected star means the button clears the
  // constellation; otherwise it adds the whole thing, gated by completable.
  if (starIds.some((id) => selected.has(id))) return { label: appT("ui.commit.remove"), enabled: true };
  return { label: appT("ui.commit.add"), enabled: reach.completable.has(target.id) };
}
