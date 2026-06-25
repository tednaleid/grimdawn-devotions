# Unified Benefits Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render the Benefits panel as one row per value in both the regular and comparison modes, from a single pure row-model builder and a single renderer, with Keep/Update-Baseline compare controls and two-level selection.

**Architecture:** A new pure `benefitRows.ts` turns a current selection (and an optional baseline selection) into grouped subjects whose rows are one-per-value with a label role (subject name / indented sub-label / bare continuation) and, in compare mode, Base/Now/Delta cells. `sidebarView.renderBenefits` renders both modes from that model with one row renderer. `main.ts` wires the two compare controls. The old condensed-chip path (`activeSubject`/`compareListHtml`) and `compareBenefits.ts` are removed.

**Tech Stack:** TypeScript, Bun test runner, vanilla DOM adapters. Reference spec: `docs/superpowers/specs/2026-06-24-unified-benefits-layout-design.md`.

## Global Constraints

- Run tests/checks through `just`, never raw `bun test`. `just test <path>` runs one file (path relative to `web/`); `just check` is the full gate and runs on every commit via the pre-commit hook; `just e2e` runs the headless smoke harness.
- New code files start with two `// ABOUTME: ` comment lines.
- No emojis, emdashes, or hyperbole in code or docs.
- Tag keys are scope-namespaced: player benefits use the bare stat id, pet benefits use `pet:<id>`.
- Star ids are `${constellationId}:${index}`.
- Selection is two-level: clicking the subject name toggles all of the subject's value ids; clicking a value row toggles just that id. The existing `onBenefitClick` delegation in `main.ts` already implements this (it checks `closest("[data-vid]")` first, else `closest("[data-gtoggle]")?.closest("[data-gkey]")`), so the markup must put `data-vid` where a value-toggle is wanted and keep the subject name as a `data-gtoggle` that is NOT inside a `data-vid`.
- Compare delta semantics (unchanged from the shipped feature): delta = signed `now - base` on the displayed (sign-applied) value; green up / red down / neutral dash unchanged; a flat damage range (a `*Min` id paired with `*Max`) colors with no number when changed, dash when unchanged; a subject whose parts move both ways rolls up to `mixed`.

---

### Task 1: Unified row-model builder (`benefitRows.ts`)

**Files:**
- Create: `web/src/core/benefitRows.ts`
- Test: `web/test/benefitRows.test.ts`

**Interfaces:**
- Consumes: `sumBonuses`, `sumPetBonuses`, `racialTargets` (`aggregate.ts`); `condensedRows`, `classify`, type `CondensedPart`, type `StatGroup` (`statFormat.ts`).
- Produces: `benefitRows(model, current, baseline): { player: BenefitGroup[]; pet: BenefitGroup[] }` where `baseline: Set<StarId> | null` (null = regular mode, base/delta/verdict empty). Types `RowRole`, `Verdict`, `BenefitRow`, `BenefitSubject`, `BenefitGroup` below. Task 2 renders it.

This task reuses `classify` (already exported from `statFormat.ts`). It supersedes `compareBenefits.ts` (deleted in Task 2).

- [ ] **Step 1: Write the failing test**

Create `web/test/benefitRows.test.ts`:

