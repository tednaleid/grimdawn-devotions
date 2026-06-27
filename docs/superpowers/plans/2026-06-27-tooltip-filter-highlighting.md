# Tooltip Filter Highlighting + Affinity Filters Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Highlight (and on touch, toggle) benefit-filter rows in the star/constellation tooltip, and make affinities filter values that fade non-matching constellations.

**Architecture:** A filter tag is a raw stat id (`pet:`-scoped for pet bonuses), stored in `selectedBenefits` and round-tripped in the `b=` URL bitset. This adds an affinity tag namespace (`aff:grant:<a>` / `aff:req:<a>`) appended to the canonical id order, a constellation-level affinity match used by the renderer to fade off-target constellations (independent of the existing per-star benefit glow), and `data-vid` tagging plus selected styling in the tooltip and Affinity panel. Pure logic lives in `core/`, rendering in `adapters/`, wiring in the `app/main.ts` composition root.

**Tech Stack:** TypeScript, Bun (test runner), inline SVG, raw-CDP e2e harness (`web/e2e/smoke.ts`).

## Global Constraints

- New code files start with two `// ABOUTME: ` comment lines. (Touched-but-not-created files do not need them added.)
- No emojis, emdashes, or hyperbole in code or docs.
- Affinity tags append strictly AFTER the existing player and `pet:` ids in `canonicalBenefitIds`, preserving backward compatibility (old `b=` payloads decode unchanged).
- Affinity match is constellation-level and stays OUT of the per-star `highlight`/`.match` set; it drives a separate `aff-off` fade.
- A benefit `.match` star is never also `aff-off` (a match keeps full glow even inside a faded constellation).
- Tooltip benefit rows toggle a single stat id (per-value), not the sidebar's subject-group set.
- Required-affinity filtering is settable only via the touch tooltip or a shared URL; granted-affinity filtering is also settable by clicking Affinity panel rows on desktop.
- The affinity tag string is constructed in exactly one place: `affinityTagId(kind, a)` in `web/src/core/urlState.ts`. Every other site imports it (canonical list, tooltip, panel); `main.ts` parses via the `"aff:grant:"` / `"aff:req:"` prefixes.
- Targeted test command (from repo root): `cd web && bun test test/<file>.test.ts`. Full gate: `just check`. E2e: `just e2e`.

---

### Task 1: Affinity tag namespace in the canonical id order

**Files:**
- Modify: `web/src/core/urlState.ts` (imports at line 3; `canonicalBenefitIds` at lines 34-36)
- Test: `web/test/urlState.test.ts` (replace the test at lines 68-74; add two tests)

**Interfaces:**
- Produces: `affinityTagId(kind: "grant" | "req", a: Affinity): string` returning `` `aff:${kind}:${a}` ``; `canonicalBenefitIds(model)` now returns `[...playerStatIds, ...petStatIds.map(pet:), ...10 affinity ids]` where the affinity ids are, for each affinity in `AFFINITIES` order, the grant id then the req id.

- [ ] **Step 1: Update the canonical-shape test and add round-trip coverage**

In `web/test/urlState.test.ts`, REPLACE the test at lines 68-74 with:

```ts
test("canonicalBenefitIds is player ids, then pet: ids, then 10 aff: ids", () => {
  const player = canonicalStatIds(model);
  const all = canonicalBenefitIds(model);
  expect(all.slice(0, player.length)).toEqual(player);
  const tail = all.slice(-10);
  expect(tail.every((k) => k.startsWith("aff:"))).toBe(true);
  expect(tail).toContain("aff:grant:eldritch");
  expect(tail).toContain("aff:req:eldritch");
  const middle = all.slice(player.length, all.length - 10);
  expect(middle.length).toBeGreaterThan(0);
  expect(middle.every((k) => k.startsWith("pet:"))).toBe(true);
});

test("affinity tags round-trip via b=", () => {
  const benefitCanonical = canonicalBenefitIds(model);
  const benefits = new Set(["aff:grant:eldritch", "aff:req:chaos"]);
  const hash = encodeHash(new Set([canonical[0]!]), 30, canonical, benefits, benefitCanonical);
  const decoded = decodeHash(`#${hash}`, canonical, benefitCanonical)!;
  expect([...decoded.benefits].sort()).toEqual([...benefits].sort());
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd web && bun test test/urlState.test.ts`
Expected: FAIL (the canonical tail is still all `pet:`, so the new shape and round-trip assertions fail).

- [ ] **Step 3: Add `affinityTagId` and extend `canonicalBenefitIds`**

In `web/src/core/urlState.ts`, change the import on line 3 from:

```ts
import type { DevotionModel, StarId } from "./types";
```

to:

```ts
import { AFFINITIES, type Affinity, type DevotionModel, type StarId } from "./types";
```

Then REPLACE `canonicalBenefitIds` (lines 34-36) with:

```ts
/** The affinity filter tag for a grant/require of one affinity, e.g. `aff:grant:eldritch`. */
export function affinityTagId(kind: "grant" | "req", a: Affinity): string {
  return `aff:${kind}:${a}`;
}

/** The 10 affinity filter tags (each affinity x grant/require), in a stable order. */
function canonicalAffinityIds(): string[] {
  return AFFINITIES.flatMap((a) => [affinityTagId("grant", a), affinityTagId("req", a)]);
}

/**
 * The benefit-tag ordering for the URL bitset: the player stat ids (unchanged positions), then the
 * pet stat ids prefixed `pet:`, then the 10 affinity tags. Each block is appended after the last, so
 * an old player-only or player+pet `b=` payload decodes identically; affinity tags extend the bitset
 * only when present.
 */
