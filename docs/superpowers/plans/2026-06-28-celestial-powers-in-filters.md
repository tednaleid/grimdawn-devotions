# Celestial Powers in Benefit Filters Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make celestial-power effects participate in the benefit filters (a power that deals burn matches the Burn filter; resistance-reduction and crowd-control debuffs become filterable), split the sidebar into finer sections, and add a right-side list of still-pickable celestial powers.

**Architecture:** The hexagonal core stays pure. `core/aggregate.ts` matching scans `celestialPower.stats` in addition to `star.bonuses`. `core/statFormat.ts` gains curated subjects + new section groups for the debuff/CC/RR families. `core/urlState.ts` appends recognized power-only stat ids to the benefit vocabulary as a trailing block so old shared links keep decoding identically. The adapter (`sidebarView.ts`) and `app/main.ts` render the new right-side powers list and wire its hover.

**Tech Stack:** TypeScript, bun test, run via `just` recipes. Tests live in `web/test/*.test.ts` and import real data from `data/devotions.json`.

## Global Constraints

- Run everything through `just`: `just test [args]`, `just check` (fmt + test + lint + typecheck). Never call bun/biome/tsc directly.
- The in/out boundary for a power stat id joining the benefit vocabulary is exactly one rule: `groupFor(id) !== "Other"`. This drops the ability-meta bucket (cooldown, projectiles, radius, weapon %, healing, absorb) and keeps every damage/resist/attribute/debuff concept. Star-bonus "Other" ids are unaffected; only power "Other" ids are dropped.
- Power stats are NEVER summed into Benefits totals. `sumBonuses` stays bonus-only. The feature is matching/highlighting and the selectable catalog, not totals.
- Pet `attack_stats` from summon powers do NOT participate in filters (out of v1).
- URL state stays shareable: the benefit `b=` bitset must keep old links valid. New power-only tag ids are APPENDED after the existing player/pet/affinity blocks in `canonicalBenefitIds`, never inserted into `canonicalStatIds`.
- New code files start with two `// ABOUTME:` lines. No emojis/emdashes in docs.
- `StatGroup` is `(typeof GROUP_ORDER)[number]`. The final `GROUP_ORDER` is exactly: `["Attributes", "Offense", "Resistance Reduction", "Crowd Control", "Retaliation", "Resistances", "Status Protection", "Armor & Mitigation", "Other"]`. "Defense" is removed; the three defensive sections replace it.

---

### Task 1: Match celestial power stats in `starsGranting`

**Files:**
- Modify: `web/src/core/aggregate.ts:52-64` (the `starsGranting` function)
- Test: `web/test/aggregate.test.ts`

**Interfaces:**
- Consumes: `DevotionModel`, `StarId` (existing). `Star.celestialPower: CelestialPower | null` with `stats: Record<string, number>` and `pet: PetInfo | null` where `pet.attackStats: Record<string, number>` (see `web/src/core/types.ts`).
- Produces: `starsGranting(model, ids)` now also matches a star when one of `ids` is a key of that star's `celestialPower.stats`. Pet `attackStats` are NOT scanned.

- [ ] **Step 1: Write the failing tests**

Add to `web/test/aggregate.test.ts` (after the existing `starsGranting` tests, around line 78):

