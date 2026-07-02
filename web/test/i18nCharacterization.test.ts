// ABOUTME: Characterization snapshot for the i18n hexagonal boundary refactor: resolves every core
// ABOUTME: text surface for a representative selection under en and zh; output must never change.
import { expect, test } from "bun:test";
import devotions from "../../data/devotions.json";
import appEn from "../src/i18n/app.en.json";
import appZh from "../src/i18n/app.zh.json";
import gameEn from "../../data/i18n/game.en.json";
import gameZh from "../../data/i18n/game.zh.json";
import { buildModel, type DevotionsDoc } from "../src/core/model";
import { makeLocalization, setLocalization } from "../src/core/localization";
import type { Localization } from "../src/ports/Localization";
import { formatBonusRowsWithIds, formatPowerStats, formatPet, condensedRows } from "../src/core/statFormat";
import { benefitRows } from "../src/core/benefitRows";
import { commitButton } from "../src/core/commitAction";
import { sumBonuses, sumPetBonuses, racialTargets } from "../src/core/aggregate";
import { buildOrderHtml } from "../src/adapters/buildOrderView";
import type { StarId } from "../src/core/types";

const model = buildModel(devotions as unknown as DevotionsDoc);

// Constellations chosen to touch every formatting path: power with durations/CC
// (akeron_s_scorpion), max-resist (abomination), weapon requirement (berserker),
// pet summon power (bysmiel_s_bonds), pet bonuses (crane), racial target (gallows).
const CONS = ["akeron_s_scorpion", "abomination", "berserker", "bysmiel_s_bonds", "crane", "gallows"];
const selection = new Set<StarId>(CONS.flatMap((c) => model.constellations.get(c)!.starIds));
const baseline = new Set<StarId>(model.constellations.get("crane")!.starIds);

const enLoc = makeLocalization(appEn, appEn, "en", gameEn, gameEn);
const zhLoc = makeLocalization(appZh as Record<string, string>, appEn, "zh", gameZh as Record<string, string>, gameEn);

// commitButton only reads clickable/completable from ReachView; a minimal stand-in avoids the engine.
function partialReach(completable: Set<string>) {
  return {
    completable,
    clickable: new Set<string>(),
    have: [0, 0, 0, 0, 0],
    need: [0, 0, 0, 0, 0],
    needSource: new Map(),
  } as import("../src/core/reachability").ReachView;
}

// Resolves every core text surface to plain strings. Stage 1: formatters read the
// singleton, so install loc first. Later tasks change HOW this resolves (resolveText
// over descriptors), never WHAT it returns.
function collectSurfaces(loc: Localization): unknown {
  setLocalization(loc);
  const racial = racialTargets(model, selection);
  const perStar: Record<string, unknown> = {};
  for (const sid of selection) {
    const star = model.stars.get(sid)!;
    const entry: Record<string, unknown> = {
      bonuses: formatBonusRowsWithIds(star.bonuses, { racialTarget: star.racialTarget }),
    };
    if (star.celestialPower) {
      entry.power = formatPowerStats(star.celestialPower.stats);
      if (star.celestialPower.pet) entry.pet = formatPet(star.celestialPower.pet);
    }
    perStar[sid] = entry;
  }
  return {
    condensed: condensedRows(sumBonuses(model, selection), { racialTarget: racial }),
    condensedPet: condensedRows(sumPetBonuses(model, selection)),
    benefitRowsRegular: benefitRows(model, selection, null),
    benefitRowsCompare: benefitRows(model, selection, baseline),
    perStar,
    commit: [
      commitButton(model, selection, partialReach(new Set(CONS)), { kind: "constellation", id: "crane" }),
      commitButton(model, new Set(), partialReach(new Set()), { kind: "constellation", id: "crane" }),
    ],
    buildOrder: buildOrderHtml(model, null, [
      { kind: "scaffold-add", conId: "crossroads_order", points: 1, heldAfter: 1 },
      { kind: "complete", conId: "crane", points: 6, heldAfter: 7 },
      { kind: "scaffold-refund", conId: "crossroads_order", points: -1, heldAfter: 6 },
    ]),
    buildOrderEmpty: buildOrderHtml(model, null, null, { kind: "incomplete", deficit: [3, 0, 0, 1, 0] }),
  };
}

test("characterization: en surfaces are stable", () => {
  expect(JSON.parse(JSON.stringify(collectSurfaces(enLoc)))).toMatchSnapshot();
});
test("characterization: zh surfaces are stable", () => {
  expect(JSON.parse(JSON.stringify(collectSurfaces(zhLoc)))).toMatchSnapshot();
});