export function canonicalBenefitIds(model: DevotionModel): string[] {
  return [
    ...canonicalStatIds(model),
    ...canonicalPetStatIds(model).map((id) => `pet:${id}`),
    ...canonicalAffinityIds(),
  ];
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd web && bun test test/urlState.test.ts`
Expected: PASS (all urlState tests, including the existing "old player-only b= payload still decodes" and "mixed player and pet tags round-trip").

- [ ] **Step 5: Commit**

```bash
git add web/src/core/urlState.ts web/test/urlState.test.ts
git commit -m "feat(core): affinity filter tag namespace in the URL bitset"
```

---

### Task 2: Constellation matching for affinity tags

**Files:**
- Modify: `web/src/core/affinity.ts` (add a function after `meetsRequirement`, ~line 40)
- Test: `web/test/affinity.test.ts` (add one test)

**Interfaces:**
- Consumes: `Affinity`, `DevotionModel` from `./types`.
- Produces: `constellationsMatchingAffinity(model: DevotionModel, grants: Set<Affinity>, requires: Set<Affinity>): Set<string>` returning the ids of constellations that grant any affinity in `grants` (`affinityBonus[a] > 0`) or require any in `requires` (`affinityRequired[a] > 0`); empty when both inputs are empty.

- [ ] **Step 1: Write the failing test**

Append to `web/test/affinity.test.ts`:

```ts
import { constellationsMatchingAffinity } from "../src/core/affinity";

test("constellationsMatchingAffinity matches granted and required affinities", () => {
  const granters = constellationsMatchingAffinity(model, new Set(["eldritch"]), new Set());
  expect(granters.size).toBeGreaterThan(0);
  for (const id of granters) expect((model.constellations.get(id)!.affinityBonus.eldritch ?? 0) > 0).toBe(true);

  const requirers = constellationsMatchingAffinity(model, new Set(), new Set(["eldritch"]));
  expect(requirers.size).toBeGreaterThan(0);
  for (const id of requirers) expect((model.constellations.get(id)!.affinityRequired.eldritch ?? 0) > 0).toBe(true);

  expect(constellationsMatchingAffinity(model, new Set(), new Set()).size).toBe(0);
});
```

Note: `web/test/affinity.test.ts` already builds `model` from `../../data/devotions.json`. If it does not, add at the top: `import doc from "../../data/devotions.json"; import { buildModel } from "../src/core/model"; const model = buildModel(doc as any);` (only if `model` is not already defined in that file).

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd web && bun test test/affinity.test.ts`
Expected: FAIL with `Export named 'constellationsMatchingAffinity' not found`.

- [ ] **Step 3: Write the implementation**

In `web/src/core/affinity.ts`, add after `meetsRequirement` (after line 40):

```ts
// The constellations matching an affinity filter: those granting any affinity in `grants`
// (affinityBonus > 0) or requiring any in `requires` (affinityRequired > 0). Constellation-level,
// so the caller fades whole non-matching constellations rather than dimming individual stars.
export function constellationsMatchingAffinity(
  model: DevotionModel,
  grants: Set<Affinity>,
  requires: Set<Affinity>,
): Set<string> {
  const out = new Set<string>();
  if (grants.size === 0 && requires.size === 0) return out;
  for (const c of model.constellations.values()) {
    const grantsHit = [...grants].some((a) => (c.affinityBonus[a] ?? 0) > 0);
    const requiresHit = [...requires].some((a) => (c.affinityRequired[a] ?? 0) > 0);
    if (grantsHit || requiresHit) out.add(c.id);
  }
  return out;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd web && bun test test/affinity.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/core/affinity.ts web/test/affinity.test.ts
git commit -m "feat(core): constellationsMatchingAffinity for affinity filters"
```

---

### Task 3: Id-carrying bonus-row formatter

**Files:**
- Modify: `web/src/core/statFormat.ts` (add an export after `formatBonusRows`, ~line 274)
- Test: `web/test/statFormat.test.ts` (EXTEND — this file already exists with coverage for statRow/formatBonusRows/groupedBonusRows/formatPowerStats/formatPet; append the new tests, do not overwrite)

**Interfaces:**
- Consumes: the module-private `bonusEntries` (same file).
- Produces: `formatBonusRowsWithIds(bonuses: Record<string, number>, opts?: { racialTarget?: string[] }): { id: string; label: string; value: string }[]` returning the same rows as `formatBonusRows` (sorted by label, flat Min/Max merged) but each carrying its representative stat id from `bonusEntries`.

- [ ] **Step 1: Write the failing test**

Create `web/test/statFormat.test.ts`:

```ts
// ABOUTME: Tests the id-carrying bonus-row formatter used to tag tooltip rows with their stat id.
// ABOUTME: A merged flat damage range keeps the ...Min id; percent stats keep their raw id.
import { test, expect } from "bun:test";
import { formatBonusRowsWithIds } from "../src/core/statFormat";

test("formatBonusRowsWithIds keeps each row's stat id, merging a flat damage range to its Min id", () => {
  const rows = formatBonusRowsWithIds({ offensiveFireMin: 10, offensiveFireMax: 20, characterStrength: 5 });
  const ids = rows.map((r) => r.id);
  expect(ids).toContain("offensiveFireMin");
  expect(ids).toContain("characterStrength");
  expect(ids).not.toContain("offensiveFireMax"); // merged into the Min row
});

test("formatBonusRowsWithIds rows match formatBonusRows label/value pairs", () => {
  const bonuses = { characterStrength: 5, offensiveFireModifier: 12 };
  const withIds = formatBonusRowsWithIds(bonuses);
  expect(withIds.find((r) => r.id === "characterStrength")!.label).toBe("Physique");
  expect(withIds.find((r) => r.id === "offensiveFireModifier")!.value).toBe("+12%");
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd web && bun test test/statFormat.test.ts`
Expected: FAIL with `Export named 'formatBonusRowsWithIds' not found`.

- [ ] **Step 3: Write the implementation**

In `web/src/core/statFormat.ts`, add directly after `formatBonusRows` (after line 274):

```ts
/** Like formatBonusRows, but each row keeps its representative stat id (for tagging tooltip rows). */
export function formatBonusRowsWithIds(
  bonuses: Record<string, number>,
  opts: { racialTarget?: string[] } = {},
): { id: string; label: string; value: string }[] {
  return bonusEntries(bonuses, opts)
    .map((e) => ({ id: e.id, label: e.row.label, value: e.row.value }))
    .sort((a, b) => a.label.localeCompare(b.label));
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd web && bun test test/statFormat.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/core/statFormat.ts web/test/statFormat.test.ts
git commit -m "feat(core): id-carrying bonus-row formatter for tooltip tagging"
```

---

### Task 4: Tooltip highlighting + data-vid tags

**Files:**
- Modify: `web/src/adapters/tooltipView.ts` (imports lines 12-14; `affinityLine` 18-22; `requiresLine` 25-33; `bonusRowsHtml` 35-39; `petBonusHtml` 49-52; `affinitySections` 79-86; `show` 115-130; `showConstellation` 131-170)
- Modify: `web/src/styles.css` (add rules after the tooltip block, ~line 682)
- Test: `web/test/tooltip-filter.test.ts` (create)

**Interfaces:**
- Consumes: `formatBonusRowsWithIds` (Task 3), `affinityTagId` (Task 1).
- Produces: `show(model, starId, clientX, clientY, totals?, commit?, selectedBenefits?)` and `showConstellation(model, conId, clientX, clientY, totals?, dim?, commit?, selectedBenefits?)` where `selectedBenefits: Set<string> = new Set()` is the new trailing param. Player bonus rows emit `data-vid="<id>"`, pet rows `data-vid="pet:<id>"`, Grants spans `data-vid="aff:grant:<a>"`, Requires spans `data-vid="aff:req:<a>"`; a row/span whose vid is in `selectedBenefits` also carries the `vsel` class. Power/ability/summon-pet lines stay untagged.

- [ ] **Step 1: Write the failing test**

Create `web/test/tooltip-filter.test.ts`:

```ts
// ABOUTME: The tooltip tags bonus rows and affinity lines with data-vid and marks active filter tags.
// ABOUTME: Player rows use the bare id, pet rows pet:, Grants/Requires use aff:grant:/aff:req:.
import { test, expect, beforeEach } from "bun:test";
import doc from "../../data/devotions.json";
import { buildModel } from "../src/core/model";
import { tooltipView } from "../src/adapters/tooltipView";

const model = buildModel(doc as any);

beforeEach(() => {
  global.window = { innerWidth: 1024, innerHeight: 768 } as any;
});

function el() {
  return { style: {}, innerHTML: "", offsetWidth: 0, offsetHeight: 0 } as any as HTMLElement;
}

test("bonus rows carry data-vid and gain vsel when the tag is active", () => {
  const star = [...model.stars.values()].find((s) => Object.keys(s.bonuses).length > 0)!;
  const e = el();
  const tip = tooltipView(e);
  tip.show(model, star.id, 0, 0);
  const vid = (e as any).innerHTML.match(/class="tip-bonus[^"]*" data-vid="([^"]+)"/)![1];
  expect(vid.startsWith("aff:")).toBe(false);

  const e2 = el();
  tooltipView(e2).show(model, star.id, 0, 0, undefined, undefined, new Set([vid]));
  expect((e2 as any).innerHTML).toContain(`class="tip-bonus vsel" data-vid="${vid}"`);
});

test("constellation Grants/Requires lines carry aff: data-vid and gain vsel when active", () => {
  // A constellation that both grants and requires an affinity.
  const con = [...model.constellations.values()].find(
    (c) =>
      Object.values(c.affinityBonus).some((v) => (v ?? 0) > 0) &&
      Object.values(c.affinityRequired).some((v) => (v ?? 0) > 0),
  )!;
  const e = el();
  tooltipView(e).showConstellation(model, con.id, 0, 0);
  const html = (e as any).innerHTML as string;
  const grantVid = html.match(/data-vid="(aff:grant:[a-z]+)"/)![1];
  const reqVid = html.match(/data-vid="(aff:req:[a-z]+)"/)![1];

  const e2 = el();
  tooltipView(e2).showConstellation(model, con.id, 0, 0, undefined, undefined, undefined, new Set([grantVid, reqVid]));
  const html2 = (e2 as any).innerHTML as string;
  expect(html2).toMatch(new RegExp(`class="aff vsel" data-vid="${grantVid}"`));
  expect(html2).toMatch(new RegExp(`class="aff (?:met|missing) vsel" data-vid="${reqVid}"`));
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd web && bun test test/tooltip-filter.test.ts`
Expected: FAIL (no `data-vid` is emitted yet).

- [ ] **Step 3: Update the tooltip renderer**

In `web/src/adapters/tooltipView.ts`:

(a) Add to the imports (after line 14, the `affinityColors` import is line 14):

```ts
import { formatBonusRowsWithIds } from "../core/statFormat";
import { affinityTagId } from "../core/urlState";
```

(b) REPLACE `affinityLine` (lines 18-22) with:

```ts
function affinityLine(map: AffinityMap, selectedBenefits: Set<string>): string {
  return presentAffinities(map)
    .map((a) => {
      const vid = affinityTagId("grant", a);
      const sel = selectedBenefits.has(vid) ? " vsel" : "";
      return `<span class="aff${sel}" data-vid="${vid}">${affinityOrb(a)}${a} ${map[a]}</span>`;
    })
    .join(" ");
}
```

(c) REPLACE `requiresLine` (lines 25-33) with:

```ts
// Required affinities: only the ones the player is still short on are flagged missing (red).
function requiresLine(map: AffinityMap, totals: AffinityTotals | undefined, selectedBenefits: Set<string>): string {
  return presentAffinities(map)
    .map((a) => {
      const need = map[a]!;
      const met = !totals || (totals[a] ?? 0) >= need;
      const vid = affinityTagId("req", a);
      const sel = selectedBenefits.has(vid) ? " vsel" : "";
      return `<span class="aff ${met ? "met" : "missing"}${sel}" data-vid="${vid}">${affinityOrb(a)}${a} ${need}</span>`;
    })
    .join(" ");
}
```

(d) REPLACE `bonusRowsHtml` (lines 35-39) with:

```ts
// Bonus rows tagged with their filter id (`scope` is "" for player bonuses, "pet:" for pet bonuses);
// a row whose tag is in selectedBenefits is marked selected (vsel) so it reads like the sidebar.
function bonusRowsHtml(
  bonuses: Record<string, number>,
  selectedBenefits: Set<string>,
  scope: string,
  racialTarget?: string[],
): string {
  return formatBonusRowsWithIds(bonuses, { racialTarget })
    .map((r) => {
      const vid = `${scope}${r.id}`;
      const sel = selectedBenefits.has(vid) ? " vsel" : "";
      return `<div class="tip-bonus${sel}" data-vid="${vid}"><span class="val">${r.value}</span> ${r.label}</div>`;
    })
    .join("");
}
```

(e) REPLACE `petBonusHtml` (lines 49-52) with:

```ts
// "Bonus to All Pets": the same stat lines as a player bonus, under a header, tagged with pet: ids.
function petBonusHtml(petBonuses: Record<string, number> | undefined, selectedBenefits: Set<string>): string {
  if (!petBonuses || Object.keys(petBonuses).length === 0) return "";
  return `<div class="tip-pet-bonus-head">Bonus to All Pets</div>${bonusRowsHtml(petBonuses, selectedBenefits, "pet:")}`;
}
```

(f) REPLACE `affinitySections` (lines 79-86) with:

```ts
function affinitySections(con: Constellation, totals: AffinityTotals | undefined, selectedBenefits: Set<string>): string {
  const req = requiresLine(con.affinityRequired, totals, selectedBenefits);
  const grant = affinityLine(con.affinityBonus, selectedBenefits);
  return (
    (req ? `<div class="tip-req">Requires: ${req}</div>` : "") +
    (grant ? `<div class="tip-grant">Grants: ${grant}</div>` : "")
  );
}
```

(g) REPLACE `show` (lines 115-130) with:

```ts
    show(
      model: DevotionModel,
      starId: StarId,
      clientX: number,
      clientY: number,
      totals?: AffinityTotals,
      commit?: { label: string; enabled: boolean },
      selectedBenefits: Set<string> = new Set(),
    ) {
      const star = model.stars.get(starId);
      if (!star) return;
      const con = model.constellations.get(star.constellationId)!;
      const power = star.celestialPower ? powerHtml(star.celestialPower) : "";
      el.innerHTML = `<strong>${con.name}</strong>${power}${bonusRowsHtml(star.bonuses, selectedBenefits, "", star.racialTarget)}${weaponReqHtml(star.weaponRequirement?.description)}${petBonusHtml(star.petBonuses, selectedBenefits)}${affinitySections(con, totals, selectedBenefits)}${commitHtml(commit)}`;
      el.style.pointerEvents = commit ? "auto" : "";
      place(clientX, clientY);
    },
```

(h) In `showConstellation`, REPLACE the signature (lines 131-139):

```ts
    showConstellation(
      model: DevotionModel,
      conId: string,
      clientX: number,
      clientY: number,
      totals?: AffinityTotals,
      dim?: { needs?: number; cap: number },
      commit?: { label: string; enabled: boolean },
    ) {
```

with (adds the trailing `selectedBenefits` param):

```ts
    showConstellation(
      model: DevotionModel,
      conId: string,
      clientX: number,
      clientY: number,
      totals?: AffinityTotals,
      dim?: { needs?: number; cap: number },
      commit?: { label: string; enabled: boolean },
      selectedBenefits: Set<string> = new Set(),
    ) {
```

Then REPLACE the `el.innerHTML` template inside `showConstellation` (line 167):

```ts
      el.innerHTML = `${head}${powers}${bonusRowsHtml(sumBonuses(model, stars), racialTargets(model, stars))}${weaponReq}${petBonusHtml(sumPetBonuses(model, stars))}${affinitySections(con, totals)}${dimLine}${commitHtml(commit)}`;
```

to:

```ts
      el.innerHTML = `${head}${powers}${bonusRowsHtml(sumBonuses(model, stars), selectedBenefits, "", racialTargets(model, stars))}${weaponReq}${petBonusHtml(sumPetBonuses(model, stars), selectedBenefits)}${affinitySections(con, totals, selectedBenefits)}${dimLine}${commitHtml(commit)}`;
```

- [ ] **Step 4: Add the selected styling**

In `web/src/styles.css`, add after the `.tip-grant .aff` block (after line 682):

```css
/* Active filter tag inside the tooltip: mirror the sidebar's .brow.vsel selected look. */
.tip-bonus.vsel {
  background: #20313f;
  box-shadow: inset 3px 0 0 #e3c97a;
  border-radius: 3px;
}
.aff.vsel {
  background: #20313f;
  border-radius: 3px;
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd web && bun test test/tooltip-filter.test.ts test/tooltip-dim.test.ts test/tooltip-weapon-req.test.ts`
Expected: PASS (the new file plus the existing tooltip tests, which call `show`/`showConstellation` without the new param and rely on its default).

- [ ] **Step 6: Commit**

```bash
git add web/src/adapters/tooltipView.ts web/src/styles.css web/test/tooltip-filter.test.ts
git commit -m "feat(ui): tag and highlight benefit/affinity filter rows in the tooltip"
```

---

### Task 5: Affinity off-target fade in the renderer

**Files:**
- Modify: `web/src/adapters/svgRenderer.ts` (`RenderOpts` 50-55; art layer 198-220; links 222-234; stars 239-262; `SvgHandle.update` 269-281; `mountSvg` render 290-299, the `update` method 366-372)
- Modify: `web/src/styles.css` (add rules after the `.star.match.con-dim` block, ~line 623)
- Test: `web/test/svgRenderer.test.ts` (add tests)

**Interfaces:**
- Consumes: nothing new.
- Produces: `RenderOpts.affinityMatch?: Set<string>` (matching constellation ids); when present, every constellation NOT in the set gets `aff-off` on its art, art-tint, links, and stars, EXCEPT a star already carrying `match`. `SvgHandle.update(state, highlight?, reach?, diff?, affinityMatch?)` gains the trailing param.

- [ ] **Step 1: Write the failing tests**

Append to `web/test/svgRenderer.test.ts`:

```ts
test("no affinity filter leaves no aff-off classes", () => {
  const markup = renderSvgMarkup(model, { selected: new Set(), pointCap: 55 }, { manifest: null });
  expect(markup).not.toContain("aff-off");
});

test("an affinity filter fades non-matching constellations but exempts benefit matches", () => {
  const matchStar = "crossroads_eldritch:0";
  const markup = renderSvgMarkup(model, { selected: new Set(), pointCap: 55 }, {
    manifest: null,
    affinityMatch: new Set(), // nothing matches -> every constellation is off-target
    highlight: new Set([matchStar]),
  });
  expect(markup).toContain('class="star selectable match"'); // the benefit match keeps full treatment
  expect(markup).not.toContain("match aff-off"); // a match is never faded
  expect(markup).toContain(' aff-off"'); // other stars fade
  expect(markup).toContain('class="link aff-off"'); // links fade too
});

test("affinity off-target fades the constellation art", () => {
  const c = [...model.constellations.values()].find((c) => c.background?.image && c.background.x != null)!;
  const name = c.background!.image!.split("/").pop()!;
  const manifest = { images: { [name]: { url: "art.webp", w: 64, h: 64 } } };
  const markup = renderSvgMarkup(model, { selected: new Set(), pointCap: 55 }, { manifest, affinityMatch: new Set() });
  expect(markup).toContain('class="art aff-off"');
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd web && bun test test/svgRenderer.test.ts`
Expected: FAIL (no `aff-off` class, and `affinityMatch` is not a known option).

- [ ] **Step 3: Add `affinityMatch` to `RenderOpts`**

In `web/src/adapters/svgRenderer.ts`, REPLACE the `RenderOpts` interface (lines 50-55) with:

```ts
export interface RenderOpts {
  manifest: AssetManifest | null;
  highlight?: Set<StarId>;
  reach?: ReachView;
  diff?: { added: Set<StarId>; removed: Set<StarId> } | null;
  // When present, an affinity filter is active: constellations NOT in this set fade (aff-off).
  // Empty set means a filter is active but nothing matches, so every constellation fades.
  affinityMatch?: Set<string>;
}
```

- [ ] **Step 4: Compute and apply the off-target fade**

In `renderSvgMarkup`, after the `dimCons` block (after line 154) add:

```ts
  // Affinity filter: when affinityMatch is present, constellations not in it fade their art, links,
  // and stars (a stronger, separate fade from con-dim). A benefit match star is exempt (see below).
  const affFiltering = opts.affinityMatch !== undefined;
  const affOff = (conId: string): boolean => affFiltering && !opts.affinityMatch!.has(conId);
```

Art image (line 211), REPLACE:

```ts
      parts.push(`<image ${img} class="art${dim}${active}" data-con-id="${c.id}"/>`);
```

with:

```ts
      const ao = affOff(c.id) ? " aff-off" : "";
      parts.push(`<image ${img} class="art${dim}${active}${ao}" data-con-id="${c.id}"/>`);
```

Art-tint rect (line 216), REPLACE:

```ts
          `<rect class="art-tint${dim}${active}" x="${x}" y="${y}" width="${art.w}" height="${art.h}" fill="url(#grad-${c.id})" mask="url(#${mid})"/>`,
```

with:

```ts
          `<rect class="art-tint${dim}${active}${ao}" x="${x}" y="${y}" width="${art.w}" height="${art.h}" fill="url(#grad-${c.id})" mask="url(#${mid})"/>`,
```

Links (lines 224-233), REPLACE the loop body's `const cd = ...` line (line 225) and the `parts.push` (lines 230-232) so the link class includes the off-target fade:

```ts
  for (const star of model.stars.values()) {
    const cd = dimCons.has(star.constellationId) ? " con-dim" : "";
    const ao = affOff(star.constellationId) ? " aff-off" : "";
    for (const p of star.predecessors) {
      const a = model.stars.get(p);
      if (!a) continue;
      const taken = state.selected.has(p) && state.selected.has(star.id) ? " taken" : "";
      parts.push(
        `<line class="link${taken}${cd}${ao}" x1="${a.position.x + STAR_CENTER}" y1="${a.position.y + STAR_CENTER}" x2="${star.position.x + STAR_CENTER}" y2="${star.position.y + STAR_CENTER}"/>`,
      );
    }
  }
```

Stars (lines 240-262), REPLACE the `const m = ...` line (line 250) and the `const cd = ...` line (line 252) with:

```ts
    const isMatch = opts.highlight?.has(star.id) ?? false;
    // A star granting a selected benefit is emphasized; the rest are dimmed while benefit-filtering.
    const m = isMatch ? " match" : filtering ? " dim" : "";
    // Stars in a dim constellation fade too (CSS halves their brightness).
    const cd = dimCons.has(star.constellationId) ? " con-dim" : "";
    // Off-target for the affinity filter: fade, unless this star is a benefit match (matches stay lit).
    const ao = !isMatch && affOff(star.constellationId) ? " aff-off" : "";
```

Then in the `visible` assignment (lines 256-258), add `${ao}` to BOTH the polygon and circle class strings, after `${m}`:

```ts
    const visible = star.celestialPower
      ? `<polygon class="star power ${st}${m}${ao}${cd}${cmp}" points="${diamondPoints(cx, cy, POWER_RADIUS)}" style="${style}"/>`
      : `<circle class="star ${st}${m}${ao}${cd}${cmp}" cx="${cx}" cy="${cy}" r="${STAR_RADIUS}" style="${style}"/>`;
```

- [ ] **Step 5: Thread `affinityMatch` through `update`**

REPLACE the `SvgHandle.update` signature (lines 270-275) with:

```ts
  update(
    state: SelectionState,
    highlight?: Set<StarId>,
    reach?: ReachView,
    diff?: { added: Set<StarId>; removed: Set<StarId> } | null,
    affinityMatch?: Set<string>,
  ): void;
```

REPLACE the inner `render` function (lines 292-299) with:

```ts
  function render(
    state: SelectionState,
    highlight?: Set<StarId>,
    reach?: ReachView,
    diff?: { added: Set<StarId>; removed: Set<StarId> } | null,
    affinityMatch?: Set<string>,
  ) {
    container.innerHTML = renderSvgMarkup(model, state, { manifest: deps.manifest, highlight, reach, diff, affinityMatch });
  }
```

REPLACE the returned `update` method (lines 366-372) with:

```ts
    update(state, highlight, reach, diff, affinityMatch) {
      const live = container.querySelector("svg") as SVGSVGElement | null;
      const vb = live?.getAttribute("viewBox");
      render(state, highlight, reach, diff, affinityMatch);
      const next = container.querySelector("svg") as SVGSVGElement | null;
      if (vb && next) next.setAttribute("viewBox", vb); // preserve pan/zoom across re-render
    },
```

- [ ] **Step 6: Add the off-target fade CSS**

In `web/src/styles.css`, add after the `.star.match.con-dim` block (after line 623):

```css
/* Affinity filter active: constellations not matching the affinity fade hard (art, links, stars) so
   matching ones stand out. Placed after con-dim so it wins; benefit matches never get aff-off, so
   they keep their glow even inside a faded constellation. */
.art.aff-off,
.art-tint.aff-off {
  opacity: 0.06;
}
.link.aff-off {
  opacity: 0.05;
}
.star.aff-off {
  opacity: 0.08;
}
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `cd web && bun test test/svgRenderer.test.ts`
Expected: PASS (the three new tests plus all existing renderer tests).

- [ ] **Step 8: Commit**

```bash
git add web/src/adapters/svgRenderer.ts web/src/styles.css web/test/svgRenderer.test.ts
git commit -m "feat(ui): fade non-matching constellations under an affinity filter"
```

---

### Task 6: Affinity panel rows as grant-filter toggles

**Files:**
- Modify: `web/src/adapters/sidebarView.ts` (imports line 7; `renderAffinities` 177-208)
- Modify: `web/src/styles.css` (add a rule near the `.affinity` block, ~line 460)
- Test: `web/test/sidebar-affinity.test.ts` (extend the `render` helper; add two tests)

**Interfaces:**
- Consumes: `affinityTagId` (Task 1).
- Produces: `renderAffinities(el, model, have, need, needSource, prev?, selectedBenefits?)` where `selectedBenefits: Set<string> = new Set()` is the new trailing param. Each `.affinity` row gains `data-vid="aff:grant:<a>"` and the `vsel` class when that grant tag is active.

- [ ] **Step 1: Extend the test helper and write failing tests**

In `web/test/sidebar-affinity.test.ts`, REPLACE the `render` helper (lines 23-27) with:

```ts
function render(have: Vec, need: Vec, src: Map<number, string[]>, selectedBenefits: Set<string> = new Set()) {
  const el = { innerHTML: "" } as any as HTMLElement;
  renderAffinities(el, model, have, need, src, undefined, selectedBenefits);
  return (el as any).innerHTML as string;
}
```

Then append:

```ts
test("every affinity row carries its grant data-vid", () => {
  const html = render([0, 0, 0, 0, 0], [0, 0, 0, 0, 0], new Map());
  expect(html).toContain('data-vid="aff:grant:order"');
  expect(html).toContain('data-vid="aff:grant:eldritch"');
});

test("an active grant tag marks its affinity row selected", () => {
  const html = render([0, 0, 5, 0, 0], [0, 0, 0, 0, 0], new Map(), new Set(["aff:grant:eldritch"]));
  expect(html).toMatch(/class="affinity affinity-eldritch[^"]*vsel"/);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd web && bun test test/sidebar-affinity.test.ts`
Expected: FAIL (no `data-vid` on affinity rows).

- [ ] **Step 3: Tag the affinity rows**

In `web/src/adapters/sidebarView.ts`, add to the imports (line 7 is the `affinityColors` import):

```ts
import { affinityTagId } from "../core/urlState";
```

Add the new trailing parameter to `renderAffinities` (the signature ends at line 184 with `prev?: Record<Affinity, number>,`); insert after it:

```ts
  selectedBenefits: Set<string> = new Set(),
```

REPLACE the row template (line 204) from:

```ts
    return `<div class="affinity affinity-${a}${flash}"><span>${affinityOrb(a)}${a}</span><span class="aff-have">${have[i]}</span>${needCell}</div>`;
```

to:

```ts
    const vid = affinityTagId("grant", a);
    const sel = selectedBenefits.has(vid) ? " vsel" : "";
    return `<div class="affinity affinity-${a}${flash}${sel}" data-vid="${vid}"><span>${affinityOrb(a)}${a}</span><span class="aff-have">${have[i]}</span>${needCell}</div>`;
```

- [ ] **Step 4: Add the selected styling**

In `web/src/styles.css`, add after the `.affinity.down .aff-have` block (after line 460):

```css
.affinity.vsel {
  box-shadow: inset 3px 0 0 #e3c97a;
  border-radius: 4px;
  cursor: pointer;
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd web && bun test test/sidebar-affinity.test.ts`
Expected: PASS (the two new tests plus the existing two, which use the defaulted `selectedBenefits`).

- [ ] **Step 6: Commit**

```bash
git add web/src/adapters/sidebarView.ts web/src/styles.css web/test/sidebar-affinity.test.ts
git commit -m "feat(ui): tag affinity panel rows as grant-filter toggles"
```

---

### Task 7: Wire affinity filtering + tooltip highlighting into the app (desktop path)

**Files:**
- Modify: `web/src/app/main.ts` (imports 33-35; `taggedStars` 120-130; `tip.show`/`showConstellation` call sites 207-208, 217, 518-519; `handle.update` call 433; `renderAffinities` call 435)
- Modify: `web/e2e/smoke.ts` (insert a desktop affinity-filter block; ~after line 296)

**Interfaces:**
- Consumes: `constellationsMatchingAffinity` (Task 2), the new `selectedBenefits` params (Tasks 4, 6), `RenderOpts.affinityMatch` / `handle.update`'s 5th arg (Task 5).
- Produces: an `affinityMatchCons()` local returning `Set<string> | undefined`; `selectedBenefits` threaded into all three tooltip call sites, the affinity panel render, and the map update.

- [ ] **Step 1: Import the matcher**

In `web/src/app/main.ts`, REPLACE the affinity import (line 33):

```ts
import { affinityTotals } from "../core/affinity";
```

with:

```ts
import { affinityTotals, constellationsMatchingAffinity } from "../core/affinity";
```

- [ ] **Step 2: Exclude affinity tags from the star highlight and add the constellation matcher**

REPLACE `taggedStars` (lines 120-130) with:

```ts
  // The map stars to emphasize for the current benefit tags: bare keys scan player bonuses,
  // pet: keys scan pet bonuses; aff: keys are constellation-level (see affinityMatchCons) and skipped here.
  function taggedStars(): Set<StarId> {
    const playerTags = new Set<string>();
    const petTags = new Set<string>();
    for (const k of selectedBenefits) {
      if (k.startsWith("aff:")) continue;
      if (k.startsWith("pet:")) petTags.add(k.slice(4));
      else playerTags.add(k);
    }
    const out = starsGranting(model, playerTags);
    for (const id of starsGrantingPet(model, petTags)) out.add(id);
    return out;
  }

  // The constellations matching the active affinity tags, or undefined when none are active (so the
  // renderer fades nothing). aff:grant:<a> and aff:req:<a> split into grant/require affinity sets.
  function affinityMatchCons(): Set<string> | undefined {
    const grants = new Set<Affinity>();
    const requires = new Set<Affinity>();
    for (const k of selectedBenefits) {
      if (k.startsWith("aff:grant:")) grants.add(k.slice("aff:grant:".length) as Affinity);
      else if (k.startsWith("aff:req:")) requires.add(k.slice("aff:req:".length) as Affinity);
    }
    if (grants.size === 0 && requires.size === 0) return undefined;
    return constellationsMatchingAffinity(model, grants, requires);
  }
```

- [ ] **Step 3: Thread `selectedBenefits` into the three tooltip call sites**

In the map `onHover` handler (lines 207-208), REPLACE:

```ts
      if (t.kind === "star") tip.show(model, t.id, x, y, totals);
      else tip.showConstellation(model, t.id, x, y, totals, completionInfo(t.id));
```

with:

```ts
      if (t.kind === "star") tip.show(model, t.id, x, y, totals, undefined, selectedBenefits);
      else tip.showConstellation(model, t.id, x, y, totals, completionInfo(t.id), undefined, selectedBenefits);
```

In the sidebar power-hover handler (line 217), REPLACE:

```ts
      tip.show(model, sid, (e as MouseEvent).clientX, (e as MouseEvent).clientY, affinityTotals(model, state.selected));
```

with:

```ts
      tip.show(
        model,
        sid,
        (e as MouseEvent).clientX,
        (e as MouseEvent).clientY,
        affinityTotals(model, state.selected),
        undefined,
        selectedBenefits,
      );
```

In `showCommitPopover` (lines 518-519), REPLACE:

```ts
    if (target.kind === "star") tip.show(model, target.id, x, y, totals, btn);
    else tip.showConstellation(model, target.id, x, y, totals, completionInfo(target.id), btn);
```

with:

```ts
    if (target.kind === "star") tip.show(model, target.id, x, y, totals, btn, selectedBenefits);
    else tip.showConstellation(model, target.id, x, y, totals, completionInfo(target.id), btn, selectedBenefits);
```

- [ ] **Step 4: Pass the affinity match to the map and the panel**

In `refresh`, REPLACE the `handle.update` call (line 433):

```ts
    handle.update(state, taggedStars(), reach, diff);
```

with:

```ts
    handle.update(state, taggedStars(), reach, diff, affinityMatchCons());
```

REPLACE the `renderAffinities` call (line 435):

```ts
    prevAffinity = renderAffinities(affinityEl, model, reach.have, reach.need, reach.needSource, prevAffinity);
```

with:

```ts
    prevAffinity = renderAffinities(
      affinityEl,
      model,
      reach.have,
      reach.need,
      reach.needSource,
      prevAffinity,
      selectedBenefits,
    );
```

- [ ] **Step 5: Typecheck**

Run: `cd web && bunx tsc --noEmit`
Expected: PASS (no type errors). This is the unit gate for the wiring; the behavior is exercised by the e2e step below.

- [ ] **Step 6: Add the desktop e2e assertion**

In `web/e2e/smoke.ts`, find the pet-tag matching block that ends with the check `"tagging a pet bonus highlights the stars that grant it as a pet bonus"` and the subsequent untoggle (around lines 292-296). Immediately AFTER that untoggle `await cdp.evaluate(...)` (line 295) and before the `// Reset the point cap` / Home-key block, INSERT:

```ts
  // Affinity filter (desktop): clicking an Affinity panel row tags its granted affinity and fades
  // constellations that do not grant it. Toggled off again so later checks see a clean filter state.
  await cdp.evaluate(
    `document.querySelector('.affinity[data-vid="aff:grant:eldritch"]').dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true}))`,
  );
  await Bun.sleep(120);
  check(
    await cdp.evaluate<boolean>(
      "new URLSearchParams(location.hash.slice(1)).get('b') !== null && document.querySelector('.affinity-eldritch').classList.contains('vsel')",
    ),
    "clicking an Affinity panel row activates its grant tag (URL b= + panel vsel)",
  );
  check(
    (await cdp.evaluate<number>("document.querySelectorAll('.star.aff-off').length")) > 0,
    "an affinity grant filter fades non-matching constellations (.star.aff-off)",
  );
  await cdp.evaluate(
    `document.querySelector('.affinity[data-vid="aff:grant:eldritch"]').dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true}))`,
  );
  await Bun.sleep(120);
  check(
    (await cdp.evaluate<number>("document.querySelectorAll('.star.aff-off').length")) === 0,
    "toggling the affinity row off clears the fade",
  );
```

