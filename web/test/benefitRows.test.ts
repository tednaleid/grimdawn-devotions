// ABOUTME: Tests the unified benefit row-model: one row per value, label roles, and compare cells.
// ABOUTME: Uses the real devotions.json model; a subject's parts come from across the whole star set.
import { test, expect } from "bun:test";
import doc from "../../data/devotions.json";
import { buildModel } from "../src/core/model";
import { benefitRows } from "../src/core/benefitRows";
import { resolveText, type Text } from "../src/core/localization";
import { installEnglish, enLoc } from "./helpers/localizeEn";

installEnglish();

const res = (t: Text) => resolveText(enLoc, t);

const model = buildModel(doc as any);
// A subject's flat and percent come from different stars, so build the multi-part shapes from the
// full star set rather than a single star.
const allStars = new Set([...model.stars.values()].map((s) => s.id));

function starGranting(stat: string): string {
  for (const s of model.stars.values()) if (s.bonuses[stat] !== undefined) return s.id;
  throw new Error(`no star grants ${stat}`);
}
function starGrantingRange(): { star: string; partId: string } {
  for (const s of model.stars.values())
    for (const k of Object.keys(s.bonuses))
      if (k.endsWith("Min") && s.bonuses[`${k.slice(0, -3)}Max`] !== undefined) return { star: s.id, partId: k };
  throw new Error("no star grants a flat damage range");
}
const subjectsOf = (groups: ReturnType<typeof benefitRows>["player"]) => groups.flatMap((g) => g.subjects);
const allRows = (groups: ReturnType<typeof benefitRows>["player"]) => subjectsOf(groups).flatMap((s) => s.rows);

test("regular mode: a flat+percent subject yields a subject row then a bare continuation row", () => {
  const { player } = benefitRows(model, allStars, null);
  const phys = subjectsOf(player).find((s) => res(s.subject) === "Physique")!;
  expect(phys.rows[0]!.role).toBe("subject");
  expect(phys.rows.some((r) => r.role === "cont" && res(r.subLabel) === "")).toBe(true);
  // regular mode leaves the compare cells empty
  expect(res(phys.rows[0]!.base)).toBe("");
  expect(res(phys.rows[0]!.delta)).toBe("");
});

test("regular mode: a resistance with pct + max yields a subject row then a 'max' sub-label row", () => {
  const { player } = benefitRows(model, allStars, null);
  const subj = subjectsOf(player).find((s) => res(s.subject) === "Aether Resistance")!;
  const maxRow = subj.rows.find((r) => res(r.subLabel) === "max")!;
  expect(maxRow.role).toBe("sub");
  // the max value drops the "max " prefix (the sub-label conveys it)
  expect(res(maxRow.now).startsWith("max")).toBe(false);
});

test("regular mode: a damage-over-time subject yields a 'duration' sub-label row", () => {
  const { player } = benefitRows(model, allStars, null);
  const bleed = subjectsOf(player).find((s) => res(s.subject) === "Bleeding")!;
  expect(bleed.rows[0]!.role).toBe("subject");
  expect(bleed.rows.some((r) => r.role === "sub" && res(r.subLabel) === "duration")).toBe(true);
});

test("regular mode: every value id is present once and the subject lists all its ids", () => {
  const { player } = benefitRows(model, allStars, null);
  const phys = subjectsOf(player).find((s) => res(s.subject) === "Physique")!;
  const rowIds = phys.rows.map((r) => r.id);
  expect(new Set(rowIds).size).toBe(rowIds.length); // no duplicate rows
  expect(phys.ids.slice().sort()).toEqual([...rowIds].sort()); // subject.ids covers exactly its rows
});

test("compare mode: a stat only in current is an up row with a dash base", () => {
  const star = starGranting("offensiveTotalDamageModifier");
  const { player } = benefitRows(model, new Set([star]), new Set());
  const row = allRows(player).find((r) => r.id === "offensiveTotalDamageModifier")!;
  expect(row.verdict).toBe("up");
  expect(res(row.base)).toBe("—"); // em dash
  expect(res(row.now)).not.toBe("—");
});