```ts
// ABOUTME: Tests the unified benefit row-model: one row per value, label roles, and compare cells.
// ABOUTME: Uses the real devotions.json model; selects stars by scanning bonuses so it is data-robust.
import { test, expect } from "bun:test";
import doc from "../../data/devotions.json";
import { buildModel } from "../src/core/model";
import { benefitRows } from "../src/core/benefitRows";

const model = buildModel(doc as any);

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
const allRows = (groups: ReturnType<typeof benefitRows>["player"]) =>
  groups.flatMap((g) => g.subjects).flatMap((s) => s.rows);

test("regular mode: a flat+percent subject yields a subject row then a bare continuation row", () => {
  // A standalone attribute (Physique) has a flat and a percent part.
  const { player } = benefitRows(model, new Set([starGranting("characterStrength")]), null);
  const phys = player.flatMap((g) => g.subjects).find((s) => s.subject === "Physique")!;
  expect(phys.rows[0]!.role).toBe("subject");
  expect(phys.rows.some((r) => r.role === "cont")).toBe(true);
  // regular mode leaves the compare cells empty
  expect(phys.rows[0]!.base).toBe("");
  expect(phys.rows[0]!.delta).toBe("");
});

test("regular mode: a resistance with pct + max yields a subject row then a 'max' sub-label row", () => {
  const { player } = benefitRows(model, new Set([starGranting("defensiveFireMaxResist")]), null);
  const res = player.flatMap((g) => g.subjects).find((s) => s.subject === "Fire Resistance")!;
  const maxRow = res.rows.find((r) => r.subLabel === "max")!;
  expect(maxRow.role).toBe("sub");
  // the max value drops the "max " prefix (the sub-label conveys it)
  expect(maxRow.now.startsWith("max")).toBe(false);
});

test("regular mode: every value id is present once and the subject lists all its ids", () => {
  const star = starGranting("characterStrength");
  const { player } = benefitRows(model, new Set([star]), null);
  const phys = player.flatMap((g) => g.subjects).find((s) => s.subject === "Physique")!;
  const rowIds = phys.rows.map((r) => r.id);
  expect(new Set(rowIds).size).toBe(rowIds.length); // no duplicate rows
  expect(phys.ids.sort()).toEqual([...rowIds].sort()); // subject.ids covers exactly its rows
});

test("compare mode: a stat only in current is an up row with a dash base", () => {
  const star = starGranting("offensiveTotalDamageModifier");
  const { player } = benefitRows(model, new Set([star]), new Set());
  const row = allRows(player).find((r) => r.id === "offensiveTotalDamageModifier")!;
  expect(row.verdict).toBe("up");
  expect(row.base).toBe("—"); // em dash
  expect(row.now).not.toBe("—");
});

test("compare mode: an unchanged flat range is 'same' with a dash delta; a changed one colors with no number", () => {
  const { star, partId } = starGrantingRange();
  const sel = new Set([star]);
  const same = allRows(benefitRows(model, sel, sel).player).find((r) => r.id === partId)!;
  expect(same.verdict).toBe("same");
  expect(same.delta).toBe("—");
  const added = allRows(benefitRows(model, new Set(), sel).player).find((r) => r.id === partId)!;
  expect(added.verdict).toBe("up");
  expect(added.delta).toBe(""); // colored, no scalar
});

test("compare mode: a subject with one part up and one down rolls up to 'mixed'", () => {
  const { player } = benefitRows(model, new Set(["akeron_s_scorpion:0"]), new Set(["hawk:2"]));
  const subj = player.flatMap((g) => g.subjects).find((s) => s.key === "Attributes:Offensive Ability")!;
  expect(subj.rows.some((r) => r.verdict === "up")).toBe(true);
  expect(subj.rows.some((r) => r.verdict === "down")).toBe(true);
  expect(subj.verdict).toBe("mixed");
});

test("pet scope builds from pet bonuses independently of the player scope", () => {
  const petStar = [...model.stars.values()].find((s) => s.petBonuses && Object.keys(s.petBonuses).length > 0)!;
  const { pet } = benefitRows(model, new Set([petStar.id]), null);
  expect(pet.flatMap((g) => g.subjects).length).toBeGreaterThan(0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `just test test/benefitRows.test.ts`
Expected: FAIL - module `benefitRows` does not exist.

- [ ] **Step 3: Write minimal implementation**

Create `web/src/core/benefitRows.ts`:

```ts
// ABOUTME: Builds the unified Benefits row-model: one row per value with a label role (subject name,
// ABOUTME: indented sub-label, or bare continuation), and Base/Now/Delta cells when a baseline is given.
import type { DevotionModel, StarId } from "./types";
import { sumBonuses, sumPetBonuses, racialTargets } from "./aggregate";
import { condensedRows, classify, type CondensedPart, type StatGroup } from "./statFormat";

export type Verdict = "up" | "down" | "same" | "mixed";
export type RowRole = "subject" | "sub" | "cont";
export interface BenefitRow {
  role: RowRole;
  subLabel: string; // "duration" | "max" when role === "sub", else ""
  id: string;
  base: string; // "" in regular mode
  now: string; // displayed value (regular: the build's value; compare: current)
  delta: string; // "" in regular mode
  verdict: Verdict | ""; // "" in regular mode
}
export interface BenefitSubject {
  subject: string;
  key: string;
  ids: string[];
  verdict: Verdict | ""; // subject roll-up (compare only)
  rows: BenefitRow[];
}
export interface BenefitGroup {
  group: StatGroup;
  subjects: BenefitSubject[];
}

