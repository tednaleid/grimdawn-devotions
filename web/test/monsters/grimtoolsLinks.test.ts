// ABOUTME: Tests the grimtools id matcher: difficulty variants, inline tie-breaks, and misses.
// ABOUTME: The matcher is pure; scripts/gt_monster_links.ts feeds it grimtools' monsterdb.js.
import { test, expect } from "bun:test";
import { matchLinks, grimtoolsMonsterUrl, type GtMonster, type LinkRow } from "../../src/monsters/core/grimtoolsLinks";
import { DAMAGE_TYPES } from "../../src/monsters/core/facets";
import type { Resistances } from "../../src/monsters/core/model";

const Z = Object.fromEntries(DAMAGE_TYPES.map((t) => [t, 0])) as Resistances;
const ALL = ["normal", "elite", "ultimate", "ascendant"] as const;
const row = (over: Partial<LinkRow> = {}): LinkRow => ({
  id: "r",
  nameTag: "tagX",
  classification: "SuperBoss",
  inline: { ...Z },
  ...over,
});
const gt = (over: Partial<GtMonster> = {}): GtMonster => ({
  id: 1,
  nameTag: "tagX",
  classification: "SuperBoss",
  difficulties: [...ALL],
  inline: { ...Z },
  ...over,
});

test("difficulty variants map each difficulty to its own entry", () => {
  const { links } = matchLinks(
    [row()],
    [
      gt({ id: 363, difficulties: ["normal", "elite"] }),
      gt({ id: 364, difficulties: ["ultimate"] }),
      gt({ id: 3843, difficulties: ["ascendant"] }),
    ],
  );
  expect(links.r).toEqual({ normal: 363, elite: 363, ultimate: 364, ascendant: 3843 });
});

test("several candidates: the one whose inline values equal the row's wins", () => {
  const rows = [row({ id: "rev0" }), row({ id: "rev33", inline: { ...Z, pierce: 33 } })];
  const { links } = matchLinks(rows, [
    gt({ id: 249 }),
    gt({ id: 339, inline: { ...Z, pierce: 33 } }),
    gt({ id: 444, inline: { ...Z, pierce: 33 } }),
  ]);
  expect(links.rev0!.ultimate).toBe(249);
  expect(links.rev33!.ultimate).toBe(339);
});

test("no inline match among candidates falls back to the lowest id", () => {
  const { links } = matchLinks([row({ inline: { ...Z, fire: 5 } })], [gt({ id: 20 }), gt({ id: 10 })]);
  expect(links.r!.normal).toBe(10);
});

test("classification must match, and a row with no candidates is reported unmatched", () => {
  const { links, unmatched } = matchLinks([row()], [gt({ classification: "Boss" })]);
  expect(links.r).toBeUndefined();
  expect(unmatched).toEqual(["r"]);
});

test("the url is the monsterdb page", () => {
  expect(grimtoolsMonsterUrl(364)).toBe("https://www.grimtools.com/monsterdb/364");
});