- [ ] **Step 7: Run the e2e suite**

Run: `just e2e`
Expected: the suite builds and runs; the new desktop checks pass and the overall run reports `E2E PASS`.

- [ ] **Step 8: Commit**

```bash
git add web/src/app/main.ts web/e2e/smoke.ts
git commit -m "feat(ui): affinity filtering + tooltip tag highlighting (desktop wiring)"
```

---

### Task 8: Touch popover filter-toggle

**Files:**
- Modify: `web/src/app/main.ts` (`popoverTarget`/state ~line 103-104; `showCommitPopover` 514-520; the `tooltipEl` `pointerup` handler 536-538)
- Modify: `web/e2e/smoke.ts` (insert a touch toggle block after the commit-button check, ~line 474)

**Interfaces:**
- Consumes: `showCommitPopover`, `selectedBenefits`, `refresh` (existing in `main.ts`).
- Produces: a stored `popoverXY`; the `tooltipEl` `pointerup` handler now also toggles a tapped `[data-vid]` tag and re-shows the popover in place.

- [ ] **Step 1: Store the popover position**

In `web/src/app/main.ts`, after the `popoverTarget` declaration (line 103):

```ts
  let popoverTarget: CommitTarget | null = null; // the star/constellation the open popover commits
```

add:

```ts
  let popoverXY = { x: 0, y: 0 }; // last popover anchor, so a tag toggle can re-show it in place
```