const DASH = "—";
const DIM_INDEX: Record<CondensedPart["dim"], number> = { flat: 0, pct: 1, max: 2, durFlat: 3, durPct: 4 };

// The displayed (sign-applied) scalar for a stat id, or undefined when absent.
function displayed(map: Record<string, number>, id: string): number | undefined {
  const v = map[id];
  if (v === undefined) return undefined;
  const c = classify(id);
  return c ? c.sign * v : v;
}
function rangeMaxId(id: string): string | null {
  return id.endsWith("Min") ? `${id.slice(0, -3)}Max` : null;
}
function fmtDelta(n: number): string {
  if (n === 0) return DASH;
  const r = Math.round(n * 100) / 100;
  return r > 0 ? `+${r}` : `${r}`;
}
// Row value text: keep the seconds suffix on a flat duration; drop the "max " prefix (the sub-label
// already says "max"); everything else is the raw condensed value.
function rowValue(dim: CondensedPart["dim"], value: string): string {
  return dim === "durFlat" ? `${value}s` : value;
}

interface PartMeta {
  id: string;
  dim: CondensedPart["dim"];
}
interface SubjMeta {
  group: StatGroup;
  subject: string;
  key: string;
  parts: PartMeta[];
}

// Walk both sides' condensed structures into a per-subject skeleton (union of parts, dim-ordered)
// plus, per part id, the formatted value on each side.
function skeleton(
  baseMap: Record<string, number>,
  nowMap: Record<string, number>,
  racial: string[],
  comparing: boolean,
): { subjects: SubjMeta[]; baseVal: Map<string, string>; nowVal: Map<string, string> } {
  const maps = comparing ? [baseMap, nowMap] : [nowMap];
  const baseVal = new Map<string, string>();
  const nowVal = new Map<string, string>();
  const subjs = new Map<string, SubjMeta>();
  const order: string[] = [];
  for (let side = 0; side < maps.length; side++) {
    for (const g of condensedRows(maps[side]!, { racialTarget: racial })) {
      for (const s of g.subjects) {
        let sm = subjs.get(s.key);
        if (!sm) {
          sm = { group: g.group, subject: s.subject, key: s.key, parts: [] };
          subjs.set(s.key, sm);
          order.push(s.key);
        }
        for (const p of s.parts) {
          if (!sm.parts.some((x) => x.id === p.id)) sm.parts.push({ id: p.id, dim: p.dim });
          const target = comparing && side === 0 ? baseVal : nowVal;
          target.set(p.id, rowValue(p.dim, p.value));
        }
      }
    }
  }
  for (const sm of subjs.values()) sm.parts.sort((a, b) => DIM_INDEX[a.dim] - DIM_INDEX[b.dim]);
  return { subjects: order.map((k) => subjs.get(k)!), baseVal, nowVal };
}