```ts
test("starsGranting matches a star whose celestial power grants the stat", () => {
  const bonusIds = new Set<string>();
  for (const s of model.stars.values()) for (const k of Object.keys(s.bonuses)) bonusIds.add(k);
  let powerStarId: string | undefined;
  let powerOnlyId: string | undefined;
  for (const s of model.stars.values()) {
    const p = s.celestialPower;
    if (!p) continue;
    const k = Object.keys(p.stats).find((key) => !bonusIds.has(key));
    if (k) {
      powerStarId = s.id;
      powerOnlyId = k;
      break;
    }
  }
  expect(powerOnlyId).toBeTruthy();
  const got = starsGranting(model, new Set([powerOnlyId!]));
  expect(got.has(powerStarId!)).toBe(true);
});

test("starsGranting ignores summon-pet attack stats", () => {
  let petPowerStarId: string | undefined;
  let attackOnlyId: string | undefined;
  for (const s of model.stars.values()) {
    const p = s.celestialPower;
    if (!p?.pet) continue;
    const k = Object.keys(p.pet.attackStats).find((key) => !(key in p.stats) && !(key in s.bonuses));
    if (k) {
      petPowerStarId = s.id;
      attackOnlyId = k;
      break;
    }
  }
  expect(attackOnlyId).toBeTruthy();
  // The pet-summoning star itself must NOT match on a stat only its pet's attack carries.
  expect(starsGranting(model, new Set([attackOnlyId!])).has(petPowerStarId!)).toBe(false);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `just test test/aggregate.test.ts -t "celestial power"`
Expected: the first test FAILS (`got.has(powerStarId)` is false, because `starsGranting` does not scan power stats yet).

- [ ] **Step 3: Implement the power-stat scan**

Replace `web/src/core/aggregate.ts:52-64` (the `starsGranting` function) with:

```ts
// The stars whose bonuses OR celestial power grant ANY of the given raw stat ids - used to highlight
// on the map where a selected benefit can still be picked up. A power's diamond star lights up when the
// filter matches its celestial power. Pet attack stats are intentionally not scanned. Empty for an empty set.
export function starsGranting(model: DevotionModel, ids: Set<string>): Set<StarId> {
  const out = new Set<StarId>();
  if (ids.size === 0) return out;
  for (const star of model.stars.values()) {
    let hit = false;
    for (const k of Object.keys(star.bonuses)) {
      if (ids.has(k)) {
        hit = true;
        break;
      }
    }
    if (!hit) {
      const power = star.celestialPower;
      if (power)
        for (const k of Object.keys(power.stats)) {
          if (ids.has(k)) {
            hit = true;
            break;
          }
        }
    }
    if (hit) out.add(star.id);
  }
  return out;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `just test test/aggregate.test.ts`
Expected: PASS (all aggregate tests, including the two new ones).

- [ ] **Step 5: Commit**

```bash
git add web/src/core/aggregate.ts web/test/aggregate.test.ts
git commit -m "feat(filters): match celestial power stats in starsGranting"
```

---

### Task 2: Split Defense into three sections + final GROUP_ORDER

**Files:**
- Modify: `web/src/core/statFormat.ts:226-236` (`GROUP_ORDER` + `groupFor`)
- Modify: `web/test/condense.test.ts:31-50`
- Modify: `web/test/statFormat.test.ts:135`
- Modify: `web/test/sidebar-benefits.test.ts:70`

**Interfaces:**
- Produces: `GROUP_ORDER` and `StatGroup` gain the new sections; `"Defense"` is gone. `groupFor(id)` routes defensive ids to `"Resistances"`, `"Status Protection"`, or `"Armor & Mitigation"`. Retaliation/RR/CC routing is NOT added here (Tasks 3-5); those families still fall to `"Offense"` for now, which is fine because nothing depends on their placement until later tasks.

- [ ] **Step 1: Update the existing tests to the new grouping (these are the failing tests)**

In `web/test/condense.test.ts`, change line 32:

```ts
  expect(groups.map((g) => g.group)).toEqual(["Attributes", "Offense", "Resistances"]);
```

and change line 47:

```ts
  const s = subj("Resistances", "Fire Resistance")!;
```

In `web/test/statFormat.test.ts`, change line 135:

```ts
    expect(groups.map((g) => g.group)).toEqual(["Attributes", "Offense", "Resistances", "Other"]);
```

In `web/test/sidebar-benefits.test.ts`, change line 70 (`group: "Defense"` in `petCat`) to:

```ts
    group: "Resistances",
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `just test test/condense.test.ts`
Expected: FAIL — `condensedRows` still returns group `"Defense"`, so the new expectations do not match.

- [ ] **Step 3: Implement the new GROUP_ORDER and Defense routing**

Replace `web/src/core/statFormat.ts:226-236` (from `export const GROUP_ORDER` through the end of `groupFor`) with:

```ts
// Display groups for the benefits sidebar, in render order. Offense-side debuff sections
// (Resistance Reduction, Crowd Control, Retaliation) and the three-way Defense split keep the
// high-value concepts from being buried in one giant section. Routing lives in groupFor.
export const GROUP_ORDER = [
  "Attributes",
  "Offense",
  "Resistance Reduction",
  "Crowd Control",
  "Retaliation",
  "Resistances",
  "Status Protection",
  "Armor & Mitigation",
  "Other",
] as const;
export type StatGroup = (typeof GROUP_ORDER)[number];

function groupFor(id: string): StatGroup {
  if (id === "racialBonusPercentDamage") return "Offense";
  if (id === "racialBonusPercentDefense") return "Armor & Mitigation";
  if (/^offensive|^retaliation/.test(id)) return "Offense";
  // Defensive split. Order matters: damage-type resistances first, then the
  // status/effect protections, then everything else defensive (armor, block, reflect).
  if (
    /^defensive(Physical|Pierce|Fire|Cold|Lightning|Aether|Chaos|Poison|Life|Bleeding)(MaxResist)?$/.test(id) ||
    id === "defensiveElementalResistance"
  )
    return "Resistances";
  if (/^defensive(Physical|Fire|Cold|Lightning|Poison|Life|Bleeding)Duration$/.test(id)) return "Status Protection";
  if (/^defensive(Stun|Freeze|Petrify|Trap|Disruption)$/.test(id)) return "Status Protection";
  if (id === "defensiveTotalSpeedResistance" || /^defensiveSlow(Life|Mana)Leach/.test(id)) return "Status Protection";
  if (/^defensive/.test(id)) return "Armor & Mitigation";
  if (/^character/.test(id)) return "Attributes";
  return "Other";
}
```

- [ ] **Step 4: Run the full suite to verify pass + catch any other group-literal break**

Run: `just test`
Expected: PASS. If any other test references the old `"Defense"` group literal, update that literal to the section the stat now belongs to (Resistances for damage-type resistances, Status Protection for reduced-duration/leech/slow-resistance, Armor & Mitigation for armor/block/reflect/racial-defense). Re-run until green.

- [ ] **Step 5: Commit**

```bash
git add web/src/core/statFormat.ts web/test/condense.test.ts web/test/statFormat.test.ts web/test/sidebar-benefits.test.ts
git commit -m "feat(filters): split Defense into Resistances / Status Protection / Armor & Mitigation"
```

---

### Task 3: Retaliation section + retaliation debuff labels

**Files:**
- Modify: `web/src/core/statFormat.ts` (`OVERRIDES` ~line 66-127, `classify` retaliation branch ~line 179-182, `groupFor`)
- Test: `web/test/condense.test.ts`

**Interfaces:**
- Consumes: `GROUP_ORDER` includes `"Retaliation"` (Task 2).
- Produces: every `retaliation*` id routes to `"Retaliation"`. `retaliationFireModifier` labels as `"Fire Retaliation"` (percent). `retaliationDamagePct` and `retaliationFear{Min,Chance}` get OVERRIDES so they collapse to one subject each (`"% Retaliation added to Attack"` and `"Fear"`). Existing per-type retaliation labels (`retaliationChaosMin` -> `"Chaos Retaliation"`) keep working via the existing classify branch and `decompose`'s fallback.

- [ ] **Step 1: Write the failing tests**

Add to `web/test/condense.test.ts` (at the end of the file):

```ts
test("retaliation stats group under Retaliation and collapse by concept", () => {
  const g = condensedRows({
    retaliationFireMin: 100,
    retaliationFireModifier: 20,
    retaliationDamagePct: 17,
    retaliationFearMin: 3,
    retaliationFearChance: 70,
  });
  const ret = g.find((x) => x.group === "Retaliation");
  expect(ret).toBeTruthy();
  const subjects = ret!.subjects.map((s) => s.subject).sort();
  expect(subjects).toContain("Fire Retaliation");
  expect(subjects).toContain("% Retaliation added to Attack");
  expect(subjects).toContain("Fear");
  // Fire flat + Fire % collapse onto one subject; Fear min + chance onto one.
  const fire = ret!.subjects.find((s) => s.subject === "Fire Retaliation")!;
  expect(fire.parts.map((p) => p.dim).sort()).toEqual(["flat", "pct"]);
  const fear = ret!.subjects.find((s) => s.subject === "Fear")!;
  expect(fear.parts.length).toBe(2);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `just test test/condense.test.ts -t "retaliation"`
Expected: FAIL — retaliation still groups under Offense and `retaliationFireModifier`/`retaliationDamagePct`/`retaliationFear*` produce ugly split subjects.

- [ ] **Step 3a: Route retaliation to its own section**

In `web/src/core/statFormat.ts` `groupFor`, replace the line:

```ts
  if (/^offensive|^retaliation/.test(id)) return "Offense";
```

with:

```ts
  if (/^retaliation/.test(id)) return "Retaliation";
  if (/^offensive/.test(id)) return "Offense";
```

- [ ] **Step 3b: Handle the retaliation percent modifier in `classify`**

In `web/src/core/statFormat.ts` `classify`, replace the retaliation branch (currently around lines 179-182):

```ts
  // Retaliation damage: retaliation<Type>[Min|Max]
  if ((m = id.match(/^retaliation([A-Za-z]+?)(Min|Max)?$/))) {
    const type = INSTANT_DAMAGE[m[1]!];
    if (type) return { label: `${type} Retaliation`, percent: false, sign: 1 };
  }
```

with:

```ts
  // Retaliation damage: retaliation<Type>[Modifier|Min|Max]. Modifier is the percent form.
  if ((m = id.match(/^retaliation([A-Za-z]+?)(Modifier|Min|Max)?$/))) {
    const type = INSTANT_DAMAGE[m[1]!];
    if (type) return { label: `${type} Retaliation`, percent: m[2] === "Modifier", sign: 1 };
  }
```

- [ ] **Step 3c: Add OVERRIDES for the remaining retaliation debuffs**

In `web/src/core/statFormat.ts`, add these entries inside the `OVERRIDES` object (next to the existing `retaliationTotalDamageModifier` entry around line 102):

```ts
  retaliationDamagePct: { label: "% Retaliation added to Attack", percent: true, sign: 1 },
  retaliationFearMin: { label: "Fear", percent: false, sign: 1 },
  retaliationFearChance: { label: "Fear", percent: true, sign: 1 },
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `just test test/condense.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/core/statFormat.ts web/test/condense.test.ts
git commit -m "feat(filters): Retaliation section + retaliation debuff labels"
```

---

### Task 4: Resistance Reduction section + concepts

**Files:**
- Modify: `web/src/core/statFormat.ts` (`groupFor`, `decompose` ~line 450-476)
- Test: `web/test/condense.test.ts`

**Interfaces:**
- Consumes: `GROUP_ORDER` includes `"Resistance Reduction"` (Task 2). `decompose` already computes `const group = groupFor(id)` and uses it.
- Produces: `groupFor` routes resistance-reduction ids to `"Resistance Reduction"`. `decompose` returns four distinct subjects (percent vs flat kept separate because they stack differently in game): `"Reduced target's Resistances"` (flat all), `"Reduced target's Elemental Resistances (flat)"`, `"Reduced target's Elemental Resistances"` (percent), `"Reduced target's Physical Resistance"`. The percent-elemental subject label is unchanged from the existing OVERRIDE so the Viper row keeps its name.

- [ ] **Step 1: Write the failing test**

Add to `web/test/condense.test.ts` (at the end of the file):

```ts
test("resistance reduction stats group under Resistance Reduction with distinct flat/percent subjects", () => {
  const g = condensedRows({
    offensiveTotalResistanceReductionAbsoluteMin: 24,
    offensiveTotalResistanceReductionAbsoluteDurationMin: 1,
    offensiveElementalResistanceReductionAbsoluteMin: 32,
    offensiveElementalResistanceReductionPercentMin: 20,
    offensivePhysicalReductionPercentMin: 18,
  });
  const rr = g.find((x) => x.group === "Resistance Reduction");
  expect(rr).toBeTruthy();
  const subjects = rr!.subjects.map((s) => s.subject).sort();
  expect(subjects).toEqual([
    "Reduced target's Elemental Resistances",
    "Reduced target's Elemental Resistances (flat)",
    "Reduced target's Physical Resistance",
    "Reduced target's Resistances",
  ]);
  // The flat all-res subject carries its magnitude (flat) and a duration facet.
  const all = rr!.subjects.find((s) => s.subject === "Reduced target's Resistances")!;
  expect(all.parts.map((p) => p.dim).sort()).toEqual(["durFlat", "flat"]);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `just test test/condense.test.ts -t "resistance reduction"`
Expected: FAIL — these ids still group under Offense and split into raw humanized subjects.

- [ ] **Step 3a: Route resistance reduction in `groupFor`**

In `web/src/core/statFormat.ts` `groupFor`, add these two lines immediately BEFORE the `if (/^offensive/.test(id)) return "Offense";` line:

```ts
  if (/ResistanceReduction/.test(id) || /^offensivePhysicalReductionPercent/.test(id)) return "Resistance Reduction";
```

(Note: `offensiveTotalDamageReductionPercent*` deliberately does NOT match here - it has "DamageReduction", not "ResistanceReduction" - so it stays out of this section and lands in Crowd Control in Task 5.)

- [ ] **Step 3b: Add decompose branches for the RR subjects**

In `web/src/core/statFormat.ts` `decompose`, add these branches immediately BEFORE the final fallback `return { group, subject: c.label, dim: c.percent ? "pct" : "flat" };`:

```ts
  // Resistance reduction: flat and percent are distinct subjects (they stack differently in game).
  if (id.match(/^offensiveTotalResistanceReductionAbsolute(Duration)?Min$/))
    return { group, subject: "Reduced target's Resistances", dim: /Duration/.test(id) ? "durFlat" : "flat" };
  if (id.match(/^offensiveElementalResistanceReductionAbsolute(Duration)?Min$/))
    return { group, subject: "Reduced target's Elemental Resistances (flat)", dim: /Duration/.test(id) ? "durFlat" : "flat" };
  if (id.match(/^offensiveElementalResistanceReductionPercent(Duration)?Min$/))
    return { group, subject: "Reduced target's Elemental Resistances", dim: /Duration/.test(id) ? "durFlat" : "pct" };
  if (id.match(/^offensivePhysicalReductionPercent(Duration)?Min$/))
    return { group, subject: "Reduced target's Physical Resistance", dim: /Duration/.test(id) ? "durFlat" : "pct" };
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `just test test/condense.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/core/statFormat.ts web/test/condense.test.ts
git commit -m "feat(filters): Resistance Reduction section + curated subjects"
```

---

### Task 5: Crowd Control section + concepts

**Files:**
- Modify: `web/src/core/statFormat.ts` (`groupFor`, `decompose`)
- Test: `web/test/condense.test.ts`

**Interfaces:**
- Consumes: `GROUP_ORDER` includes `"Crowd Control"` (Task 2).
- Produces: `groupFor` routes the CC families to `"Crowd Control"`. `decompose` returns curated subjects: Stun, Freeze, Petrify, Knockdown, Confusion, Fumble, Impaired Aim, Slow target's Movement/Total Speed/Attack Speed, Reduced target's Offensive Ability, Reduced target's Defensive Ability, Reduced target's Damage. Each effect's magnitude + chance/duration facets collapse to one subject.

- [ ] **Step 1: Write the failing test**

Add to `web/test/condense.test.ts` (at the end of the file):

```ts
test("crowd-control stats group under Crowd Control with one subject per effect", () => {
  const g = condensedRows({
    offensiveStunMin: 1,
    offensiveStunChance: 50,
    offensiveFreezeMin: 1,
    offensiveFreezeChance: 50,
    offensiveSlowDefensiveAbilityMin: 150,
    offensiveSlowDefensiveAbilityDurationMin: 5,
    offensiveSlowRunSpeedMin: 45,
    offensiveSlowRunSpeedDurationMin: 3,
    offensiveTotalDamageReductionPercentMin: 15,
    offensiveProjectileFumbleMin: 30,
  });
  const cc = g.find((x) => x.group === "Crowd Control");
  expect(cc).toBeTruthy();
  const subjects = cc!.subjects.map((s) => s.subject).sort();
  expect(subjects).toEqual([
    "Impaired Aim",
    "Reduced target's Damage",
    "Reduced target's Defensive Ability",
    "Slow target's Movement",
    "Stun",
    "Freeze",
  ].sort());
  // Stun's magnitude (flat) and chance (pct) collapse onto one subject.
  const stun = cc!.subjects.find((s) => s.subject === "Stun")!;
  expect(stun.parts.map((p) => p.dim).sort()).toEqual(["flat", "pct"]);
});

test("DoT damage stays in Offense, not Crowd Control (offensiveSlowFire is Burn)", () => {
  const g = condensedRows({ offensiveSlowFireMin: 100, offensiveSlowFireDurationMin: 3 });
  expect(g.find((x) => x.group === "Offense")?.subjects.map((s) => s.subject)).toContain("Burn");
  expect(g.find((x) => x.group === "Crowd Control")).toBeUndefined();
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `just test test/condense.test.ts -t "crowd-control"`
Expected: FAIL — CC families still group under Offense as raw split subjects.

- [ ] **Step 3a: Route the CC families in `groupFor`**

In `web/src/core/statFormat.ts` `groupFor`, add this line immediately AFTER the Resistance Reduction line from Task 4 and BEFORE `if (/^offensive/.test(id)) return "Offense";`:

```ts
  if (
    /^offensive(Stun|Freeze|Petrify|Knockdown|Confusion|Fumble|ProjectileFumble|SlowRunSpeed|SlowTotalSpeed|SlowAttackSpeed|SlowOffensiveAbility|SlowDefensiveAbility|TotalDamageReductionPercent)/.test(
      id,
    )
  )
    return "Crowd Control";
```

- [ ] **Step 3b: Add decompose branches for the CC subjects**

In `web/src/core/statFormat.ts` `decompose`, add these branches immediately AFTER the Resistance Reduction branches from Task 4 (still before the final fallback):

```ts
  // Crowd control: a status effect (magnitude Min + a Chance facet).
  let cc: RegExpMatchArray | null;
  if ((cc = id.match(/^offensive(Stun|Freeze|Petrify|Knockdown|Confusion)(Chance)?(Min|Max)?$/)))
    return { group, subject: cc[1]!, dim: cc[2] ? "pct" : "flat" };
  if (id.match(/^offensiveFumble(Duration)?Min$/))
    return { group, subject: "Fumble", dim: /Duration/.test(id) ? "durFlat" : "flat" };
  if (id.match(/^offensiveProjectileFumble(Duration)?Min$/))
    return { group, subject: "Impaired Aim", dim: /Duration/.test(id) ? "durFlat" : "flat" };
  if (id.match(/^offensiveSlowRunSpeed(Duration)?Min$/))
    return { group, subject: "Slow target's Movement", dim: /Duration/.test(id) ? "durFlat" : "pct" };
  if (id.match(/^offensiveSlowTotalSpeed(Duration)?Min$/))
    return { group, subject: "Slow target's Total Speed", dim: /Duration/.test(id) ? "durFlat" : "pct" };
  if (id.match(/^offensiveSlowAttackSpeed(Duration)?Min$/))
    return { group, subject: "Slow target's Attack Speed", dim: /Duration/.test(id) ? "durFlat" : "pct" };
  if (id.match(/^offensiveSlowOffensiveAbility(Duration)?Min$/))
    return { group, subject: "Reduced target's Offensive Ability", dim: /Duration/.test(id) ? "durFlat" : "flat" };
  if (id.match(/^offensiveSlowDefensiveAbility(Duration)?Min$/))
    return { group, subject: "Reduced target's Defensive Ability", dim: /Duration/.test(id) ? "durFlat" : "flat" };
  if (id.match(/^offensiveTotalDamageReductionPercent(Duration)?Min$/))
    return { group, subject: "Reduced target's Damage", dim: /Duration/.test(id) ? "durFlat" : "pct" };
```

- [ ] **Step 4: Run the full suite to verify pass (and Burn still in Offense)**

Run: `just test`
Expected: PASS, including the new CC tests and the DoT-stays-in-Offense guard.

- [ ] **Step 5: Commit**

```bash
git add web/src/core/statFormat.ts web/test/condense.test.ts
git commit -m "feat(filters): Crowd Control section + curated subjects"
```

---

### Task 6: Power-stat vocabulary + catalog + URL round-trip

**Files:**
- Modify: `web/src/core/statFormat.ts` (export `isFilterableStat`)
- Modify: `web/src/core/urlState.ts` (`canonicalPowerStatIds`, extend `canonicalBenefitIds`)
- Modify: `web/src/app/main.ts` (catalog input includes power ids)
- Test: `web/test/statFormat.test.ts`, `web/test/urlState.test.ts`

**Interfaces:**
- Consumes: `groupFor` routing from Tasks 2-5 (so `isFilterableStat` agrees with the sections).
- Produces:
  - `statFormat.ts`: `export function isFilterableStat(id: string): boolean` returning `groupFor(id) !== "Other"`.
  - `urlState.ts`: `export function canonicalPowerStatIds(model: DevotionModel): string[]` — recognized (`isFilterableStat`) power stat ids NOT already in `canonicalStatIds`, sorted. `canonicalBenefitIds` appends this block LAST.
  - `main.ts`: `benefitCatalog` is built over the union of `statCanonical` and `canonicalPowerStatIds(model)`.

- [ ] **Step 1: Write the failing tests**

Add `isFilterableStat` to the existing `../src/core/statFormat` import at the top of `web/test/statFormat.test.ts` (lines 4-11) - do NOT add a second import statement (Biome flags duplicate import sources). Then add to the end of the file:

```ts
describe("isFilterableStat: the in/out boundary for power stats", () => {
  test("recognized damage/debuff stats are filterable", () => {
    expect(isFilterableStat("offensiveStunMin")).toBe(true);
    expect(isFilterableStat("offensiveTotalResistanceReductionAbsoluteMin")).toBe(true);
    expect(isFilterableStat("offensiveColdMax")).toBe(true);
  });
  test("ability-meta stats are NOT filterable (group Other)", () => {
    expect(isFilterableStat("skillCooldownTime")).toBe(false);
    expect(isFilterableStat("projectileLaunchNumber")).toBe(false);
    expect(isFilterableStat("weaponDamagePct")).toBe(false);
    expect(isFilterableStat("skillTargetRadius")).toBe(false);
    expect(isFilterableStat("damageAbsorption")).toBe(false);
  });
});
```

Add `canonicalPowerStatIds` to the existing `../src/core/urlState` import on line 6 of `web/test/urlState.test.ts` (do NOT add a second import statement). The test reuses the module-level `model` (line 8), `canonical` (line 9), and `statCanonical` (line 10) already defined there. Add to the end of the file:

```ts
test("canonicalPowerStatIds: recognized power-only stat ids, excluding bonuses and meta", () => {
  const ids = canonicalPowerStatIds(model);
  const bonusIds = new Set(statCanonical);
  expect(ids).toContain("offensiveStunMin");
  expect(ids.every((id) => !bonusIds.has(id))).toBe(true);
  expect(ids).not.toContain("skillCooldownTime");
});

test("a power-only benefit tag round-trips through the URL without disturbing old positions", () => {
  const benefitCanonical = canonicalBenefitIds(model);
  const tag = "offensiveStunMin"; // a power-only tag (appended block)
  const hash = encodeHash(new Set(), 55, canonical, new Set([tag]), benefitCanonical);
  const decoded = decodeHash(`#${hash}`, canonical, benefitCanonical);
  expect(decoded!.benefits.has(tag)).toBe(true);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `just test test/statFormat.test.ts -t "isFilterableStat"`
Expected: FAIL — `isFilterableStat` is not exported yet.

- [ ] **Step 3a: Export `isFilterableStat` from statFormat**

In `web/src/core/statFormat.ts`, add immediately after the `groupFor` function:

```ts
/** Whether a raw stat id belongs in the benefit filter vocabulary: any group except "Other".
 *  Used to admit recognized celestial-power stats and exclude ability-meta (cooldown, projectiles, etc.). */
export function isFilterableStat(id: string): boolean {
  return groupFor(id) !== "Other";
}
```

- [ ] **Step 3b: Add `canonicalPowerStatIds` and extend `canonicalBenefitIds`**

In `web/src/core/urlState.ts`, add the statFormat import at the top (next to the existing `./types` import):

```ts
import { isFilterableStat } from "./statFormat";
```

Add this function after `canonicalPetStatIds` (around line 27):

```ts
/**
 * Recognized celestial-power stat ids that are NOT already player-bonus ids. These extend the benefit
 * vocabulary so powers' debuff/CC/RR subjects become filterable. "Other" (ability-meta) ids are excluded.
 */
export function canonicalPowerStatIds(model: DevotionModel): string[] {
  const bonus = new Set(canonicalStatIds(model));
  const set = new Set<string>();
  for (const s of model.stars.values()) {
    const p = s.celestialPower;
    if (!p) continue;
    for (const k of Object.keys(p.stats)) if (!bonus.has(k) && isFilterableStat(k)) set.add(k);
  }
  return [...set].sort();
}
```

Replace `canonicalBenefitIds` (lines 45-51) with:

```ts
export function canonicalBenefitIds(model: DevotionModel): string[] {
  return [
    ...canonicalStatIds(model),
    ...canonicalPetStatIds(model).map((id) => `pet:${id}`),
    ...canonicalAffinityIds(),
    ...canonicalPowerStatIds(model), // appended LAST so older player/pet/affinity payloads decode unchanged
  ];
}
```

- [ ] **Step 3c: Include power ids in the benefit catalog**

In `web/src/app/main.ts`, find the catalog construction (around lines 80-82):

```ts
  const allBonuses: Record<string, number> = {};
  for (const id of statCanonical) allBonuses[id] = 1;
  const benefitCatalog = condensedRows(allBonuses);
```

Replace it with:

```ts
  const allBonuses: Record<string, number> = {};
  for (const id of statCanonical) allBonuses[id] = 1;
  for (const id of canonicalPowerStatIds(model)) allBonuses[id] = 1;
  const benefitCatalog = condensedRows(allBonuses);
```

Ensure `canonicalPowerStatIds` is imported in `main.ts` from `../core/urlState` (add it to the existing `urlState` import line that already brings in `canonicalStatIds`, `canonicalBenefitIds`, etc.).

- [ ] **Step 4: Run the tests + full suite**

Run: `just test`
Expected: PASS, including the new statFormat and urlState tests.

- [ ] **Step 5: Commit**

```bash
git add web/src/core/statFormat.ts web/src/core/urlState.ts web/src/app/main.ts web/test/statFormat.test.ts web/test/urlState.test.ts
git commit -m "feat(filters): admit recognized power stats to the benefit vocabulary + catalog"
```

---

### Task 7: Available-to-get power stats + `availablePowers`

**Files:**
- Modify: `web/src/core/aggregate.ts` (`availableBonusIds` ~line 89-102; add `availablePowers`)
- Test: `web/test/aggregate.test.ts`

**Interfaces:**
- Consumes: `isFilterableStat` from `statFormat.ts`; `reach.completable: Set<string>` (constellation ids) from `reachabilityForSelection`.
- Produces:
  - `availableBonusIds` also adds recognized power stat ids of unselected stars in completable constellations.
  - `export function availablePowers(model: DevotionModel, selected: Set<StarId>, completable: Set<string>): { starId: StarId; power: CelestialPower }[]` — power stars in completable, not-yet-complete constellations (power star unselected).

- [ ] **Step 1: Write the failing tests**

Add to `web/test/aggregate.test.ts` (extend the import on line 6-15 to also import `availablePowers`):

```ts
test("availableBonusIds includes recognized power stats of unselected stars in completable cons", () => {
  // Find a constellation whose power grants a recognized stat that no star bonus in that con grants.
  let conId: string | undefined;
  let powerStat: string | undefined;
  for (const c of model.constellations.values()) {
    const bonusIds = bonusIdsOf(c.starIds);
    for (const sid of c.starIds) {
      const p = model.stars.get(sid)!.celestialPower;
      if (!p) continue;
      const k = Object.keys(p.stats).find((key) => !bonusIds.has(key) && /^offensive|^defensive|^character|^retaliation/.test(key));
      if (k) {
        conId = c.id;
        powerStat = k;
        break;
      }
    }
    if (conId) break;
  }
  expect(powerStat).toBeTruthy();
  const got = availableBonusIds(model, new Set(), new Set([conId!]));
  expect(got.has(powerStat!)).toBe(true);
});

test("availablePowers lists completable, not-yet-gained powers and excludes gained ones", () => {
  const bat = conByName("Bat");
  const powerStar = bat.starIds.map((id) => model.stars.get(id)!).find((s) => s.celestialPower)!;
  // Not selected -> listed.
  const avail = availablePowers(model, new Set(), new Set([bat.id]));
  expect(avail.map((p) => p.starId)).toContain(powerStar.id);
  expect(avail.find((p) => p.starId === powerStar.id)!.power.name).toBe(powerStar.celestialPower!.name);
  // Power star selected (gained) -> excluded.
  const gained = availablePowers(model, new Set([powerStar.id]), new Set([bat.id]));
  expect(gained.map((p) => p.starId)).not.toContain(powerStar.id);
  // Not completable -> excluded.
  expect(availablePowers(model, new Set(), new Set()).length).toBe(0);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `just test test/aggregate.test.ts -t "availablePowers"`
Expected: FAIL — `availablePowers` is not defined.

- [ ] **Step 3a: Extend `availableBonusIds` to include power stats**

In `web/src/core/aggregate.ts`, add the statFormat import at the top (next to the `./types` import):

```ts
import { isFilterableStat } from "./statFormat";
```

In `availableBonusIds` (around line 89-102), inside the `for (const sid of con.starIds)` loop, after the existing `for (const k of Object.keys(star.bonuses)) out.add(k);` line, add:

```ts
      const power = star.celestialPower;
      if (power) for (const k of Object.keys(power.stats)) if (isFilterableStat(k)) out.add(k);
```

- [ ] **Step 3b: Add `availablePowers`**

In `web/src/core/aggregate.ts`, add after `availablePetKeys` (around line 120):

```ts
// The celestial powers still validly pickable from the current selection: the power star of every
// completable constellation whose power is not already gained (its power star not yet selected).
// Drives the right-side "Celestial Powers" list. `completable` comes from reachabilityForSelection.
export function availablePowers(
  model: DevotionModel,
  selected: Set<StarId>,
  completable: Set<string>,
): { starId: StarId; power: CelestialPower }[] {
  const out: { starId: StarId; power: CelestialPower }[] = [];
  for (const conId of completable) {
    const con = model.constellations.get(conId);
    if (!con) continue;
    for (const sid of con.starIds) {
      const star = model.stars.get(sid);
      if (star?.celestialPower && !selected.has(sid)) out.push({ starId: sid, power: star.celestialPower });
    }
  }
  return out;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `just test test/aggregate.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/core/aggregate.ts web/test/aggregate.test.ts
git commit -m "feat(filters): available power stats + availablePowers for the right panel"
```

---

### Task 8: Right-side "Celestial Powers" list + hover

**Files:**
- Modify: `web/src/adapters/sidebarView.ts` (extract `powersListHtml`, reuse on the left)
- Modify: `web/src/app/main.ts` (render the right list; share the power-hover handler)
- Test: `web/test/sidebar-benefits.test.ts`

**Interfaces:**
- Consumes: `availablePowers` (Task 7); `CelestialPower`, `StarId` types.
- Produces: `export function powersListHtml(powers: { starId: StarId; power: CelestialPower }[]): string` in `sidebarView.ts`, returning the same `<div class="power" data-star-id="...">name</div>` markup the left panel uses. `main.ts` renders a `Celestial Powers` section into `affinityEl` and attaches the existing power-hover behavior to `affinityEl`.

- [ ] **Step 1: Write the failing test**

Add `powersListHtml` to the existing `../src/adapters/sidebarView` import on line 4 of `web/test/sidebar-benefits.test.ts` (the line that already imports `renderBenefits`; do NOT add a second import statement). Then add to the end of the file:

```ts
test("powersListHtml renders each power with its star-id hook and name", () => {
  const powers = [
    { starId: "bat:4", power: { name: "Twin Fangs", description: "x", proc: null, level: 1, stats: {}, pet: null } },
  ];
  const html = powersListHtml(powers as any);
  expect(html).toContain('data-star-id="bat:4"');
  expect(html).toContain("Twin Fangs");
  expect(html).toContain('class="power"');
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `just test test/sidebar-benefits.test.ts -t "powersListHtml"`
Expected: FAIL — `powersListHtml` is not exported.

- [ ] **Step 3a: Extract `powersListHtml` in sidebarView and reuse it on the left**

In `web/src/adapters/sidebarView.ts`, add the `CelestialPower` type to the existing `../core/types` import (it currently imports `Affinity`, `DevotionModel`, `StarId`):

```ts
import { AFFINITIES, type Affinity, type CelestialPower, type DevotionModel, type StarId } from "../core/types";
```

Add this exported helper near the top of the file (after the imports, before `changeClass`):

```ts
// One row per celestial power: the name plus a data-star-id hook so a hover shows the power's full
// tooltip (proc, level, stats, requires/grants). Shared by the left "gained" list and the right
// "still pickable" list.
export function powersListHtml(powers: { starId: StarId; power: CelestialPower }[]): string {
  return powers.map((p) => `<div class="power" data-star-id="${p.starId}">${p.power.name}</div>`).join("");
}
```

In `renderBenefits`, replace the existing `powerRows` definition (currently around line 148):

```ts
  const powerRows = powers.map((p) => `<div class="power" data-star-id="${p.starId}">${p.power.name}</div>`).join("");
```

with:

```ts
  const powerRows = powersListHtml(powers);
```

- [ ] **Step 3b: Render the right-side list and share the hover handler in main.ts**

In `web/src/app/main.ts`, add `availablePowers` to the existing `../core/aggregate` import, and `powersListHtml` to the existing `../adapters/sidebarView` import.

Find the existing benefits-panel power-hover handler (lines 229-243) and refactor it into a shared named handler attached to BOTH panels. Replace:

```ts
  benefitsEl.addEventListener("mousemove", (e) => {
    const sid = (e.target as Element)?.closest?.(".power[data-star-id]")?.getAttribute("data-star-id");
    if (sid)
      tip.show(
        model,
        sid,
        (e as MouseEvent).clientX,
        (e as MouseEvent).clientY,
        affinityTotals(model, state.selected),
        undefined,
        selectedBenefits,
      );
    else tip.hide();
  });
  benefitsEl.addEventListener("mouseleave", () => tip.hide());
```

with:

```ts
  // A hovered power row (left "gained" list or right "still pickable" list) shows the power's full
  // tooltip - the same rich tooltip as its map star. Attached to both sidebar containers; both survive
  // innerHTML re-renders because the listener is on the container, not the rows.
  const powerRowHover = (e: Event) => {
    const sid = (e.target as Element)?.closest?.(".power[data-star-id]")?.getAttribute("data-star-id");
    if (sid)
      tip.show(
        model,
        sid,
        (e as MouseEvent).clientX,
        (e as MouseEvent).clientY,
        affinityTotals(model, state.selected),
        undefined,
        selectedBenefits,
      );
    else tip.hide();
  };
  benefitsEl.addEventListener("mousemove", powerRowHover);
  affinityEl.addEventListener("mousemove", powerRowHover);
  benefitsEl.addEventListener("mouseleave", () => tip.hide());
  affinityEl.addEventListener("mouseleave", () => tip.hide());
```

Then, in the `refresh()` function where the right panel's "Available to get" lists are appended to `affinityEl` (around lines 467-471, after the `petAvailHtml` block), add:

```ts
    const availPowers = availablePowers(model, state.selected, reach.completable);
    if (availPowers.length)
      affinityEl.insertAdjacentHTML("beforeend", `<hr class="panel-sep"/><h2>Celestial Powers</h2>${powersListHtml(availPowers)}`);
```

- [ ] **Step 4: Run the test + build the site to verify it renders**

Run: `just test test/sidebar-benefits.test.ts`
Expected: PASS.

Run: `just build`
Expected: builds `web/dist` with no error (confirms `main.ts` type-checks and bundles).

- [ ] **Step 5: Commit**

```bash
git add web/src/adapters/sidebarView.ts web/src/app/main.ts web/test/sidebar-benefits.test.ts
git commit -m "feat(filters): right-side still-pickable Celestial Powers list with hover"
```

---

### Task 9: Backlog the deferred items + full verification

**Files:**
- Modify: `BACKLOG.md`
- Modify: `web/test/aggregate.test.ts:1-2` (ABOUTME line, mention `availablePowers`)

**Interfaces:** none (documentation + verification).

- [ ] **Step 1: Record the deferred items in BACKLOG.md**

Add this section to `BACKLOG.md` (under an appropriate spot near the other filter items):

```markdown
## Celestial powers in filters: deferred follow-ups

Shipped: celestial-power stats participate in benefit filters (match the power's
diamond star), curated debuff/CC/RR subjects, finer sidebar sections, and a
right-side still-pickable Celestial Powers list. See
`docs/superpowers/specs/2026-06-28-celestial-powers-in-filters-design.md`.

Deferred:
- Pet attack-stat filtering: a summon power's pet `attack_stats` (the summoned
  creature's own damage) do not match damage filters. Would need a decision on
  whether they map to the player damage filters or the `pet:` namespace.
- Narrow the right-side Celestial Powers list by the active benefit filter (show
  only still-pickable powers whose stats match). Currently filter-independent,
  mirroring the "Available to get" list. Pointer: `availablePowers` +
  `taggedStars`/`selectedBenefits` in `main.ts`.
- Finer Attributes section: ~7 of the Attributes subjects are weapon/armor
  requirement reductions that could split into their own subsection.
- Distinct map treatment for a power match vs a bonus match (today both reuse the
  benefit-match highlight on the diamond).
```

- [ ] **Step 2: Update the aggregate test ABOUTME**

In `web/test/aggregate.test.ts`, update line 1-2 to mention the new function:

```ts
// ABOUTME: Tests for aggregate.ts -- sumBonuses, sumPetBonuses, powersGained, weaponRequirements,
// ABOUTME: starsGranting (bonuses + powers), starsGrantingPet, availableBonusIds, availablePetKeys, availablePowers.
```

- [ ] **Step 3: Check for any evergreen doc that documents the benefit sections/filters**

Run: `grep -rl "Available to get\|benefit filter\|GROUP_ORDER\|Resistance Reduction" docs/*.md`
If any top-level evergreen doc (not under `docs/superpowers/` or `docs/specs/`) describes the benefit sidebar sections or filter behavior, update it in place to reflect that powers now participate and the new section taxonomy. If none, skip (the dated spec is the record).

- [ ] **Step 4: Full verification gate**

Run: `just check`
Expected: PASS (fmt-check, all tests, lint with `--error-on-warnings`, typecheck).

- [ ] **Step 5: Manual smoke (optional but recommended)**

Run: `just serve`, open `http://localhost:5173`. Verify: the Benefits/Available panels show the new sections (Resistance Reduction, Crowd Control, Retaliation, Resistances, Status Protection, Armor & Mitigation); selecting a debuff filter (e.g. Stun) highlights power diamonds on the map; the right panel shows a "Celestial Powers" list whose rows show a description tooltip on hover.

- [ ] **Step 6: Commit**

```bash
git add BACKLOG.md web/test/aggregate.test.ts
git commit -m "docs(filters): backlog deferred celestial-power filter follow-ups"
```

---

## Notes for the implementer

- `decompose` already computes `const group = groupFor(id)` at its top and returns that `group`, so the new decompose branches only need to return the right `subject` and `dim` - the section comes from `groupFor` automatically. Keep `groupFor` and `decompose` in agreement.
- None of the ~16 new debuff/CC/RR concepts appear as star bonuses (by construction they are power-only, except the percent-elemental RR that Viper already grants). So they never appear in the summed "Benefits" totals - only in the catalog/Available lists - and their `classify` value formatting is not user-visible. Curation effort is in `decompose` (subject + group) and `groupFor` (routing), not `classify`.
- The celestial-power TOOLTIP is rendered by `formatPowerStats` (already curated, unchanged). This plan does not touch it.