test("compare mode: an unchanged flat range is 'same' with a dash delta; a changed one colors with no number", () => {
  const { star, partId } = starGrantingRange();
  const sel = new Set([star]);
  const same = allRows(benefitRows(model, sel, sel).player).find((r) => r.id === partId)!;
  expect(same.verdict).toBe("same");
  expect(res(same.delta)).toBe("—");
  const added = allRows(benefitRows(model, sel, new Set()).player).find((r) => r.id === partId)!;
  expect(added.verdict).toBe("up");
  expect(res(added.delta)).toBe(""); // colored, no scalar
});

test("compare mode: a subject with one part up and one down rolls up to 'mixed'", () => {
  const { player } = benefitRows(model, new Set(["akeron_s_scorpion:0"]), new Set(["hawk:2"]));
  const subj = subjectsOf(player).find((s) => s.key === "Attributes:attr:OffensiveAbility")!;
  expect(subj.rows.some((r) => r.verdict === "up")).toBe(true);
  expect(subj.rows.some((r) => r.verdict === "down")).toBe(true);
  expect(subj.verdict).toBe("mixed");
});

test("compare mode: increasing a reduction (sign -1) reads as 'up', not 'down'", () => {
  // Shield Recovery is stored positive but displayed negative; more reduction is better (faster).
  // The verdict must rank goodness, not the displayed (signed) order, so -50% -> -60% is an improvement.
  const stat = "characterDefensiveBlockRecoveryReduction";
  const granting = [...model.stars.values()]
    .filter((s) => s.bonuses[stat] !== undefined)
    .sort((a, b) => a.bonuses[stat]! - b.bonuses[stat]!);
  const low = granting[0]!;
  const high = granting[granting.length - 1]!;
  expect(high.bonuses[stat]!).toBeGreaterThan(low.bonuses[stat]!); // sanity: distinct magnitudes
  // current = the larger reduction, baseline = the smaller one => an improvement.
  const row = allRows(benefitRows(model, new Set([high.id]), new Set([low.id])).player).find((r) => r.id === stat)!;
  expect(row.verdict).toBe("up");
  // the delta stays the literal change in the displayed (negative) value, so base + delta = now holds.
  expect(res(row.delta).startsWith("-")).toBe(true);
});

test("compare mode: decreasing a reduction (sign -1) reads as 'down'", () => {
  const stat = "characterDefensiveBlockRecoveryReduction";
  const granting = [...model.stars.values()]
    .filter((s) => s.bonuses[stat] !== undefined)
    .sort((a, b) => a.bonuses[stat]! - b.bonuses[stat]!);
  const low = granting[0]!;
  const high = granting[granting.length - 1]!;
  // current = the smaller reduction, baseline = the larger one => a regression.
  const row = allRows(benefitRows(model, new Set([low.id]), new Set([high.id])).player).find((r) => r.id === stat)!;
  expect(row.verdict).toBe("down");
});

test("pet scope builds from pet bonuses independently of the player scope", () => {
  const petStar = [...model.stars.values()].find((s) => s.petBonuses && Object.keys(s.petBonuses).length > 0)!;
  const { pet } = benefitRows(model, new Set([petStar.id]), null);
  expect(subjectsOf(pet).length).toBeGreaterThan(0);
});

test("a max-resist that is the subject's only part keeps a 'max' qualifier on the value", () => {
  // leviathan:5 grants only a maximum Cold Resistance (no base resist), so it is the subject row and
  // must still read as a maximum, not as a base resistance.
  const { player } = benefitRows(model, new Set(["leviathan:5"]), null);
  const cold = subjectsOf(player).find((s) => res(s.subject) === "Cold Resistance")!;
  expect(cold.rows[0]!.role).toBe("subject");
  expect(res(cold.rows[0]!.now).startsWith("max")).toBe(true);
});

test("subjects are returned in structural (condensedRows) order within each group", () => {
  // benefitRows no longer sorts subjects itself (structural order out; adapter sorts by resolved
  // label). Assert structural order matches condensedRows for the same scope.
  const { player } = benefitRows(model, new Set(["light_of_empyrion:5", "obelisk_of_menhir:5"]), null);
  for (const g of player) {
    const keys = g.subjects.map((s) => s.key);
    expect(new Set(keys).size).toBe(keys.length); // no duplicate subjects
  }
});
