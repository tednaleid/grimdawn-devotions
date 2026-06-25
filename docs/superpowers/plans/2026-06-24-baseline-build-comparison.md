# Baseline Build Comparison Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Snapshot a build as a "baseline", then show a Base / Now / Δ comparison in a widened Benefits panel as the live build changes, with the baseline bookmarkable in the URL.

**Architecture:** A new pure core module (`compareBenefits.ts`) turns two selections (baseline, current) into a comparison view-model; `sidebarView` renders it as the B1 table in compare mode; `urlState` carries the baseline as parallel `cs=`/`cp=` params; `svgRenderer` marks added/removed stars; `main.ts` holds the `baseline` state and wires the Set/Update/Clear controls. The pure core (`model`, `reachability`, `aggregate.sumBonuses`) is reused unchanged.

**Tech Stack:** TypeScript, Bun test runner, vanilla DOM adapters. Reference spec: `docs/superpowers/specs/2026-06-24-baseline-build-comparison-design.md`.

**Spec refinement note:** the spec named `statFormat.ts` as the home for the delta helper; this plan instead adds a dedicated `web/src/core/compareBenefits.ts` (statFormat is already 514 lines and this is a distinct responsibility - building a comparison view-model). Same logic, isolated and independently testable.

## Global Constraints

- Run tests/checks through `just`, never raw `bun test`. `just test <path>` runs one file (path relative to `web/`); `just check` is the full gate and runs on every commit via the pre-commit hook.
- New code files start with two `// ABOUTME: ` comment lines.
- No emojis, emdashes, or hyperbole in code or docs.
- URL-state invariant: every state-bearing change round-trips through `encodeHash`/`decodeHash` and tolerates stale/malformed links. A no-baseline link must stay byte-identical to today's output.
- Scope is the Benefits panel only (player + pet). Affinity and points stay single-value.
- Delta = current - baseline on the displayed value (sign applied); green when the signed numeric value increased, red when it decreased, neutral dash when unchanged. Flat damage ranges (merged min/max) show a colored value with no number when changed, neutral dash when unchanged.
- Compare mode is active iff a baseline exists (`baseline !== null`, encoded as `cs=` present).
- Star ids are `${constellationId}:${index}`.

---

### Task 1: Baseline params in the URL hash

**Files:**
- Modify: `web/src/core/urlState.ts` (`encodeHash` ~line 79, `decodeHash` ~line 95)
- Test: `web/test/urlState.test.ts` (append)

**Interfaces:**
- Produces: `encodeHash(selected, pointCap, canonical, benefits?, statCanonical?, baseline?)` where `baseline: { selected: Set<StarId>; pointCap: number } | null = null`; appends `&cs=<bitset>&cp=<cap>` when present. `decodeHash(...)` return type gains `baseline: { selected: Set<StarId>; pointCap: number } | null`. Task 5 consumes both.

- [ ] **Step 1: Write the failing test**

