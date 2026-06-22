# Pet-Bonus Filtering Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make pet bonuses first-class taggable benefits with full parity to player benefits (map highlight plus their own "Available to get" list), without changing the data model.

**Architecture:** A benefit tag becomes a scoped key in the existing `selectedBenefits: Set<string>`: a player bonus stays its bare stat id, a pet bonus is prefixed `pet:<statId>`. Pet bonuses then flow through the same catalog, tag, highlight, and availability pipeline, distinguished only by the prefix. The pet bonus map (`star.petBonuses`) is untouched.

**Tech Stack:** bun + TypeScript, hexagonal layering (`web/src/core` pure, `web/src/adapters` DOM/IO, `web/src/app/main.ts` wiring), `bun:test`, raw-CDP e2e (`web/e2e/smoke.ts`).

## Global Constraints

- No data-model change: `Star.bonuses` (player) and `Star.petBonuses` (pet) stay as they are.
- Scoped tag key: player = bare stat id (e.g. `defensiveElementalResistance`); pet = `pet:<statId>` (e.g. `pet:defensiveElementalResistance`).
- URL round-trips and stays backward compatible: an old player-only `b=` link must decode to the same player tags (CLAUDE.md shareable-URL invariant).
- TDD: write the failing test first; inner loop is `bun test test/<file>` run from `web/`; gates are `just check` (test + lint + typecheck) and `just e2e`.
- One map `.match` style for v1; no distinct pet-highlight color.
- Commit per task. No AI co-author trailer in commits. No emoji, emdash, or hyperbole in docs.
- Do not push until Ted asks.
- New pet params are appended after `prevPet` in `renderBenefits` so the existing `main.ts` call keeps type-checking until the wiring task updates it.

---

### Task 1: `starsGrantingPet` (core)

**Files:**
- Modify: `web/src/core/aggregate.ts` (add export next to `starsGranting`)
- Test: `web/test/aggregate.test.ts`

**Interfaces:**
- Consumes: `DevotionModel`, `StarId` (already imported in the file).
- Produces: `starsGrantingPet(model: DevotionModel, ids: Set<string>): Set<StarId>` — the stars whose `petBonuses` include any of the given raw pet stat ids; empty for an empty set.

- [ ] **Step 1: Write the failing test** (append to `web/test/aggregate.test.ts`; add `starsGrantingPet` to the existing import from `../src/core/aggregate`)