In `showCommitPopover` (lines 514-520), set it at the top of the function body, right after `popoverTarget = target;`:

```ts
    popoverXY = { x, y };
```

- [ ] **Step 2: Toggle a tapped tag and keep the popover open**

REPLACE the `tooltipEl` `pointerup` handler (lines 536-538):

```ts
  tooltipEl.addEventListener("pointerup", (e) => {
    if ((e.target as Element)?.closest?.(".tip-commit")) commitPopover();
  });
```

with:

```ts
  tooltipEl.addEventListener("pointerup", (e) => {
    const t = e.target as Element;
    if (t?.closest?.(".tip-commit")) {
      commitPopover();
      return;
    }
    // Tapping a tagged benefit/affinity row toggles that filter and keeps the popover open (re-shown in
    // place with the new highlight). Guarded by popoverTarget so it only acts in the touch popover.
    const vidEl = t?.closest?.("[data-vid]");
    if (vidEl && popoverTarget) {
      const id = vidEl.getAttribute("data-vid")!;
      selectedBenefits.has(id) ? selectedBenefits.delete(id) : selectedBenefits.add(id);
      refresh();
      showCommitPopover(popoverTarget, popoverXY.x, popoverXY.y);
    }
  });
```

- [ ] **Step 3: Typecheck**