function buildScope(
  baseMap: Record<string, number>,
  nowMap: Record<string, number>,
  racial: string[],
  comparing: boolean,
): BenefitGroup[] {
  const { subjects, baseVal, nowVal } = skeleton(baseMap, nowMap, racial, comparing);
  const byGroup = new Map<StatGroup, BenefitSubject[]>();
  for (const sm of subjects) {
    let firstDone = false;
    let durLabeled = false;
    const rows: BenefitRow[] = sm.parts.map((part) => {
      const isDur = part.dim === "durFlat" || part.dim === "durPct";
      let role: RowRole;
      let subLabel = "";
      if (!firstDone) role = "subject";
      else if (part.dim === "max") {
        role = "sub";
        subLabel = "max";
      } else if (isDur && !durLabeled) {
        role = "sub";
        subLabel = "duration";
      } else role = "cont";
      if (isDur) durLabeled = true;
      firstDone = true;

      if (!comparing) {
        return { role, subLabel, id: part.id, base: "", now: nowVal.get(part.id) ?? DASH, delta: "", verdict: "" };
      }
      const base = baseVal.get(part.id) ?? DASH;
      const now = nowVal.get(part.id) ?? DASH;
      const maxId = rangeMaxId(part.id);
      let delta: string;
      let verdict: Verdict;
      if (maxId && (baseMap[maxId] !== undefined || nowMap[maxId] !== undefined)) {
        const b = (baseMap[part.id] ?? 0) + (baseMap[maxId] ?? 0);
        const n = (nowMap[part.id] ?? 0) + (nowMap[maxId] ?? 0);
        verdict = n > b ? "up" : n < b ? "down" : "same";
        delta = verdict === "same" ? DASH : "";
      } else {
        const b = displayed(baseMap, part.id) ?? 0;
        const n = displayed(nowMap, part.id) ?? 0;
        verdict = n > b ? "up" : n < b ? "down" : "same";
        delta = fmtDelta(n - b);
      }
      return { role, subLabel, id: part.id, base, now, delta, verdict };
    });
    const hasUp = rows.some((r) => r.verdict === "up");
    const hasDown = rows.some((r) => r.verdict === "down");
    const verdict: Verdict | "" = !comparing ? "" : !hasUp && !hasDown ? "same" : hasUp && hasDown ? "mixed" : hasUp ? "up" : "down";
    const subj: BenefitSubject = { subject: sm.subject, key: sm.key, ids: sm.parts.map((p) => p.id), verdict, rows };
    if (!byGroup.has(sm.group)) byGroup.set(sm.group, []);
    byGroup.get(sm.group)!.push(subj);
  }
  return [...byGroup].map(([group, subjects]) => ({ group, subjects }));
}