```ts
test("starsGrantingPet returns exactly the stars whose petBonuses include an id", () => {
  const petStar = [...model.stars.values()].find((s) => s.petBonuses && Object.keys(s.petBonuses).length > 0)!;
  const id = Object.keys(petStar.petBonuses!)[0]!;
  let n = 0;
  for (const s of model.stars.values()) if (s.petBonuses && id in s.petBonuses) n++;
  const got = starsGrantingPet(model, new Set([id]));
  expect(got.size).toBe(n);
  for (const sid of got) expect(id in model.stars.get(sid)!.petBonuses!).toBe(true);
  expect(starsGrantingPet(model, new Set()).size).toBe(0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run (from `web/`): `bun test test/aggregate.test.ts`
Expected: FAIL — `Export named 'starsGrantingPet' not found`.

- [ ] **Step 3: Write minimal implementation** (in `web/src/core/aggregate.ts`, directly after `starsGranting`)

```ts
// Like starsGranting, but over pet bonuses: the stars whose petBonuses include any of the
// given raw pet stat ids. Used to highlight where a tagged pet benefit can be picked up.
export function starsGrantingPet(model: DevotionModel, ids: Set<string>): Set<StarId> {
  const out = new Set<StarId>();
  if (ids.size === 0) return out;
  for (const star of model.stars.values()) {
    const pet = star.petBonuses;
    if (!pet) continue;
    for (const k of Object.keys(pet)) {
      if (ids.has(k)) {
        out.add(star.id);
        break;
      }
    }
  }
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test test/aggregate.test.ts`
Expected: PASS (all tests in the file).

- [ ] **Step 5: Commit**

```bash
git add web/src/core/aggregate.ts web/test/aggregate.test.ts
git commit -m "feat(core): starsGrantingPet (stars granting a pet bonus)"
```

---

### Task 2: `availablePetKeys` (core)

**Files:**
- Modify: `web/src/core/aggregate.ts` (add export next to `availableBonusIds`)
- Test: `web/test/aggregate.test.ts`

**Interfaces:**
- Consumes: `DevotionModel`, `StarId`.
- Produces: `availablePetKeys(model, selected: Set<StarId>, completable: Set<string>): Set<string>` — `pet:`-prefixed keys for pet bonuses carried by not-yet-selected stars in completable constellations.

- [ ] **Step 1: Write the failing test** (append to `web/test/aggregate.test.ts`; add `availablePetKeys` to the import)

```ts
const conWithPet = () => [...model.constellations.values()].find((c) =>
  c.starIds.some((id) => { const p = model.stars.get(id)?.petBonuses; return p && Object.keys(p).length > 0; }))!;

test("availablePetKeys returns pet: keys for unselected stars' petBonuses in completable cons", () => {
  const con = conWithPet();
  const expected = new Set<string>();
  for (const sid of con.starIds) { const p = model.stars.get(sid)?.petBonuses; if (p) for (const k of Object.keys(p)) expected.add(`pet:${k}`); }
  const got = availablePetKeys(model, new Set(), new Set([con.id]));
  expect([...got].sort()).toEqual([...expected].sort());
  expect(availablePetKeys(model, new Set(), new Set()).size).toBe(0);
});

test("availablePetKeys skips already-selected stars", () => {
  const con = conWithPet();
  expect(availablePetKeys(model, new Set(con.starIds), new Set([con.id])).size).toBe(0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test test/aggregate.test.ts`
Expected: FAIL — `Export named 'availablePetKeys' not found`.

- [ ] **Step 3: Write minimal implementation** (in `web/src/core/aggregate.ts`, directly after `availableBonusIds`)

```ts
// The pet bonuses still obtainable from the current selection, as pet:-scoped tag keys: every
// petBonus carried by a not-yet-selected star inside a constellation that remains completable.
// Drives the pet "Available to get" list. `completable` comes from reachabilityForSelection.
export function availablePetKeys(
  model: DevotionModel,
  selected: Set<StarId>,
  completable: Set<string>,
): Set<string> {
  const out = new Set<string>();
  for (const conId of completable) {
    const con = model.constellations.get(conId);
    if (!con) continue;
    for (const sid of con.starIds) {
      if (selected.has(sid)) continue;
      const pet = model.stars.get(sid)?.petBonuses;
      if (!pet) continue;
      for (const k of Object.keys(pet)) out.add(`pet:${k}`);
    }
  }
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test test/aggregate.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/core/aggregate.ts web/test/aggregate.test.ts
git commit -m "feat(core): availablePetKeys (obtainable pet bonuses as pet: keys)"
```

---

### Task 3: pet + combined canonical id lists (core)

**Files:**
- Modify: `web/src/core/urlState.ts`
- Test: `web/test/urlState.test.ts`

**Interfaces:**
- Consumes: `DevotionModel`, existing `canonicalStatIds`, `encodeHash`, `decodeHash`.
- Produces:
  - `canonicalPetStatIds(model): string[]` — sorted raw pet stat ids across every `star.petBonuses`.
  - `canonicalBenefitIds(model): string[]` — `[...canonicalStatIds(model), ...canonicalPetStatIds(model).map(id => "pet:"+id)]`. This is the only list handed to the hash codec.

- [ ] **Step 1: Write the failing test** (append to `web/test/urlState.test.ts`; add `canonicalPetStatIds, canonicalBenefitIds` to the import)

```ts
test("canonicalBenefitIds keeps the player block first, then pet: ids", () => {
  const player = canonicalStatIds(model);
  const all = canonicalBenefitIds(model);
  expect(all.slice(0, player.length)).toEqual(player);
  expect(all.length).toBeGreaterThan(player.length);
  expect(all.slice(player.length).every((k) => k.startsWith("pet:"))).toBe(true);
});

test("an old player-only b= payload still decodes under the extended canonical", () => {
  const benefits = new Set([statCanonical[0]!, statCanonical[3]!]);
  const oldHash = encodeHash(new Set([canonical[0]!]), 30, canonical, benefits, statCanonical);
  const benefitCanonical = canonicalBenefitIds(model);
  const decoded = decodeHash(`#${oldHash}`, canonical, benefitCanonical)!;
  expect([...decoded.benefits].sort()).toEqual([...benefits].sort());
});

test("mixed player and pet tags round-trip via b=", () => {
  const benefitCanonical = canonicalBenefitIds(model);
  const petKey = benefitCanonical.find((k) => k.startsWith("pet:"))!;
  const benefits = new Set([statCanonical[0]!, petKey]);
  const hash = encodeHash(new Set([canonical[0]!]), 30, canonical, benefits, benefitCanonical);
  const decoded = decodeHash(`#${hash}`, canonical, benefitCanonical)!;
  expect([...decoded.benefits].sort()).toEqual([...benefits].sort());
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test test/urlState.test.ts`
Expected: FAIL — `Export named 'canonicalPetStatIds' not found`.

- [ ] **Step 3: Write minimal implementation** (in `web/src/core/urlState.ts`, directly after `canonicalStatIds`)

```ts
/** Stable ordering of every raw pet bonus stat id that appears anywhere in the model. */
export function canonicalPetStatIds(model: DevotionModel): string[] {
  const set = new Set<string>();
  for (const s of model.stars.values()) if (s.petBonuses) for (const k of Object.keys(s.petBonuses)) set.add(k);
  return [...set].sort();
}

/**
 * The benefit-tag ordering for the URL bitset: the player stat ids (unchanged positions) followed
 * by the pet stat ids, each prefixed `pet:`. Because the player block is unchanged, an old
 * player-only `b=` payload decodes identically; pet tags extend the bitset only when present.
 */
export function canonicalBenefitIds(model: DevotionModel): string[] {
  return [...canonicalStatIds(model), ...canonicalPetStatIds(model).map((id) => `pet:${id}`)];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test test/urlState.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/core/urlState.ts web/test/urlState.test.ts
git commit -m "feat(core): canonicalPetStatIds + canonicalBenefitIds (back-compat tag order)"
```

---

### Task 4: scoped sidebar render, interactive pet section, pet available list (adapter)

**Files:**
- Modify: `web/src/adapters/sidebarView.ts` (rewrite the body of `renderBenefits`)
- Test: `web/test/sidebar-benefits.test.ts`

**Interfaces:**
- Consumes: `condensedRows`, `CondensedGroup`, `CondensedSubject`, `CondensedPart`, `sumBonuses`, `sumPetBonuses`, `powersGained`, `racialTargets` (all already imported).
- Produces: new signature
  `renderBenefits(el, model, selected, prev?, selectedBenefits?, catalog?, availableIds?, prevPet?, petCatalog?: CondensedGroup[], availablePetKeys?: Set<string>): { bonuses; petBonuses; availHtml: string; petAvailHtml: string }`.
  Player tag keys are bare stat ids; pet chips/groups carry `data-vid`/`data-ids` of `pet:<id>`. `petAvailHtml` is the filtered pet "Available to get" list.

- [ ] **Step 1: Write the failing tests** (append to `web/test/sidebar-benefits.test.ts`; add imports `import doc from "../../data/devotions.json"; import { buildModel } from "../src/core/model";` and a real model)

```ts
const realModel = buildModel(doc as any);
const petStar = [...realModel.stars.values()].find((s) => s.petBonuses && Object.keys(s.petBonuses).length > 0)!;
const petCat: CondensedGroup[] = [{
  group: "Defense",
  subjects: [
    { subject: "Fire Resistance", key: "Defense:Fire Resistance", parts: [{ dim: "pct", value: "+10%", id: "defensiveFire" }] },
    { subject: "Cold Resistance", key: "Defense:Cold Resistance", parts: [{ dim: "pct", value: "+10%", id: "defensiveCold" }] },
  ],
}];
function petAvailOf(keys?: Set<string>, tags: Set<string> = new Set()): string {
  const el = { innerHTML: "" } as unknown as HTMLElement;
  return renderBenefits(el, emptyModel, new Set(), undefined, tags, [], undefined, undefined, petCat, keys).petAvailHtml;
}

test("the active 'Bonus to All Pets' section is taggable with pet: scoped ids", () => {
  const el = { innerHTML: "" } as unknown as HTMLElement;
  renderBenefits(el, realModel, new Set([petStar.id]), undefined, new Set(), [], undefined, undefined, [], undefined);
  const html = (el as unknown as { innerHTML: string }).innerHTML;
  expect(html).toContain("Bonus to All Pets");
  expect(html).toMatch(/data-vid="pet:/);
});

test("pet 'available to get' lists only obtainable pet subjects, keyed pet:", () => {
  const html = petAvailOf(new Set(["pet:defensiveFire"]));
  expect(html).toContain("Fire Resistance");
  expect(html).not.toContain("Cold Resistance");
  expect(html).toContain('data-ids="pet:defensiveFire"');
});

test("pet 'available to get' is empty when nothing is obtainable", () => {
  expect(petAvailOf(new Set())).toBe("");
});

test("a tagged pet subject stays listed even when it is no longer obtainable", () => {
  const html = petAvailOf(new Set(["pet:defensiveFire"]), new Set(["pet:defensiveCold"]));
  expect(html).toContain("Cold Resistance");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test test/sidebar-benefits.test.ts`
Expected: FAIL — `renderBenefits(...).petAvailHtml` is undefined (the active-pet test fails because pet chips are read-only with no `data-vid`).

- [ ] **Step 3: Write the implementation** — replace the whole `renderBenefits` function (current lines 24-114, the comment block through the closing `}` and `return`) with:

```ts
// Renders the Benefits panel: the subjects the current selection grants, with condensed values,
// and the read-only celestial powers and "Bonus to All Pets" sections (the pet section is now
// taggable too). The catalogs of benefits you could still pick up are returned as `availHtml`
// (player) and `petAvailHtml` (pet) rather than rendered here, so the caller places them under the
// Affinity panel on the right. Tag keys are scoped: player benefits use the bare stat id, pet
// benefits use `pet:<id>`, so a player tag and a pet tag of the same stat never collide.
export function renderBenefits(
  el: HTMLElement,
  model: DevotionModel,
  selected: Set<StarId>,
  prev?: Record<string, number>,
  selectedBenefits: Set<string> = new Set(),
  catalog: CondensedGroup[] = [],
  availableIds?: Set<string>,
  prevPet?: Record<string, number>,
  petCatalog: CondensedGroup[] = [],
  availablePetKeys?: Set<string>,
): { bonuses: Record<string, number>; petBonuses: Record<string, number>; availHtml: string; petAvailHtml: string } {
  const bonuses = sumBonuses(model, selected);
  const petBonuses = sumPetBonuses(model, selected);
  const powers = powersGained(model, selected);

  // A render scope (player or pet) over one catalog. keyOf namespaces a raw stat id into its tag
  // key (identity for player, "pet:"+id for pet). The scope closes over selectedBenefits for
  // selection state and over flashPrev/totals for the per-render change flash.
  function makeScope(
    keyOf: (id: string) => string,
    scopeCatalog: CondensedGroup[],
    flashPrev: Record<string, number> | undefined,
    totals: Record<string, number>,
  ) {
    const catIds = new Map<string, string[]>();
    for (const g of scopeCatalog) for (const s of g.subjects) catIds.set(s.key, s.parts.map((p) => p.id));
    const rawIds = (s: CondensedSubject) => catIds.get(s.key) ?? s.parts.map((p) => p.id);
    const keys = (s: CondensedSubject) => rawIds(s).map(keyOf);
    const gkey = (s: CondensedSubject) => keyOf(s.key);
    const groupSel = (s: CondensedSubject) => {
      const k = keys(s);
      return k.length > 0 && k.every((x) => selectedBenefits.has(x)) ? " gsel" : "";
    };
    const chip = (p: CondensedPart) =>
      `<span class="bchip${selectedBenefits.has(keyOf(p.id)) ? " vsel" : ""}${changeClass(flashPrev, p.id, totals)}" data-vid="${keyOf(p.id)}">${partText(p)}</span>`;
    // Active subject (with values): damage types split into damage/duration sub-rows.
    const activeSubject = (s: CondensedSubject) => {
      const open = `<div class="bgroup${groupSel(s)}" data-gkey="${gkey(s)}" data-ids="${keys(s).join(",")}">`;
      const main = s.parts.filter((p) => p.dim !== "durFlat" && p.dim !== "durPct");
      const dur = s.parts.filter((p) => p.dim === "durFlat" || p.dim === "durPct");
      if (dur.length) {
        return `${open}<div class="bsubj" data-gtoggle>${s.subject}</div>` +
          `<div class="bsub"><span class="blbl">damage</span><span class="bvals">${main.map(chip).join("")}</span></div>` +
          `<div class="bsub"><span class="blbl">duration</span><span class="bvals">${dur.map(chip).join("")}</span></div></div>`;
      }
      return `${open}<div class="bsingle"><span class="bsubj" data-gtoggle>${s.subject}</span><span class="bvals">${main.map(chip).join("")}</span></div></div>`;
    };
    return { keys, gkey, groupSel, activeSubject };
  }

  type Scope = ReturnType<typeof makeScope>;
  const player = makeScope((id) => id, catalog, prev, bonuses);
  const pet = makeScope((id) => `pet:${id}`, petCatalog, prevPet, petBonuses);

  // The benefits a selection grants, rendered as interactive value chips, per scope.
  const activeListHtml = (groups: CondensedGroup[], scope: Scope) =>
    groups.map((g) => `<h3>${g.group}</h3>${g.subjects.map(scope.activeSubject).join("")}`).join("");
  const activeKeysOf = (groups: CondensedGroup[]) => {
    const set = new Set<string>();
    for (const g of groups) for (const s of g.subjects) set.add(s.key);
    return set;
  };

  const activeGroups = condensedRows(bonuses, { racialTarget: racialTargets(model, selected) });
  const activeHtml = activeListHtml(activeGroups, player);
  const activeKeys = activeKeysOf(activeGroups);

  const petGroups = condensedRows(petBonuses);
  const petActiveHtml = activeListHtml(petGroups, pet);
  const petActiveKeys = activeKeysOf(petGroups);

  // "Available to get": inactive catalog subjects still obtainable (a key in availKeys) or tagged
  // (so a tag can always be cleared). availKeys undefined disables the filter (permissive path).
  const availListHtml = (scopeCatalog: CondensedGroup[], scope: Scope, scopeActiveKeys: Set<string>, availKeys: Set<string> | undefined) =>
    scopeCatalog.map((g) => {
      const subs = g.subjects
        .filter((s) => {
          if (scopeActiveKeys.has(s.key)) return false;
          const ks = scope.keys(s);
          const obtainable = availKeys === undefined || ks.some((k) => availKeys.has(k));
          return obtainable || ks.some((k) => selectedBenefits.has(k));
        })
        .map((s) => `<div class="bgroup avail${scope.groupSel(s)}" data-gkey="${scope.gkey(s)}" data-ids="${scope.keys(s).join(",")}"><span class="bsubj" data-gtoggle>${s.subject}</span></div>`)
        .join("");
      return subs ? `<h3>${g.group}</h3><div class="avail-list">${subs}</div>` : "";
    }).join("");

  const availHtml = availListHtml(catalog, player, activeKeys, availableIds);
  const petAvailHtml = availListHtml(petCatalog, pet, petActiveKeys, availablePetKeys);

  // data-star-id lets main.ts show the same rich tooltip as the power's map star on hover.
  const powerRows = powers.map((p) => `<div class="power" data-star-id="${p.starId}">${p.power.name}</div>`).join("");

  el.innerHTML =
    `<h2>Benefits</h2>${activeHtml || '<div class="bempty">Select stars to gain benefits.</div>'}` +
    (petActiveHtml ? `<h2 class="avail-head">Bonus to All Pets</h2>${petActiveHtml}` : "") +
    (powers.length ? `<h3>Celestial Powers</h3>${powerRows}` : "");
  // availHtml and petAvailHtml are returned, not rendered here - the caller places them under the
  // Affinity panel on the right.
  return { bonuses, petBonuses, availHtml, petAvailHtml };
}
```

Note: this removes the old standalone `subjectIds`, `groupSel`, `chip`, `activeSubject`, `obtainable`, `tagged`, `petChip`, and `petHtml` bindings (they are subsumed by `makeScope` and the two list helpers). Keep the file's `changeClass` and `partText` helpers above the function as they are.

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test test/sidebar-benefits.test.ts`
Expected: PASS (the four new tests plus the existing player ones, which are unchanged because the player markup is byte-identical).

- [ ] **Step 5: Run the full unit gate to confirm no regression**

Run (from repo root): `just check`
Expected: all tests pass, lint and typecheck clean. (`main.ts` still type-checks: its 8-argument call leaves `petCatalog`/`availablePetKeys` defaulted.)

- [ ] **Step 6: Commit**

```bash
git add web/src/adapters/sidebarView.ts web/test/sidebar-benefits.test.ts
git commit -m "feat(web): scoped benefit render; taggable pets + pet 'Available to get'"
```

---

### Task 5: wire pets into the app and prove it end to end

**Files:**
- Modify: `web/src/app/main.ts`
- Modify: `web/e2e/smoke.ts`

**Interfaces:**
- Consumes: `starsGrantingPet`, `availablePetKeys` (Task 1, 2); `canonicalPetStatIds`, `canonicalBenefitIds` (Task 3); the new `renderBenefits` signature and `petAvailHtml` (Task 4).
- Produces: the running app tags pet bonuses, highlights their granting stars, lists a pet "Available to get", and round-trips pet tags in the URL.

- [ ] **Step 1: Write the failing e2e assertions** — in `web/e2e/smoke.ts`, immediately after the line `check(availWithBudget > 0, ...)` (the player "Available to get" budget check), insert:

```ts
  // Pet bonuses have their own "Available to get" list and, when tagged, highlight the stars that
  // grant them as a pet bonus (a pet: tag must hit petBonuses, not player bonuses).
  check(await cdp.evaluate<boolean>(
    `(document.getElementById('affinity')?.textContent||'').includes('Bonus to All Pets') && !!document.querySelector('#affinity .bgroup.avail[data-ids^="pet:"]')`),
    "pet 'Bonus to All Pets' available list is present");
  await cdp.evaluate(
    `(() => { const g = [...document.querySelectorAll('#affinity .bgroup.avail')].find(d => (d.getAttribute('data-ids')||'').startsWith('pet:')); g.querySelector('[data-gtoggle]').dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true})); })()`);
  let petMatched = false;
  for (let i = 0; i < 20; i++) {
    await Bun.sleep(100);
    if ((await cdp.evaluate<number>("document.querySelectorAll('.star.match').length")) > 0) { petMatched = true; break; }
  }
  check(petMatched, "tagging a pet bonus highlights the stars that grant it as a pet bonus");
  // Clear the pet tag so the later 'empties once spent' assertion sees a clean filter.
  await cdp.evaluate(
    `(() => { const g = document.querySelector('#affinity .bgroup.avail.gsel[data-ids^="pet:"]'); if (g) g.querySelector('[data-gtoggle]').dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true})); })()`);
```

- [ ] **Step 2: Run e2e to verify it fails**

Run (from repo root): `just e2e`
Expected: FAIL — "pet 'Bonus to All Pets' available list is present" fails (the app does not yet pass `petCatalog`/`availablePetKeys`).

- [ ] **Step 3: Wire `main.ts`** — apply these edits:

(a) Imports:

```ts
import { starsGranting, availableBonusIds, starsGrantingPet, availablePetKeys } from "../core/aggregate";
import { canonicalStarIds, canonicalStatIds, canonicalPetStatIds, canonicalBenefitIds, decodeHash, encodeHash } from "../core/urlState";
```

and add `StarId` to the types import:

```ts
import type { Affinity, SelectionState, StarId } from "../core/types";
```

(b) Replace the canonical/restore lines (currently `const statCanonical = canonicalStatIds(model);` and the `decodeHash(location.hash, canonical, statCanonical)` call) with:

```ts
  const statCanonical = canonicalStatIds(model);
  const benefitCanonical = canonicalBenefitIds(model);
  const restored = decodeHash(location.hash, canonical, benefitCanonical);
```

(c) After the player catalog (`const benefitCatalog = condensedRows(allBonuses);`), add the pet catalog:

```ts
  // The pet benefit catalog (every pet subject + its stat ids), for the pet "Available to get"
  // list. Static per model, computed once. Pet stat ids are raw here; the renderer scopes them.
  const allPetBonuses: Record<string, number> = {};
  for (const id of canonicalPetStatIds(model)) allPetBonuses[id] = 1;
  const petCatalog = condensedRows(allPetBonuses);
```

(d) Add a tagged-stars helper (place it next to `flashEl`, inside `boot`):

```ts
  // The map stars to emphasize for the current benefit tags: bare keys scan player bonuses,
  // pet: keys scan pet bonuses; the map highlights the union.
  function taggedStars(): Set<StarId> {
    const playerTags = new Set<string>();
    const petTags = new Set<string>();
    for (const k of selectedBenefits) { if (k.startsWith("pet:")) petTags.add(k.slice(4)); else playerTags.add(k); }
    const out = starsGranting(model, playerTags);
    for (const id of starsGrantingPet(model, petTags)) out.add(id);
    return out;
  }
```

(e) Add the pet available HTML state next to `let availHtml = "";`:

```ts
  let petAvailHtml = ""; // pet "Available to get" catalog HTML; rendered below the player one on the right
```

(f) Replace the body of `renderBenefitsPanel` with:

```ts
  function renderBenefitsPanel() {
    // "Available to get" lists only benefits still reachable from here: bonuses on unselected stars
    // in constellations that remain completable. In the permissive path completable is every
    // constellation, so this lists everything not yet held (the prior behavior).
    const availableIds = availableBonusIds(model, state.selected, reach.completable);
    const availPetKeys = availablePetKeys(model, state.selected, reach.completable);
    const r = renderBenefits(benefitsEl, model, state.selected, prevBonuses, selectedBenefits, benefitCatalog, availableIds, prevPet, petCatalog, availPetKeys);
    prevBonuses = r.bonuses;
    prevPet = r.petBonuses;
    availHtml = r.availHtml;
    petAvailHtml = r.petAvailHtml;
  }
```

(g) In `refresh`, replace the highlight line `handle.update(state, starsGranting(model, selectedBenefits), reach);` with:

```ts
    handle.update(state, taggedStars(), reach);
```

(h) In `refresh`, after the player "Available to get" placement line, add the pet placement:

```ts
    if (availHtml) affinityEl.insertAdjacentHTML("beforeend", `<hr class="panel-sep"/><h2>Available to get</h2>${availHtml}`);
    if (petAvailHtml) affinityEl.insertAdjacentHTML("beforeend", `<hr class="panel-sep"/><h2>Bonus to All Pets</h2>${petAvailHtml}`);
```

(i) In `refresh`, change the `encodeHash` call to use `benefitCanonical`:

```ts
    history.replaceState(null, "", `#${encodeHash(state.selected, state.pointCap, canonical, selectedBenefits, benefitCanonical)}`);
```

- [ ] **Step 4: Run e2e to verify it passes**

Run: `just e2e`
Expected: PASS — all checks including the two new pet checks; "Available to get empties once every point is spent" still passes (the pet tag was cleared).

- [ ] **Step 5: Run the full unit gate**

Run: `just check`
Expected: tests, lint, typecheck all clean.

- [ ] **Step 6: Commit**

```bash
git add web/src/app/main.ts web/e2e/smoke.ts
git commit -m "feat(web): wire pet-bonus tagging, highlight, and pet 'Available to get'"
```

---

### Task 6: manual visual pass and backlog close-out

**Files:**
- Modify: `web/src/styles.css` (only if the pet available subheading needs a rule)
- Modify: `BACKLOG.md` (remove the now-shipped item 1)

- [ ] **Step 1: Build and serve, eyeball the panels**

Run: `just serve`, open `http://localhost:5173`. Select Korvaak, the Eldritch Sun (or any pet-bearing constellation). Confirm: the left "Bonus to All Pets" chips are clickable and highlight the map; the right panel shows a "Bonus to All Pets" list under "Available to get" that shrinks as points are spent; a shared link restores pet tags.

- [ ] **Step 2: Add a CSS rule only if needed**

If the pet available subheading reads wrong, add a minimal rule to `web/src/styles.css` reusing existing benefit classes. Otherwise make no change.

- [ ] **Step 3: Remove the shipped backlog item**

Delete backlog item 1 ("Make 'Bonus to All Pets' benefits taggable / highlightable") from `BACKLOG.md`, and note in the intro paragraph that pet-bonus filtering has shipped (matching how other shipped items are noted).

- [ ] **Step 4: Final gates**

Run: `just check` then `just e2e`
Expected: both green.

- [ ] **Step 5: Commit**

```bash
git add BACKLOG.md web/src/styles.css
git commit -m "docs: close pet-bonus filtering backlog item (shipped)"
```

---

## Self-Review

**Spec coverage:**
- Scoped key convention — Tasks 1-4 (the `pet:` prefix is produced in `availablePetKeys`, consumed in `makeScope`/`taggedStars`).
- `starsGrantingPet`, `availablePetKeys` — Tasks 1, 2.
- `canonicalPetStatIds`, `canonicalBenefitIds`, URL back-compat — Task 3 (with the old-link decode test).
- Interactive pet active section + pet "Available to get" (own subheading, shown only when non-empty) — Task 4 (render) + Task 5h (placement, guarded by `if (petAvailHtml)`).
- Highlight union, `svgRenderer` unchanged — Task 5d, 5g.
- Same-stat independent toggles — falls out of scoped keys; exercised by the e2e (a pet tag lights stars without any player tag).
- One `.match` style for v1 — no CSS state added; Task 6 only adds CSS if visually needed.
- Tooltip/parser/model untouched — no task modifies them.

**Placeholder scan:** none. Task 6 Step 2 is conditional ("only if needed") with an explicit default of no change, not a placeholder.

**Type consistency:** `starsGrantingPet(model, Set<string>) -> Set<StarId>`, `availablePetKeys(model, Set<StarId>, Set<string>) -> Set<string>`, `canonicalBenefitIds(model) -> string[]`, and `renderBenefits(..., petCatalog?, availablePetKeys?) -> { ...; petAvailHtml: string }` are used identically in their consuming tasks (Task 5 imports and calls them with these exact shapes). `taggedStars(): Set<StarId>` matches `handle.update`'s highlight parameter.