Run: `cd web && bunx tsc --noEmit`
Expected: PASS.

- [ ] **Step 4: Add the touch e2e assertion**

In `web/e2e/smoke.ts`, find the check `"the popover Add button commits the selection"` (around line 471-474). Immediately AFTER that check block and before the `check(cdp.consoleErrors.length === 0, ...)` line (line 476), INSERT:

```ts
  // Touch: re-open a popover and tap a tagged benefit row. It toggles the filter and the popover stays
  // open (the commit button is still present), and the tag is reflected in the URL b= param.
  const tapStar2 = await cdp.evaluate<string>(
    "document.querySelector('circle.hit.selectable:not(.selected)')?.getAttribute('data-star-id') || ''",
  );
  await cdp.evaluate(
    `document.querySelector('circle[data-star-id="${tapStar2}"]').dispatchEvent(new MouseEvent('click',{bubbles:true,clientX:195,clientY:300}))`,
  );
  await Bun.sleep(150);
  // Any tagged row works (a Crossroads has only an affinity Grants line, no stat bonuses); pick the first.
  const tagVid = await cdp.evaluate<string>(
    "document.querySelector('#tooltip [data-vid]')?.getAttribute('data-vid') || ''",
  );
  check(tagVid.length > 0, "the touch popover shows a tagged filter row");
  await cdp.evaluate(
    `document.querySelector('#tooltip [data-vid="${tagVid}"]').dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerType: 'touch' }))`,
  );
  await Bun.sleep(150);
  check(
    await cdp.evaluate<boolean>(
      `new URLSearchParams(location.hash.slice(1)).get('b') !== null && !!document.querySelector('#tooltip .tip-commit')`,
    ),
    "tapping a filter row in the popover toggles the filter and the popover stays open",
  );
  check(
    await cdp.evaluate<boolean>(`!!document.querySelector('#tooltip [data-vid="${tagVid}"].vsel')`),
    "the tapped filter row shows as selected in the re-shown popover",
  );
```