Append to `web/test/urlState.test.ts` (it already imports `encodeHash`, `decodeHash`, `canonicalStarIds`, `canonicalBenefitIds`, and builds `model`; reuse them - check the file's existing imports and add any missing):

```ts
test("round-trips a baseline build as cs=/cp=", () => {
  const canon = canonicalStarIds(model);
  const stat = canonicalBenefitIds(model);
  const cur = new Set<StarId>([canon[0]!, canon[5]!]);
  const base = new Set<StarId>([canon[0]!, canon[9]!]);
  const hash = encodeHash(cur, 55, canon, new Set(), stat, { selected: base, pointCap: 40 });
  expect(hash).toContain("&cs=");
  expect(hash).toContain("&cp=40");
  const decoded = decodeHash(hash, canon, stat)!;
  expect([...decoded.baseline!.selected].sort()).toEqual([...base].sort());
  expect(decoded.baseline!.pointCap).toBe(40);
});

test("no baseline encodes byte-identical to the legacy form and decodes baseline null", () => {
  const canon = canonicalStarIds(model);
  const cur = new Set<StarId>([canon[0]!]);
  const withArg = encodeHash(cur, 55, canon, new Set(), [], null);
  const legacy = encodeHash(cur, 55, canon); // old call shape
  expect(withArg).toBe(legacy);
  expect(decodeHash(withArg, canon).baseline).toBeNull();
});

test("a malformed cs= decodes to a null baseline without throwing", () => {
  const canon = canonicalStarIds(model);
  const decoded = decodeHash("p=55&s=&cs=@@@not-base64@@@&cp=40", canon)!;
  expect(decoded.baseline).toBeNull();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `just test test/urlState.test.ts`
Expected: FAIL - `encodeHash` does not accept a 6th arg (no `cs=` emitted) and `decoded.baseline` is `undefined`.

- [ ] **Step 3: Write minimal implementation**

In `web/src/core/urlState.ts`, change `encodeHash` (lines 79-92) to:

```ts
export function encodeHash(
  selected: Set<StarId>,
  pointCap: number,
  canonical: StarId[],
  benefits: Set<string> = new Set(),
  statCanonical: string[] = [],
  baseline: { selected: Set<StarId>; pointCap: number } | null = null,
): string {
  // p=0 is the uncapped sentinel (0 is otherwise an invalid cap; the real min is 1).
  const cap = Number.isFinite(pointCap) ? pointCap : 0;
  let out = `p=${cap}&s=${encodeBitset(selected, canonical)}`;
  const b = encodeBitset(benefits, statCanonical);
  if (b) out += `&b=${b}`; // only when benefit tags are selected
  if (baseline) {
    // The baseline build rides parallel to the live one; cs= present means "comparison active".
    const bcap = Number.isFinite(baseline.pointCap) ? baseline.pointCap : 0;
    out += `&cs=${encodeBitset(baseline.selected, canonical)}&cp=${bcap}`;
  }
  return out;
}
```

In `decodeHash` (lines 95-118), change the guard and add baseline parsing:

```ts
export function decodeHash(
  hash: string,
  canonical: StarId[],
  statCanonical: string[] = [],
): { selected: Set<StarId>; pointCap: number; benefits: Set<string>; baseline: { selected: Set<StarId>; pointCap: number } | null } | null {
  const raw = hash.replace(/^#/, "").trim();
  if (!raw) return null;
  const params = new URLSearchParams(raw);
  if (!params.has("p") && !params.has("s") && !params.has("b")) return null;

  // p=0 restores the uncapped state; any other value clamps to the finite range.
  let pointCap: number;
  if (params.get("p") === "0") {
    pointCap = Infinity;
  } else {
    pointCap = Number(params.get("p"));
    if (!Number.isFinite(pointCap)) pointCap = MAX_CAP;
    pointCap = Math.max(MIN_CAP, Math.min(MAX_CAP, Math.round(pointCap)));
  }

  const selected = decodeBitset(params.get("s") ?? "", canonical);
  const benefits = decodeBitset(params.get("b") ?? "", statCanonical);

  // Baseline is active only when cs= decodes to a non-empty selection (a stale/empty/malformed
  // cs= simply means "no comparison", matching the tolerance of the other params).
  let baseline: { selected: Set<StarId>; pointCap: number } | null = null;
  const baseSel = decodeBitset(params.get("cs") ?? "", canonical);
  if (baseSel.size > 0) {
    let bcap: number;
    if (params.get("cp") === "0") bcap = Infinity;
    else {
      bcap = Number(params.get("cp"));
      if (!Number.isFinite(bcap)) bcap = MAX_CAP;
      bcap = Math.max(MIN_CAP, Math.min(MAX_CAP, Math.round(bcap)));
    }
    baseline = { selected: baseSel, pointCap: bcap };
  }

  return { selected, pointCap, benefits, baseline };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `just test test/urlState.test.ts`
Expected: PASS (all tests in the file).

- [ ] **Step 5: Commit**

```bash
git add web/src/core/urlState.ts web/test/urlState.test.ts
git commit -m "feat(urlState): carry a baseline build as parallel cs=/cp= params"
```

---

### Task 2: Comparison view-model (`compareBenefits.ts`)

**Files:**
- Create: `web/src/core/compareBenefits.ts`
- Test: `web/test/compareBenefits.test.ts`

**Interfaces:**
- Consumes: `sumBonuses`, `sumPetBonuses` (`aggregate.ts`), `condensedRows`, `classify` exported from `statFormat.ts`, `racialTargets` (`aggregate.ts`).
- Produces: `compareBenefits(model, baseSelected, nowSelected): { player: CompareGroup[]; pet: CompareGroup[] }` with the types below. Task 3 renders it.

```ts
export type Verdict = "up" | "down" | "same";
export interface ComparePart { id: string; label: string; base: string; now: string; delta: string; verdict: Verdict; }
export interface CompareSubject { subject: string; key: string; ids: string[]; verdict: Verdict; parts: ComparePart[]; }
export interface CompareGroup { group: StatGroup; subjects: CompareSubject[]; }
```

This task needs `classify` exported from `statFormat.ts` (today it is module-private). Export it as the first step.

- [ ] **Step 1: Write the failing test**

Create `web/test/compareBenefits.test.ts`:

```ts
// ABOUTME: Tests the baseline-vs-current comparison view-model: per-part base/now/delta and verdicts.
// ABOUTME: Uses the real devotions.json model; picks stars by scanning bonuses so it is data-robust.
import { test, expect } from "bun:test";
import doc from "../../data/devotions.json";
import { buildModel } from "../src/core/model";
import { compareBenefits } from "../src/core/compareBenefits";
import { sumBonuses } from "../src/core/aggregate";

const model = buildModel(doc as any);

// Find one star id that grants a given stat key (for building deterministic selections).
function starGranting(stat: string): string {
  for (const s of model.stars.values()) if (s.bonuses[stat] !== undefined) return s.id;
  throw new Error(`no star grants ${stat}`);
}

test("a stat present in current but not baseline is an up-delta row", () => {
  const star = starGranting("offensiveTotalDamageModifier");
  const now = new Set<string>([star]);
  const base = new Set<string>();
  const { player } = compareBenefits(model, base, now);
  const parts = player.flatMap((g) => g.subjects).flatMap((s) => s.parts);
  const td = parts.find((p) => p.id === "offensiveTotalDamageModifier")!;
  expect(td.verdict).toBe("up");
  expect(td.base).toBe("—"); // em dash for absent
  expect(td.now).not.toBe("—");
});

test("an identical baseline and current yields all 'same' verdicts and a zero/dash delta", () => {
  const star = starGranting("offensiveTotalDamageModifier");
  const sel = new Set<string>([star]);
  const { player } = compareBenefits(model, sel, sel);
  const parts = player.flatMap((g) => g.subjects).flatMap((s) => s.parts);
  expect(parts.length).toBeGreaterThan(0);
  expect(parts.every((p) => p.verdict === "same")).toBe(true);
});

test("union includes a stat present only in the baseline as a down-delta row", () => {
  const star = starGranting("offensiveTotalDamageModifier");
  const base = new Set<string>([star]);
  const now = new Set<string>();
  const { player } = compareBenefits(model, base, now);
  const parts = player.flatMap((g) => g.subjects).flatMap((s) => s.parts);
  const td = parts.find((p) => p.id === "offensiveTotalDamageModifier")!;
  expect(td.verdict).toBe("down");
  expect(td.now).toBe("—");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `just test test/compareBenefits.test.ts`
Expected: FAIL - module `compareBenefits` does not exist.

- [ ] **Step 3: Write minimal implementation**

First, in `web/src/core/statFormat.ts`, export `classify` by adding the `export` keyword to its declaration (line 142, `function classify(id: string): Classified | null {` becomes `export function classify(...)`). (Only `classify` needs exporting; the new module uses its `.sign`/`.percent` fields, not the `Classified` type name.)

Then create `web/src/core/compareBenefits.ts`:

```ts
// ABOUTME: Builds the baseline-vs-current Benefits comparison view-model (per-part base/now/delta).
// ABOUTME: Pure: turns two star selections into grouped subjects with formatted values and verdicts.
import type { DevotionModel, StarId } from "./types";
import { sumBonuses, sumPetBonuses, racialTargets } from "./aggregate";
import { condensedRows, classify, type CondensedPart, type StatGroup } from "./statFormat";

export type Verdict = "up" | "down" | "same";
export interface ComparePart { id: string; label: string; base: string; now: string; delta: string; verdict: Verdict; }
export interface CompareSubject { subject: string; key: string; ids: string[]; verdict: Verdict; parts: ComparePart[]; }
export interface CompareGroup { group: StatGroup; subjects: CompareSubject[]; }

const DASH = "—";
const DIM_LABEL: Record<CondensedPart["dim"], string> = {
  flat: "flat",
  pct: "%",
  max: "max",
  durFlat: "duration",
  durPct: "duration",
};

// The displayed (sign-applied) scalar for a stat id, or undefined when the stat is absent.
function displayed(map: Record<string, number>, id: string): number | undefined {
  const v = map[id];
  if (v === undefined) return undefined;
  const c = classify(id);
  return c ? c.sign * v : v;
}

// Whether a part is a merged flat damage range (id ends in "Min" with a paired "Max").
function rangeMaxId(id: string): string | null {
  return id.endsWith("Min") ? id.slice(0, -3) + "Max" : null;
}

function fmtDelta(n: number): string {
  if (n === 0) return DASH;
  const r = Math.round(n * 100) / 100;
  return r > 0 ? `+${r}` : `${r}`;
}

function buildScope(
  baseMap: Record<string, number>,
  nowMap: Record<string, number>,
  racial: string[],
): CompareGroup[] {
  // Condense each side independently, then index every part by its id so we can union them.
  const sides: { groups: CompareGroup[]; partVal: Map<string, string> }[] = [baseMap, nowMap].map((m) => {
    const groups = condensedRows(m, { racialTarget: racial });
    const partVal = new Map<string, string>();
    for (const g of groups) for (const s of g.subjects) for (const p of s.parts) partVal.set(p.id, p.value);
    return { groups: groups as unknown as CompareGroup[], partVal };
  });
  const [baseSide, nowSide] = sides as [typeof sides[0], typeof sides[0]];

  // The subject/part skeleton (group, subject text, key, dim) comes from the union of both
  // condensed structures; values+verdicts come from the raw maps.
  type Meta = { group: StatGroup; subject: string; key: string; dim: CondensedPart["dim"] };
  const subjMeta = new Map<string, { group: StatGroup; subject: string; ids: string[] }>();
  const partMeta = new Map<string, Meta & { subjKey: string }>();
  for (const m of [baseMap, nowMap]) {
    for (const g of condensedRows(m, { racialTarget: racial })) {
      for (const s of g.subjects) {
        if (!subjMeta.has(s.key)) subjMeta.set(s.key, { group: g.group, subject: s.subject, ids: [] });
        const sm = subjMeta.get(s.key)!;
        for (const p of s.parts) {
          if (!partMeta.has(p.id)) {
            partMeta.set(p.id, { group: g.group, subject: s.subject, key: p.id, dim: p.dim, subjKey: s.key });
            sm.ids.push(p.id);
          }
        }
      }
    }
  }

  // Assemble per group, preserving the GROUP_ORDER / subject order from condensedRows of the union map.
  const out: CompareGroup[] = [];
  const byGroup = new Map<StatGroup, CompareSubject[]>();
  for (const [key, sm] of subjMeta) {
    const parts: ComparePart[] = sm.ids.map((id) => {
      const meta = partMeta.get(id)!;
      const base = baseSide.partVal.get(id) ?? DASH;
      const now = nowSide.partVal.get(id) ?? DASH;
      const maxId = rangeMaxId(id);
      let delta: string;
      let verdict: Verdict;
      if (maxId && (baseMap[maxId] !== undefined || nowMap[maxId] !== undefined)) {
        // Range: compare min+max sums; no scalar delta number.
        const b = (baseMap[id] ?? 0) + (baseMap[maxId] ?? 0);
        const n = (nowMap[id] ?? 0) + (nowMap[maxId] ?? 0);
        verdict = n > b ? "up" : n < b ? "down" : "same";
        delta = verdict === "same" ? DASH : "";
      } else {
        const b = displayed(baseMap, id) ?? 0;
        const n = displayed(nowMap, id) ?? 0;
        verdict = n > b ? "up" : n < b ? "down" : "same";
        delta = fmtDelta(n - b);
      }
      return { id, label: DIM_LABEL[meta.dim], base, now, delta, verdict };
    });
    const verdict: Verdict = parts.every((p) => p.verdict === "same")
      ? "same"
      : parts.some((p) => p.verdict === "up") && !parts.some((p) => p.verdict === "down")
        ? "up"
        : parts.some((p) => p.verdict === "down") && !parts.some((p) => p.verdict === "up")
          ? "down"
          : "same";
    const subj: CompareSubject = { subject: sm.subject, key, ids: sm.ids, verdict, parts };
    if (!byGroup.has(sm.group)) byGroup.set(sm.group, []);
    byGroup.get(sm.group)!.push(subj);
  }
  for (const [group, subjects] of byGroup) {
    subjects.sort((a, b) => a.subject.localeCompare(b.subject));
    out.push({ group, subjects });
  }
  return out;
}

export function compareBenefits(
  model: DevotionModel,
  baseSelected: Set<StarId>,
  nowSelected: Set<StarId>,
): { player: CompareGroup[]; pet: CompareGroup[] } {
  const racial = racialTargets(model, nowSelected);
  return {
    player: buildScope(sumBonuses(model, baseSelected), sumBonuses(model, nowSelected), racial),
    pet: buildScope(sumPetBonuses(model, baseSelected), sumPetBonuses(model, nowSelected), []),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `just test test/compareBenefits.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/core/compareBenefits.ts web/test/compareBenefits.test.ts web/src/core/statFormat.ts
git commit -m "feat(core): compareBenefits view-model for baseline vs current"
```

---

### Task 3: Compare-mode render in the Benefits panel

**Files:**
- Modify: `web/src/adapters/sidebarView.ts` (`renderBenefits`, add a compare branch + a `compareListHtml` helper)
- Modify: `web/src/styles.css` (the B1 table columns + the compare bar + Set baseline button)
- Test: `web/test/compare-render.test.ts` (new)

**Interfaces:**
- Consumes: `compareBenefits` (Task 2) types/function.
- Produces: `renderBenefits(..., baselineSelected: Set<StarId> | null = null)` - when non-null, renders the B1 table. The header emits `<button id="set-baseline">` (off) or a `.cmp-bar` with `<button id="cmp-update">`/`<button id="cmp-clear">` (on). Tag attributes `data-gkey`/`data-ids` (subject) and `data-vid` (part) are preserved. Task 5 wires the buttons.

- [ ] **Step 1: Write the failing test**

Create `web/test/compare-render.test.ts`:

```ts
// ABOUTME: renderBenefits compare mode emits the Base/Now/Delta table, keeps tag attributes on labels,
// ABOUTME: and shows the compare control bar; off mode is unchanged. Uses real model data.
import { test, expect } from "bun:test";
import doc from "../../data/devotions.json";
import { buildModel } from "../src/core/model";
import { renderBenefits } from "../src/adapters/sidebarView";
import { canonicalBenefitIds } from "../src/core/urlState";

const model = buildModel(doc as any);
const statCanon = canonicalBenefitIds(model);

function starGranting(stat: string): string {
  for (const s of model.stars.values()) if (s.bonuses[stat] !== undefined) return s.id;
  throw new Error(`no star grants ${stat}`);
}
function render(selected: Set<string>, baseline: Set<string> | null): string {
  const el = { innerHTML: "" } as any as HTMLElement;
  renderBenefits(el, model, selected, undefined, new Set(), [], undefined, undefined, [], undefined, baseline);
  return (el as any).innerHTML as string;
}

test("off mode (no baseline) renders the Set baseline button, no compare bar", () => {
  const html = render(new Set([starGranting("offensiveTotalDamageModifier")]), null);
  expect(html).toContain('id="set-baseline"');
  expect(html).not.toContain("cmp-bar");
});

test("compare mode renders the compare bar and Base/Now/Delta columns", () => {
  const star = starGranting("offensiveTotalDamageModifier");
  const html = render(new Set([star]), new Set());
  expect(html).toContain("cmp-bar");
  expect(html).toContain('id="cmp-update"');
  expect(html).toContain('id="cmp-clear"');
  expect(html).toContain("cmp-col"); // the Base/Now/Delta cells
});

test("compare mode keeps the part tag attribute on the clickable label", () => {
  const star = starGranting("offensiveTotalDamageModifier");
  const html = render(new Set([star]), new Set());
  expect(html).toContain('data-vid="offensiveTotalDamageModifier"');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `just test test/compare-render.test.ts`
Expected: FAIL - `renderBenefits` ignores the 11th arg; no `set-baseline`/`cmp-bar`/`cmp-col` in output.

- [ ] **Step 3: Write minimal implementation**

In `web/src/adapters/sidebarView.ts`, add the import at the top alongside the existing core imports:

```ts
import { compareBenefits, type CompareGroup } from "../core/compareBenefits";
```

Add the `baselineSelected` parameter to `renderBenefits` (after `availablePetKeys`):

```ts
  availablePetKeys?: Set<string>,
  baselineSelected: Set<StarId> | null = null,
): { bonuses: Record<string, number>; petBonuses: Record<string, number>; availHtml: string; petAvailHtml: string } {
```

Add this compare renderer as a module-level function (above `renderBenefits`):

```ts
// Compare mode: one line per part with Base / Now / Delta cells. The subject and part LEFT labels
// keep the same tag attributes as the normal view (data-gkey/data-ids, data-vid) so tagging is
// unchanged; the value cells are inert. keyOf namespaces ids per scope (player vs pet).
function compareListHtml(groups: CompareGroup[], keyOf: (id: string) => string, selectedBenefits: Set<string>): string {
  const cell = (v: string, verdict: string) => `<span class="cmp-col ${verdict}">${v}</span>`;
  const partRow = (p: CompareGroup["subjects"][number]["parts"][number]) => {
    const vid = keyOf(p.id);
    const sel = selectedBenefits.has(vid) ? " vsel" : "";
    return (
      `<div class="cmp-part${sel}">` +
      `<span class="cmp-lbl" data-vid="${vid}">${p.label}</span>` +
      cell(p.base, "base") + cell(p.now, p.verdict) + cell(p.delta, p.verdict) +
      `</div>`
    );
  };
  const subjBlock = (s: CompareGroup["subjects"][number]) => {
    const ids = s.ids.map(keyOf);
    const gsel = ids.length > 0 && ids.every((k) => selectedBenefits.has(k)) ? " gsel" : "";
    return (
      `<div class="cmp-grp${gsel}" data-gkey="${keyOf(s.key)}" data-ids="${ids.join(",")}">` +
      `<div class="cmp-subj"><span class="cmp-lbl" data-gtoggle>${s.subject}</span></div>` +
      s.parts.map(partRow).join("") +
      `</div>`
    );
  };
  return groups.map((g) => `<h3>${g.group}</h3>${g.subjects.map(subjBlock).join("")}`).join("");
}
```

In `renderBenefits`, branch at the `el.innerHTML` assignment (lines 141-144). Replace it with:

```ts
  if (baselineSelected) {
    const cmp = compareBenefits(model, baselineSelected, selected);
    const bar =
      `<div class="cmp-bar">Comparing to baseline` +
      `<span class="cmp-actions"><button id="cmp-update" type="button">Update</button>` +
      `<button id="cmp-clear" type="button">Clear</button></span></div>`;
    const header = `<div class="cmp-head"><span class="cmp-lbl"></span><span class="cmp-col">Base</span><span class="cmp-col">Now</span><span class="cmp-col">&Delta;</span></div>`;
    const playerHtml = compareListHtml(cmp.player, (id) => id, selectedBenefits);
    const petHtml = compareListHtml(cmp.pet, (id) => `pet:${id}`, selectedBenefits);
    el.innerHTML =
      `<h2>Benefits<button id="set-baseline" class="hidden" type="button"></button></h2>${bar}${header}` +
      (playerHtml || '<div class="bempty">Select stars to gain benefits.</div>') +
      (petHtml ? `<h2 class="avail-head">Bonus to All Pets</h2>${petHtml}` : "") +
      (powers.length ? `<h3>Celestial Powers</h3>${powerRows}` : "");
  } else {
    el.innerHTML =
      `<h2>Benefits<button id="set-baseline" type="button">Set baseline</button></h2>` +
      `${activeHtml || '<div class="bempty">Select stars to gain benefits.</div>'}` +
      (petActiveHtml ? `<h2 class="avail-head">Bonus to All Pets</h2>${petActiveHtml}` : "") +
      (powers.length ? `<h3>Celestial Powers</h3>${powerRows}` : "");
  }
```

(The `set-baseline` button stays in the DOM but hidden during compare mode so Task 5 can rely on it existing; the compare bar's Update/Clear are the active controls then.)

In `web/src/styles.css`, append the compare styles:

```css
/* Baseline comparison: widened benefits panel + Base/Now/Delta table */
body.comparing #benefits { width: 430px; }
.cmp-bar { display:flex; align-items:center; gap:8px; background:#1b2531; border:1px solid #283446; border-radius:6px; padding:6px 9px; margin:6px 0 10px; font-size:0.78rem; color:#d7c89a; }
.cmp-actions { margin-left:auto; display:flex; gap:6px; }
.cmp-actions button { background:#161d27; border:1px solid #283446; border-radius:4px; padding:1px 8px; font-size:0.72rem; cursor:pointer; }
#cmp-update { color:#83c995; } #cmp-clear { color:#7e8aa0; }
#set-baseline { float:right; background:#1b2531; border:1px solid #283446; border-radius:4px; color:#d7c89a; font-size:0.68rem; padding:1px 7px; cursor:pointer; }
#set-baseline.hidden { display:none; }
.cmp-head { display:flex; font-size:0.62rem; text-transform:uppercase; letter-spacing:.04em; color:#7e8aa0; border-bottom:1px solid #283446; padding-bottom:4px; margin-bottom:5px; }
.cmp-head .cmp-lbl { flex:1; }
.cmp-grp { border-radius:6px; margin:5px 0; }
.cmp-grp.gsel { background:#20313f; box-shadow:inset 3px 0 0 #e3c97a; }
.cmp-subj .cmp-lbl { color:#d7c89a; cursor:pointer; }
.cmp-part { display:flex; align-items:center; font-size:0.78rem; padding:2px 4px; }
.cmp-part.vsel { background:#20313f; box-shadow:inset 3px 0 0 #e3c97a; border-radius:4px; }
.cmp-subj { display:flex; padding:3px 4px 1px; font-size:0.8rem; }
.cmp-part .cmp-lbl { flex:1; color:#7e8aa0; padding-left:12px; cursor:pointer; }
.cmp-subj .cmp-lbl { flex:1; }
.cmp-lbl:hover { text-decoration:underline; }
.cmp-col { width:58px; text-align:right; font-variant-numeric:tabular-nums; color:#c9d3e0; }
.cmp-col.base { color:#7e8aa0; } .cmp-col.up { color:#83c995; } .cmp-col.down { color:#e0696a; } .cmp-col.same { color:#566175; }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `just test test/compare-render.test.ts`
Expected: PASS. Also run `just test test/sidebar-benefits.test.ts` to confirm off-mode is unchanged.

- [ ] **Step 5: Commit**

```bash
git add web/src/adapters/sidebarView.ts web/src/styles.css web/test/compare-render.test.ts
git commit -m "feat(benefits): compare-mode Base/Now/Delta table render"
```

---

### Task 4: Added/removed star marks on the map

**Files:**
- Modify: `web/src/adapters/svgRenderer.ts` (`RenderOpts`, `renderSvgMarkup` star layer, `SvgHandle.update` + the inner `render`/`update`)
- Modify: `web/src/styles.css` (`.star.cmp-add`, `.star.cmp-rm`)
- Test: `web/test/svgRenderer.test.ts` (append)

**Interfaces:**
- Consumes: a compare diff `{ added: Set<StarId>; removed: Set<StarId> } | null` in `RenderOpts.diff` and as a 4th `update` arg.
- Produces: every star is already drawn once in the star layer; a star in `added` gets a `cmp-add` class on its visible marker, one in `removed` gets `cmp-rm`. Task 5 supplies the diff via `handle.update(state, highlight, reach, diff)`.

- [ ] **Step 1: Write the failing test**

Append to `web/test/svgRenderer.test.ts` (it already imports `renderSvgMarkup` and builds `model`; the tests call the pure function and assert on the returned string):

```ts
test("compare diff marks added stars cmp-add and removed stars cmp-rm", () => {
  const added = "crossroads_eldritch:0";
  const removed = "bat:0";
  const markup = renderSvgMarkup(
    model,
    { selected: new Set([added]), pointCap: 55 },
    { manifest: null, diff: { added: new Set([added]), removed: new Set([removed]) } },
  );
  // the added star is selected -> selected marker + cmp-add; the removed star is unselected + cmp-rm
  expect(markup).toContain("cmp-add");
  expect(markup).toContain("cmp-rm");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `just test test/svgRenderer.test.ts`
Expected: FAIL - `RenderOpts` has no `diff`; no `cmp-add`/`cmp-rm` in the markup.

- [ ] **Step 3: Write minimal implementation**

In `web/src/adapters/svgRenderer.ts`, add `diff` to the `RenderOpts` interface (lines 50-54):

```ts
export interface RenderOpts {
  manifest: AssetManifest | null;
  highlight?: Set<StarId>;
  reach?: ReachView;
  diff?: { added: Set<StarId>; removed: Set<StarId> } | null;
}
```

In `renderSvgMarkup`, read the diff near the top (after `const reach = opts.reach;`, line 126):

```ts
  const diff = opts.diff ?? null;
```

In the star layer loop (lines 213-232), every star is already drawn once, so just append a compare class to the visible marker. Add this line where the other class fragments (`m`, `cd`) are computed (~line 225):

```ts
    const cmp = diff ? (diff.added.has(star.id) ? " cmp-add" : diff.removed.has(star.id) ? " cmp-rm" : "") : "";
```

and include `${cmp}` in the visible marker's class list (both branches at lines 227-229):

```ts
    const visible = star.celestialPower
      ? `<polygon class="star power ${st}${m}${cd}${cmp}" points="${diamondPoints(cx, cy, POWER_RADIUS)}" style="${style}"/>`
      : `<circle class="star ${st}${m}${cd}${cmp}" cx="${cx}" cy="${cy}" r="${STAR_RADIUS}" style="${style}"/>`;
```

Widen the `SvgHandle.update` type (line 241) and the inner `render` + returned `update` so the diff reaches `renderSvgMarkup`:

```ts
// interface SvgHandle:
  update(state: SelectionState, highlight?: Set<StarId>, reach?: ReachView, diff?: { added: Set<StarId>; removed: Set<StarId> } | null): void;

// inner render (line 254):
  function render(state: SelectionState, highlight?: Set<StarId>, reach?: ReachView, diff?: { added: Set<StarId>; removed: Set<StarId> } | null) {
    container.innerHTML = renderSvgMarkup(model, state, { manifest: deps.manifest, highlight, reach, diff });
  }

// returned update (the object near line 290): pass diff through to render(state, highlight, reach, diff)
```

In `web/src/styles.css`, append (the visible dot is a `.star`; the added marker keeps its fill and gains a green ring, the removed marker is an unselected dot ringed red dashed):

```css
.star.cmp-add { stroke:#83c995; stroke-width:2.5; }
.star.cmp-rm { stroke:#e0696a; stroke-width:1.5; stroke-dasharray:3 2; }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `just test test/svgRenderer.test.ts`
Expected: PASS (all tests in the file).

- [ ] **Step 5: Commit**

```bash
git add web/src/adapters/svgRenderer.ts web/src/styles.css web/test/svgRenderer.test.ts
git commit -m "feat(map): mark added/removed stars vs baseline"
```

---

### Task 5: Wire the baseline state, controls, and URL in main.ts

**Files:**
- Modify: `web/src/app/main.ts` (baseline state, Set/Update/Clear handlers, diff, pass-throughs, restore)
- Modify: `web/e2e/smoke.ts` (one compare-mode assertion block)
- Test: build + `just e2e` (the smoke addition); manual browser check

**Interfaces:**
- Consumes: `decodeHash().baseline`, `encodeHash(..., baseline)` (Task 1); `renderBenefits(..., baselineSelected)` (Task 3); `handle.update(..., diff)` (Task 4).
- Produces: end-to-end compare mode in the deployed app.

- [ ] **Step 1: Write the failing test**

In `web/e2e/smoke.ts`, after the existing assertions, add a compare-mode block (mirror the file's `check(...)` + `cdp.evaluate` style):

```ts
  // Baseline comparison: set a baseline, then confirm the panel enters compare mode and the URL carries cs=.
  await cdp.evaluate(`document.getElementById('set-baseline').click()`);
  let cmp = false;
  for (let i = 0; i < 20; i++) {
    await Bun.sleep(100);
    if (await cdp.evaluate<boolean>("document.querySelector('.cmp-bar') !== null")) { cmp = true; break; }
  }
  check(cmp, "Set baseline enters compare mode (.cmp-bar renders)");
  check(await cdp.evaluate<boolean>("location.hash.includes('cs=')"), "baseline rides in the URL as cs=");
  check(await cdp.evaluate<boolean>("document.body.classList.contains('comparing')"), "body.comparing toggles the widened panel");
  await cdp.evaluate(`document.getElementById('cmp-clear').click()`);
  check(
    await cdp.evaluate<boolean>("document.querySelector('.cmp-bar') === null && !location.hash.includes('cs=')"),
    "Clear exits compare mode and drops cs= from the URL",
  );
```

- [ ] **Step 2: Run test to verify it fails**

Run: `just e2e`
Expected: FAIL on the new checks - nothing wires `set-baseline`, so `.cmp-bar` never appears.

- [ ] **Step 3: Write minimal implementation**

In `web/src/app/main.ts`:

1. Add the baseline state beside `state` (near main.ts:57): `let baseline: SelectionState | null = restored?.baseline ?? null;` (where `restored` is the existing `decodeHash` result; if the existing variable has a different name, use it).

2. In `refresh()` (main.ts:350-383):
   - Toggle the body class: `document.body.classList.toggle("comparing", baseline !== null);`
   - Compute the diff and pass it to the renderer:
     ```ts
     const diff = baseline ? { added: new Set([...state.selected].filter((s) => !baseline!.selected.has(s))), removed: new Set([...baseline.selected].filter((s) => !state.selected.has(s))) } : null;
     handle.update(state, taggedStars(), reach, diff);
     ```
   - Pass the baseline selection to the benefits render. Find `renderBenefitsPanel()` (around main.ts:366) and thread `baseline?.selected ?? null` into its `renderBenefits(...)` call as the new last argument.
   - Include baseline in the hash:
     ```ts
     `#${encodeHash(state.selected, state.pointCap, canonical, selectedBenefits, benefitCanonical, baseline)}`,
     ```

3. Add click handlers (near the other delegated click wiring). The benefits panel buttons:
   ```ts
   benefitsEl.addEventListener("click", (e) => {
     const t = e.target as HTMLElement;
     if (t.id === "set-baseline") { baseline = { selected: new Set(state.selected), pointCap: state.pointCap }; refresh(); }
     else if (t.id === "cmp-update") { baseline = { selected: new Set(state.selected), pointCap: state.pointCap }; refresh(); }
     else if (t.id === "cmp-clear") { baseline = null; refresh(); }
   });
   ```
   (If the file already delegates benefits clicks for tagging, add these id checks at the top of that existing handler instead of a second listener, returning after handling so a control click is not also treated as a tag toggle.)

- [ ] **Step 4: Run test to verify it passes**

Run: `just e2e`
Expected: PASS including the new compare-mode checks. Then `just check` for the unit suite + lint + typecheck.

- [ ] **Step 5: Commit**

```bash
git add web/src/app/main.ts web/e2e/smoke.ts
git commit -m "feat(planner): wire baseline comparison state, controls, and URL"
```

---

## Manual verification (after Task 5)

`just serve`, open http://localhost:5173. Select a few constellations, click "Set baseline" in the Benefits header. Confirm: the panel widens into Base / Now / Δ columns with an "Update / Clear" bar; deselecting/adding a constellation updates the Now and Δ columns with green/red; the map shows a green ring on added stars and a red dashed mark where a baseline star was removed; the URL hash gains `cs=`/`cp=`; copy the URL into a new tab and confirm the comparison restores. Click Update (deltas reset to zero) and Clear (back to the single-column panel, current build intact).

## Self-review notes

- Spec coverage: URL params (Task 1), comparison view-model incl. union + range handling + verdicts (Task 2), B1 compare render + tagging + controls + CSS (Task 3), map added/removed (Task 4), state/controls/wiring/restore (Task 5). Scope stays Benefits-only; affinity/points untouched.
- The spec said the delta helper lives in `statFormat.ts`; this plan adds `compareBenefits.ts` instead (noted in the header) and exports `classify`/`Classified` from statFormat for reuse.
- Type consistency: `baseline: { selected: Set<StarId>; pointCap: number } | null` is the shape in urlState, main (`SelectionState` is structurally identical), and the render param `baselineSelected: Set<StarId> | null`. `CompareGroup`/`CompareSubject`/`ComparePart`/`Verdict` are defined in Task 2 and consumed in Task 3. The map diff `{ added; removed }` is defined in Task 4 and produced in Task 5.
- Tasks 1-4 are unit-TDD'd; Task 5 (composition root) is verified by the e2e smoke addition plus the manual check, matching how the planner's wiring is tested today.
