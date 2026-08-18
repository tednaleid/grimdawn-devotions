// ABOUTME: Tests the skill-items catalogue loader maps the committed snake_case JSON to camelCase.
// ABOUTME: Pins the one documented exception: ModBlock.stats stays raw snake_case (see model.ts).
import { test, expect } from "bun:test";
import { parseCatalogue } from "../../src/items/core/model";
import doc from "../../../data/skill-items.json";

test("maps snake_case to camelCase and tolerates a short doc", () => {
  const c = parseCatalogue({
    items: [
      {
        record: "r",
        item_level: 94,
        name_tag: "t",
        domain: "gear",
        slots: ["medal"],
        rarity: "Legendary",
        tiers: [],
        grimtools: null,
        boosts: [],
        mastery_boosts: [],
        modifiers: [],
      },
    ],
  });
  expect(c.items[0]!.itemLevel).toBe(94);
  expect(c.items[0]!.masteryBoosts).toEqual([]);
  expect(c.skills).toEqual([]);
});

test("throws only on a non-object", () => {
  expect(() => parseCatalogue(null)).toThrow();
});

test("a from_tag survives parseCatalogue unrenamed", () => {
  const c = parseCatalogue({
    items: [
      {
        record: "r",
        name_tag: null,
        domain: "gear",
        slots: [],
        rarity: "Legendary",
        item_level: 1,
        tiers: [],
        grimtools: null,
        boosts: [],
        mastery_boosts: [],
        modifiers: [
          {
            skill: "s",
            stats: [
              {
                stat: "conversionPercentageFireToPhysical",
                value: 50,
                from_tag: "DamageFire",
                to_tag: "DamagePhysical",
              },
            ],
          },
        ],
      },
    ],
  });
  const stat = c.items[0]!.modifiers[0]!.stats[0]! as unknown as Record<string, unknown>;
  expect(stat.from_tag).toBe("DamageFire");
  expect(stat.to_tag).toBe("DamagePhysical");
  expect(stat.fromTag).toBeUndefined();
});

test("parses the committed catalogue", () => {
  const c = parseCatalogue(doc);
  expect(c.items.length).toBeGreaterThan(2000);
  expect(c.skills.length).toBeGreaterThan(200);
  expect(c.masteries.length).toBe(10);

  const medal = c.items.find((i) => i.record.endsWith("c010_medal.dbr"));
  expect(medal?.itemLevel).toBe(94);
  expect(medal?.rarity).toBe("Legendary");
  expect(medal?.boosts.length).toBe(4);
  const cadenceBlock = medal?.modifiers.find((m) => m.skill.endsWith("cadence1.dbr"));
  const refreshStat = cadenceBlock?.stats.find((s) => s.stat === "refreshCooldownAmount") as
    | Record<string, unknown>
    | undefined;
  expect(refreshStat?.refresh_skill).toBe("records/skills/playerclass10/leap1.dbr");
  expect(refreshStat?.refresh_trigger).toBe("AttackEnemy");
});