export function benefitRows(
  model: DevotionModel,
  current: Set<StarId>,
  baseline: Set<StarId> | null,
): { player: BenefitGroup[]; pet: BenefitGroup[] } {
  const comparing = baseline !== null;
  const racial = racialTargets(model, current);
  const baseSel = baseline ?? new Set<StarId>();
  return {
    player: buildScope(sumBonuses(model, baseSel), sumBonuses(model, current), racial, comparing),
    pet: buildScope(sumPetBonuses(model, baseSel), sumPetBonuses(model, current), [], comparing),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `just test test/benefitRows.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/core/benefitRows.ts web/test/benefitRows.test.ts
git commit -m "feat(core): unified benefit row-model builder (one row per value)"
```

---

### Task 2: Render both modes from the row-model + CSS

**Files:**
- Modify: `web/src/adapters/sidebarView.ts` (replace the active-render + compare-render paths)
- Modify: `web/src/styles.css` (unified row styles + compare columns + control header; remove orphaned rules)
- Delete: `web/src/core/compareBenefits.ts`, `web/test/compareBenefits.test.ts`
- Rewrite: `web/test/compare-render.test.ts`

**Interfaces:**
- Consumes: `benefitRows` + types from Task 1.
- Produces: `renderBenefits(...)` unchanged signature; off mode emits one value cell per row + `<button id="set-baseline">`; compare mode emits the `Base/Now/Delta` cells, a `.cmp-bar`, a control row with `<button id="cmp-keep">Keep` and `<button id="cmp-update">Update Baseline`, and the column header. Subject rows carry `data-gkey`/`data-ids`/`data-gtoggle`; value cells carry `data-vid`. Task 3 wires the buttons.

- [ ] **Step 1: Rewrite the failing test**

Replace the entire contents of `web/test/compare-render.test.ts`:

```ts
// ABOUTME: renderBenefits emits one row per value in both modes; compare adds Base/Now/Delta and the
// ABOUTME: Keep / Update Baseline controls. Tag attributes stay on the subject name and value cells.
import { test, expect } from "bun:test";
import doc from "../../data/devotions.json";
import { buildModel } from "../src/core/model";
import { renderBenefits } from "../src/adapters/sidebarView";

const model = buildModel(doc as any);
function starGranting(stat: string): string {
  for (const s of model.stars.values()) if (s.bonuses[stat] !== undefined) return s.id;
  throw new Error(`no star grants ${stat}`);
}
function render(selected: Set<string>, baseline: Set<string> | null): string {
  const el = { innerHTML: "" } as any as HTMLElement;
  renderBenefits(el, model, selected, undefined, new Set(), [], undefined, undefined, [], undefined, baseline);
  return (el as any).innerHTML as string;
}

test("off mode renders the Set baseline button and value rows, no compare controls", () => {
  const html = render(new Set([starGranting("offensiveTotalDamageModifier")]), null);
  expect(html).toContain('id="set-baseline"');
  expect(html).not.toContain("cmp-bar");
  expect(html).toContain("brow"); // a benefit row
  expect(html).toContain('data-vid="offensiveTotalDamageModifier"');
});

test("compare mode renders the bar, Keep / Update Baseline controls, and Base/Now/Delta cells", () => {
  const html = render(new Set([starGranting("offensiveTotalDamageModifier")]), new Set());
  expect(html).toContain("cmp-bar");
  expect(html).toContain('id="cmp-keep"');
  expect(html).toContain('id="cmp-update"');
  expect(html).not.toContain('id="cmp-clear"');
  expect(html).toContain("brow-v base"); // the Base cell
});

test("the subject name carries the group toggle and a value cell carries data-vid", () => {
  const html = render(new Set([starGranting("offensiveTotalDamageModifier")]), new Set());
  expect(html).toContain("data-gtoggle");
  expect(html).toMatch(/data-gkey="[^"]+"/);
  expect(html).toContain('data-vid="offensiveTotalDamageModifier"');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `just test test/compare-render.test.ts`
Expected: FAIL - the old markup (`cmp-col`, `cmp-clear`) is gone in the asserts but the implementation still emits it (and `brow`/`cmp-keep` do not exist yet).

- [ ] **Step 3: Write the implementation**

In `web/src/adapters/sidebarView.ts`:

1. Replace the compare import with the row-model import. Change line 8 from
   `import { compareBenefits, type CompareGroup } from "../core/compareBenefits";`
   to:
   ```ts
   import { benefitRows, type BenefitGroup, type BenefitSubject } from "../core/benefitRows";
   ```

2. Delete the `compareListHtml` function (lines 25-53) and the `partText` helper (lines 18-23: it is replaced by the row-model's `rowValue`; the catalog/avail path does not call it). Keep `changeClass`.

3. Add the unified row renderer as a module-level function (above `renderBenefits`). It renders one row per value; the subject row puts `data-vid` on the value-cell wrapper (so the name stays a group toggle), and continuation/sub rows put `data-vid` on the row (the whole row toggles the value). `flash` adds the per-render change class in regular mode only.

   ```ts
   // One unified row renderer for both modes. comparing=false -> a single value cell (+ flash);
   // comparing=true -> Base/Now/Delta cells. selectedBenefits drives the row highlight; flash adds the
   // per-render up/down change class (regular mode only).
   function benefitListHtml(
     groups: BenefitGroup[],
     comparing: boolean,
     selectedBenefits: Set<string>,
     keyOf: (id: string) => string,
     flash: (id: string) => string,
   ): string {
     const cells = (r: BenefitGroup["subjects"][number]["rows"][number]) =>
       comparing
         ? `<span class="brow-v base">${r.base}</span><span class="brow-v ${r.verdict}">${r.now}</span><span class="brow-v ${r.verdict}">${r.delta}</span>`
         : `<span class="brow-v${flash(r.id)}">${r.now}</span>`;
     const rowHtml = (s: BenefitSubject, r: BenefitGroup["subjects"][number]["rows"][number]) => {
       const vid = keyOf(r.id);
       const sel = selectedBenefits.has(vid) ? " vsel" : "";
       if (r.role === "subject") {
         const ids = s.ids.map(keyOf);
         const vtint = comparing && s.verdict ? ` ${s.verdict}` : "";
         return (
           `<div class="brow${sel}" data-gkey="${keyOf(s.key)}" data-ids="${ids.join(",")}">` +
           `<span class="brow-lbl subj${vtint}" data-gtoggle>${s.subject}</span>` +
           `<span class="brow-vals" data-vid="${vid}">${cells(r)}</span></div>`
         );
       }
       const lbl =
         r.role === "sub" ? `<span class="brow-lbl sub">${r.subLabel}</span>` : `<span class="brow-lbl cont"></span>`;
       return `<div class="brow${sel}" data-vid="${vid}">${lbl}<span class="brow-vals">${cells(r)}</span></div>`;
     };
     return groups
       .map((g) => `<h3>${g.group}</h3>${g.subjects.map((s) => s.rows.map((r) => rowHtml(s, r)).join("")).join("")}`)
       .join("");
   }
   ```

4. In `renderBenefits`, replace the active-list generation and the `if (baselineSelected) { ... } else { ... }` block. The catalog ("Available to get") path (`availListHtml`, `availHtml`, `petAvailHtml`) and the `makeScope` helpers it uses (`keys`, `gkey`, `groupSel`) are UNCHANGED - only `activeSubject`/`chip` are removed from `makeScope` (they are no longer referenced). Remove `activeListHtml`/`activeKeysOf` use of `activeSubject`; keep `activeKeysOf` (it only reads `s.key`). Replace lines 124-139 and 173-193 with:

   ```ts
   // Active benefits: the unified one-row-per-value model, rendered for both modes.
   const rows = benefitRows(model, selected, baselineSelected);
   const flashPlayer = (id: string) => changeClass(prev, id, bonuses);
   const flashPet = (id: string) => changeClass(prevPet, id, petBonuses);
   const comparing = baselineSelected !== null;
   const activeHtml = benefitListHtml(rows.player, comparing, selectedBenefits, (id) => id, flashPlayer);
   const petActiveHtml = benefitListHtml(rows.pet, comparing, selectedBenefits, (id) => `pet:${id}`, flashPet);
   const activeKeys = activeKeysOf(condensedRows(bonuses, { racialTarget: racialTargets(model, selected) }));
   const petActiveKeys = activeKeysOf(condensedRows(petBonuses));
   ```

   (Keep the existing `availHtml`/`petAvailHtml` lines that follow, unchanged.)

   Then the render block:

   ```ts
   if (comparing) {
     const bar = `<div class="cmp-bar">Comparing to baseline</div>`;
     const controls =
       `<div class="cmp-controls"><span class="cmp-spacer"></span>` +
       `<span class="cmp-keep-slot"><button id="cmp-keep" type="button">Keep</button></span>` +
       `<span class="cmp-upd-slot"><button id="cmp-update" type="button">Update Baseline</button></span></div>`;
     const head = `<div class="cmp-head"><span class="brow-lbl"></span><span class="brow-v">Base</span><span class="brow-v">Now</span><span class="brow-v">&Delta;</span></div>`;
     el.innerHTML =
       `<h2>Benefits<button id="set-baseline" class="hidden" type="button"></button></h2>${bar}${controls}${head}` +
       (activeHtml || '<div class="bempty">Select stars to gain benefits.</div>') +
       (petActiveHtml ? `<h2 class="avail-head">Bonus to All Pets</h2>${petActiveHtml}` : "") +
       (powers.length ? `<h3>Celestial Powers</h3>${powerRows}` : "");
   } else {
     el.innerHTML =
       `<h2>Benefits<button id="set-baseline" type="button">Set baseline</button></h2>` +
       `${activeHtml || '<div class="bempty">Select stars to gain benefits.</div>'}` +
       (petActiveHtml ? `<h2 class="avail-head">Bonus to All Pets</h2>${petActiveHtml}` : "") +
       (powers.length ? `<h3>Celestial Powers</h3>${powerRows}` : "");
   }
   ```

5. In `makeScope`, delete the now-unused `chip` and `activeSubject` definitions (lines 101-116) and drop them from the returned object; keep `keys`, `gkey`, `groupSel` (the avail path uses them). Delete the now-unused `activeListHtml` const (line 125-126) and `activeGroups`/`activeHtml`/`petGroups`/`petActiveHtml` lines that used `activeSubject` (replaced above). Keep `activeKeysOf`.

6. Delete `web/src/core/compareBenefits.ts` and `web/test/compareBenefits.test.ts`:
   ```bash
   git rm web/src/core/compareBenefits.ts web/test/compareBenefits.test.ts
   ```

7. In `web/src/styles.css`, replace the compare block and the active-chip rules. Remove the now-orphaned rules: `.bgroup` active-chip children `.bsub`, `.bsingle`, `.bvals`, `.bchip` and `.bsubj` as used by the ACTIVE list (the avail list still uses `.bgroup.avail` + `.bsubj`, so keep `.bgroup`/`.bsubj`/`.bgroup.avail`); and the old compare rules `.cmp-grp`, `.cmp-part`, `.cmp-subj`, `.cmp-head .cmp-lbl`, `.cmp-col` and its color variants, `.cmp-actions`, `#cmp-update`/`#cmp-clear` color rules, and `.cmp-subj.up/.down/.mixed`. Keep `body.comparing main { grid-template-columns: 450px 1fr 250px; }`, `.cmp-bar`, `#set-baseline`/`.hidden`. Add the unified row + control styles:

   ```css
   /* Unified benefit rows: one value per row, compact, both modes */
   .brow { display: flex; align-items: center; padding: 1px 5px; border-radius: 4px; line-height: 1.45; }
   .brow.vsel { background: #20313f; box-shadow: inset 3px 0 0 #e3c97a; }
   .brow-lbl { flex: 1; white-space: nowrap; }
   .brow-lbl.subj { color: #d7c89a; cursor: pointer; }
   .brow.vsel .brow-lbl.subj { color: #eef2f8; }
   .brow-lbl.subj:hover { text-decoration: underline; }
   .brow-lbl.subj.up { color: #83c995; } .brow-lbl.subj.down { color: #e0696a; } .brow-lbl.subj.mixed { color: #6f9fc4; }
   .brow-lbl.sub { color: #7e8aa0; padding-left: 12px; font-size: 0.78rem; }
   .brow-lbl.cont { padding-left: 12px; }
   .brow-vals { display: flex; cursor: pointer; }
   .brow-v { width: 64px; text-align: right; font-variant-numeric: tabular-nums; color: #c9d3e0; }
   /* regular-mode flash reuses the same green/red via the ' up'/' down' class changeClass adds */
   .brow-v.base { color: #7e8aa0; } .brow-v.up { color: #83c995; } .brow-v.down { color: #e0696a; } .brow-v.same { color: #566175; }
   /* compare control row: Keep over Base, Update Baseline over Now+Delta */
   .cmp-controls { display: flex; align-items: center; padding: 0 5px 5px; }
   .cmp-controls .cmp-spacer { flex: 1; }
   .cmp-controls .cmp-keep-slot { width: 64px; text-align: center; }
   .cmp-controls .cmp-upd-slot { width: 128px; text-align: center; }
   .cmp-controls button { background: #161d27; border: 1px solid #283446; border-radius: 4px; padding: 2px 0; font-size: 0.7rem; cursor: pointer; }
   #cmp-keep { width: 60px; color: #d7c89a; }
   #cmp-update { width: 124px; color: #83c995; }
   .cmp-head { display: flex; font-size: 0.6rem; text-transform: uppercase; letter-spacing: 0.04em; color: #7e8aa0; border-bottom: 1px solid #283446; padding: 0 5px 4px; margin-bottom: 4px; }
   .cmp-head .brow-lbl { flex: 1; }
   ```

- [ ] **Step 4: Run tests to verify they pass**

Run: `just test test/compare-render.test.ts` then `just test test/sidebar-benefits.test.ts`
Expected: PASS. The `sidebar-benefits.test.ts` "Bonus to All Pets ... data-vid=pet:" test still passes (value cells carry `pet:`-scoped `data-vid`). Then `just check` for the whole suite + lint + typecheck.

- [ ] **Step 5: Commit**

```bash
git add web/src/adapters/sidebarView.ts web/src/styles.css web/test/compare-render.test.ts
git rm web/src/core/compareBenefits.ts web/test/compareBenefits.test.ts
git commit -m "feat(benefits): one-row-per-value render for both modes"
```

---

### Task 3: Wire Keep / Update Baseline and update the e2e

**Files:**
- Modify: `web/src/app/main.ts` (`onBenefitClick` control handlers)
- Modify: `web/e2e/smoke.ts` (compare-mode block)
- Test: `just e2e` + manual browser check

**Interfaces:**
- Consumes: `#cmp-keep`/`#cmp-update` from Task 2.
- Produces: compare mode resolves to a single-column view via either control.

- [ ] **Step 1: Rewrite the failing e2e block**

In `web/e2e/smoke.ts`, replace the existing baseline-comparison block (the one that clicks `set-baseline`, asserts `.cmp-bar`/`cs=`/`comparing`, then clicks `cmp-clear`) with:

```ts
  // Baseline comparison: set a baseline -> compare mode + cs=; Update Baseline adopts now and exits.
  await cdp.evaluate(`document.getElementById('set-baseline').click()`);
  let cmp = false;
  for (let i = 0; i < 20; i++) {
    await Bun.sleep(100);
    if (await cdp.evaluate<boolean>("document.querySelector('.cmp-bar') !== null")) { cmp = true; break; }
  }
  check(cmp, "Set baseline enters compare mode (.cmp-bar renders)");
  check(await cdp.evaluate<boolean>("location.hash.includes('cs=')"), "baseline rides in the URL as cs=");
  check(await cdp.evaluate<boolean>("document.body.classList.contains('comparing')"), "body.comparing toggles the widened panel");
  check(
    await cdp.evaluate<boolean>("document.getElementById('cmp-keep') !== null && document.getElementById('cmp-update') !== null"),
    "Keep and Update Baseline controls render",
  );
  await cdp.evaluate(`document.getElementById('cmp-update').click()`);
  check(
    await cdp.evaluate<boolean>("document.querySelector('.cmp-bar') === null && !location.hash.includes('cs=')"),
    "Update Baseline exits compare mode and drops cs= from the URL",
  );
```

- [ ] **Step 2: Run it to verify it fails**

Run: `just e2e`
Expected: FAIL on the new checks - nothing wires `cmp-keep`/`cmp-update` to exit, and `cmp-update` currently re-baselines and stays.

- [ ] **Step 3: Write the implementation**

In `web/src/app/main.ts`, replace the three control branches in `onBenefitClick` (lines 208-222, the `set-baseline`/`cmp-update`/`cmp-clear` checks) with:

```ts
    if (t.id === "set-baseline") {
      baseline = { selected: new Set(state.selected), pointCap: state.pointCap };
      refresh();
      return;
    }
    if (t.id === "cmp-keep" && baseline) {
      // Keep the Base build: revert the live edits to the snapshot and exit compare.
      state = { selected: new Set(baseline.selected), pointCap: baseline.pointCap };
      baseline = null;
      refresh();
      return;
    }
    if (t.id === "cmp-update") {
      // Adopt the live (Now) build and exit compare.
      baseline = null;
      refresh();
      return;
    }
```

- [ ] **Step 4: Run it to verify it passes**

Run: `just e2e`
Expected: PASS including the new compare-mode checks. Then `just check`.

- [ ] **Step 5: Commit**

```bash
git add web/src/app/main.ts web/e2e/smoke.ts
git commit -m "feat(planner): Keep / Update Baseline controls resolve the comparison"
```

---

## Manual verification (after Task 3)

`just build` (rebuilds wasm if stale) then `just serve`, open http://localhost:5173. Select a few constellations and confirm the Benefits panel shows one row per value: a flat+percent subject is two rows (name then bare), a DoT shows a `duration` sub-label, a resistance shows a `max` sub-label, single-value subjects are one row. Click "Set baseline", change the selection, and confirm Base/Now/Delta columns with green/red deltas and the subject-name tint. Click a value row (highlights + left accent) and a subject name (selects the whole subject); confirm the map highlight and the URL `b=` update. Click "Update Baseline" (panel returns to one column, current build kept) and re-test "Keep" (reverts to the snapshot). Confirm `cs=` appears while comparing and drops on either control, and that a copied compare URL restores.

## Self-review notes

- Spec coverage: row-model + roles + compare cells + mixed verdict (Task 1); unified render both modes + controls header + CSS + two-level tag markup (Task 2); Keep/Update-Baseline wiring + e2e (Task 3). Affinity/points/avail-catalog/powers untouched.
- The map added/removed diff, the `cs=`/`cp=` URL round-trip, and `svgRenderer` are unchanged by this plan (they do not depend on the panel markup), so their tests stay green.
- Type consistency: `BenefitGroup`/`BenefitSubject`/`BenefitRow`/`RowRole`/`Verdict` are defined in Task 1 and consumed in Task 2. `benefitRows(model, current, baseline)` is the one entry point. `renderBenefits` keeps its existing signature; only its internals change.
- Selection markup honors the existing `onBenefitClick` delegation: subject rows keep `data-vid` on the value-cell wrapper (name stays a group toggle); cont/sub rows put `data-vid` on the row (whole row toggles). No change to the delegation is needed beyond the control-button ids in Task 3.
```
