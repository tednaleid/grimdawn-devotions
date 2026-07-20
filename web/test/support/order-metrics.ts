// ABOUTME: Build-order quality metrics shared by the corpus pins and the offline harness: scaffold
// ABOUTME: churn (points on non-crossroads scaffolds bought then refunded) for an emitted schedule.
import type { BuildStep } from "../../src/core/reachability";

/** Points spent on non-crossroads scaffolds: the churn the ordering should avoid. Crossroads are
 *  free by definition (the objective is zero when a build bootstraps from crossroads alone). */
export function churnPoints(steps: BuildStep[]): number {
  let pts = 0;
  for (const s of steps) if (s.kind === "scaffold-add" && !s.conId.startsWith("crossroads_")) pts += s.points;
  return pts;
}