- [ ] **Step 5: Run the e2e suite**

Run: `just e2e`
Expected: `E2E PASS`, including the new touch checks.

- [ ] **Step 6: Run the full gate**

Run: `just check`
Expected: fmt-check, the full `bun test` suite, lint, and typecheck all pass.

- [ ] **Step 7: Commit**

```bash
git add web/src/app/main.ts web/e2e/smoke.ts
git commit -m "feat(ui): toggle benefit/affinity filters from the touch popover"
```

---

### Task 9: Label Crossroads in the build order by direction + affinity dot

**Files:**
- Modify: `web/src/adapters/buildOrderView.ts` (imports line 4; add a constant near line 10; the row `.map` body lines 56-74)
- Test: `web/test/build-order-view.test.ts` (EXTEND — append one test; do not overwrite)

**Context:** The five Crossroads constellations are all named "Crossroads" and have no art, so a build-order row for one reads "Crossroads" with a blank art column. They sit in a fixed quincunx on the devotion map, and each grants exactly its namesake affinity. Label each row with its cardinal direction and a dot in its granted affinity's color (reusing `affinityOrb`, which already renders the `.orb` span the rest of the UI uses).

**Interfaces:**
- Consumes: `affinityOrb` from `./affinityColors`, `Affinity` from `../core/types`.
- Produces: no new exports; `buildOrderHtml` output for a crossroads row now contains `Crossroads (<DIR>)` and an affinity-colored `.orb`.

