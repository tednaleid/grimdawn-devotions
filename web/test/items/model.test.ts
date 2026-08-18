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
  const raw = doc as any;

  expect(c.items.length).toBeGreaterThan(2000);
  expect(c.skills.length).toBeGreaterThan(200);
  expect(c.masteries.length).toBe(10);

  // Field-by-field cross-check against the raw snake_case source, for every record of every
  // shape - not hand-written expected values, so this stays correct as the data changes and
  // catches any mapper that mis-keys, hardcodes, or swaps a field. In particular it pins
  // uiX/uiY (Task 15 lays the skill tree out from exactly these two fields) and nodeKind
  // (a hardcoded "base" would be invisible on any base-node fixture).
  expect(c.masteries.length).toBe(raw.masteries.length);
  c.masteries.forEach((m, i) => {
    expect(m.record).toBe(raw.masteries[i].record);
    expect(m.nameTag).toBe(raw.masteries[i].name_tag);
  });

  expect(c.skills.length).toBe(raw.skills.length);
  c.skills.forEach((s, i) => {
    const r = raw.skills[i];
    expect(s.record).toBe(r.record);
    expect(s.mastery).toBe(r.mastery);
    expect(s.group).toBe(r.group);
    expect(s.nodeKind).toBe(r.node_kind);
    expect(s.uiX).toBe(r.ui_x);
    expect(s.uiY).toBe(r.ui_y);
    expect(s.nameTag).toBe(r.name_tag);
    expect(s.icon).toBe(r.icon);
    expect(s.maxLevel).toBe(r.max_level);
    expect(s.ultimateLevel).toBe(r.ultimate_level);
  });

  expect(c.items.length).toBe(raw.items.length);
  c.items.forEach((it, i) => {
    const r = raw.items[i];
    expect(it.record).toBe(r.record);
    expect(it.nameTag).toBe(r.name_tag);
    expect(it.domain).toBe(r.domain);
    expect(it.rarity).toBe(r.rarity);
    expect(it.itemLevel).toBe(r.item_level);
    expect(it.grimtools).toBe(r.grimtools);

    expect(it.boosts.length).toBe(r.boosts.length);
    it.boosts.forEach((b, j) => {
      expect(b.skill).toBe(r.boosts[j].skill);
      expect(b.level).toBe(r.boosts[j].level);
    });

    expect(it.masteryBoosts.length).toBe(r.mastery_boosts.length);
    it.masteryBoosts.forEach((mb, j) => {
      expect(mb.mastery).toBe(r.mastery_boosts[j].mastery);
      expect(mb.level).toBe(r.mastery_boosts[j].level);
    });
  });

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
