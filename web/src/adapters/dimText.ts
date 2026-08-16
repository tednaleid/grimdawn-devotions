// ABOUTME: Renders a dim explanation (DimReport) and affinity deficits as localized text lines, shared by
// ABOUTME: the star and constellation tooltips, the points bar, and the build-order panel's empty state.
import type { AffinityDeficit, DimReport } from "../core/dimReasons";
import type { DevotionModel } from "../core/types";
import { AFFINITIES } from "../core/types";
import type { Localization } from "../ports/Localization";

function conNames(loc: Localization, model: DevotionModel, ids: string[]): string {
  return ids
    .map((id) => model.constellations.get(id))
    .filter((c) => c !== undefined)
    .map((c) => loc.gameText(c.nameTag))
    .join(", ");
}

// "20 more Ascendant for Oleron and 7 more Order for Oleron" from the per-color deficits.
export function deficitPhrase(loc: Localization, model: DevotionModel, deficit: AffinityDeficit[]): string {
  const parts = deficit.map((d) => {
    const affinity = loc.translate(`aff.${AFFINITIES[d.color]!.toLowerCase()}`);
    return d.sources.length
      ? loc.translate("ui.buildOrder.deficitMoreFor", {
          count: d.count,
          affinity,
          names: conNames(loc, model, d.sources),
        })
      : loc.translate("ui.buildOrder.deficitMore", { count: d.count, affinity });
  });
  if (parts.length <= 1) return parts[0] ?? "";
  return `${parts.slice(0, -1).join(", ")}${loc.translate("ui.buildOrder.deficitJoin")}${parts[parts.length - 1]}`;
}

/** The reasons behind a dim verdict, one line each, without the points line (see dimLines). */
export function reasonLines(loc: Localization, model: DevotionModel, report: DimReport): string[] {
  const lines: string[] = [];
  if (report.deficit.length)
    lines.push(loc.translate("ui.tooltip.deficit", { deficit: deficitPhrase(loc, model, report.deficit) }));
  if (report.scaffolders.length)
    lines.push(loc.translate("ui.tooltip.scaffoldNeeders", { names: conNames(loc, model, report.scaffolders) }));
  return lines;
}

/** Points line first ("Needs N of your M points", or the plain "cannot" when no N was found), then the reasons. */
export function dimLines(loc: Localization, model: DevotionModel, report: DimReport, cap: number): string[] {
  const points =
    report.needs !== null
      ? loc.translate("ui.tooltip.needsPoints", { needs: report.needs, cap })
      : loc.translate("ui.tooltip.cannotComplete", { cap });
  return [points, ...reasonLines(loc, model, report)];
}