- [ ] **Step 1: Write the failing test**

Append to `web/test/build-order-view.test.ts` (and add `import { affinityColor } from "../src/adapters/affinityColors";` to the imports at the top):

```ts
test("buildOrderHtml labels a crossroads with its cardinal direction and an affinity dot", () => {
  const steps: BuildStep[] = [
    { kind: "scaffold-add", conId: "crossroads_chaos", points: 1, heldAfter: 1 },
    { kind: "complete", conId: "crossroads_eldritch", points: 1, heldAfter: 2 },
  ];
  const html = buildOrderHtml(model, null, steps);
  expect(html).toContain("Crossroads (NW)"); // chaos crossroads sits NW
  expect(html).toContain("Crossroads (SW)"); // eldritch crossroads sits SW
  expect(html).toContain(`background:${affinityColor("chaos")}`); // colored dot in the art column
  expect(html).toContain(`background:${affinityColor("eldritch")}`);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd web && bun test test/build-order-view.test.ts`
Expected: FAIL (rows say "Crossroads" with no direction and no dot).

- [ ] **Step 3: Implement**

In `web/src/adapters/buildOrderView.ts`, change the imports. Line 4 is `import type { DevotionModel } from "../core/types";`; change it to:

```ts
import type { Affinity, DevotionModel } from "../core/types";
```

and add, with the other adapter imports (after the `AssetManifest` import on line 6):

```ts
import { affinityOrb } from "./affinityColors";
```

After the `AFFINITY` array (line 10), add:

```ts
// The five Crossroads share the generic name "Crossroads" and have no art. Label each by its fixed
// position on the devotion map (cardinal direction) and show a dot in the affinity it grants.
const CROSSROADS: Record<string, { dir: string; affinity: Affinity }> = {
  crossroads_primordial: { dir: "N", affinity: "primordial" },
  crossroads_chaos: { dir: "NW", affinity: "chaos" },
  crossroads_order: { dir: "NE", affinity: "order" },
  crossroads_eldritch: { dir: "SW", affinity: "eldritch" },
  crossroads_ascendant: { dir: "SE", affinity: "ascendant" },
};
```

REPLACE the row `.map` body (lines 56-74, from `const c = model.constellations.get(s.conId);` through the scaffold-row `return ...`) with:

```ts
      const c = model.constellations.get(s.conId);
      const cr = CROSSROADS[s.conId];
      const name = cr ? `${c?.name ?? "Crossroads"} (${cr.dir})` : c ? c.name : s.conId;
      const artName = c?.background?.image?.split("/").pop() ?? "";
      const art = manifest?.images[artName];
      // Crossroads have no art; their art-column cell holds a dot in the granted affinity's color.
      const dot = cr ? `<span class="bo-art">${affinityOrb(cr.affinity)}</span>` : "";
      const img = art && s.kind === "complete" ? `<img class="bo-art" src="${esc(art.url)}" alt=""/>` : "";
      const held = `<span class="bo-held">${s.heldAfter}</span>`;
      if (s.kind === "complete") {
        n++;
        const artCell = img || dot;
        return `<div class="bo-step bo-complete" data-con-id="${esc(s.conId)}"><span class="bo-n">${n}</span>${artCell}<span class="bo-name">${esc(name)}</span><span class="bo-pts">+${s.points}</span>${held}</div>`;
      }
      const label = s.kind === "scaffold-add" ? "Add" : "Refund";
      const cls = s.kind === "scaffold-add" ? "bo-add" : "bo-refund";
      // Empty art-column cell (or the crossroads dot) so the five grid columns line up with complete rows.
      const artCell = dot || `<span class="bo-art"></span>`;
      return `<div class="bo-step ${cls}" data-con-id="${esc(s.conId)}"><span class="bo-n"></span>${artCell}<span class="bo-name">${label} ${esc(name)}</span><span class="bo-pts">${s.points > 0 ? "+" : ""}${s.points}</span>${held}</div>`;
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd web && bun test test/build-order-view.test.ts`
Expected: PASS (the new test plus the existing build-order-view tests).

- [ ] **Step 5: Commit**

```bash
git add web/src/adapters/buildOrderView.ts web/test/build-order-view.test.ts
git commit -m "feat(ui): label crossroads build-order rows by direction with an affinity dot"
```

---

## Notes for the implementer

- All adapter signature changes (`tip.show`/`showConstellation`, `renderAffinities`, `handle.update`, `RenderOpts.affinityMatch`) are additive with defaults, so the build stays green task-to-task; `main.ts` only starts passing the new arguments in Tasks 7-8.
- Do not route `aff:` tags through `starsGranting` (they are not stat ids); Task 7 Step 2 skips them in `taggedStars` and handles them in `affinityMatchCons`.
- The desktop tooltip is `pointer-events:none`, so its `data-vid` rows are inert there (highlight only); only the touch popover (`pointer-events:auto`) acts on a tap. This is intended.
</content>
