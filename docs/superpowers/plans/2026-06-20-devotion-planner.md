# Devotion Planner v1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a static, single-page web app that renders the Grim Dawn devotion map, lets the player pick valid stars under the game rules, and shows cumulative benefits plus affinity totals.

**Architecture:** Hexagonal. A pure, framework-free domain core (`web/src/core/`) holds all rules and aggregation and is unit-tested with `bun test`. Thin adapters (`web/src/adapters/`) handle fetch, SVG rendering, pan/zoom, and DOM views. `web/src/app/main.ts` wires them and owns the `SelectionState`.

**Tech Stack:** TypeScript, Bun (deps + bundler + test runner + static serve), SVG/CSS, `just` task runner. Python/uv + Crate's `ArchiveTool` for the optional art pipeline.

## Global Constraints

- Data source is `data/devotions.json` at the repo root (86 constellations, 438 stars). Tests import it directly.
- The five affinities, lowercased, are exactly: `ascendant, chaos, eldritch, order, primordial`.
- Star global id format is `` `${constellationId}:${index}` `` (e.g. `bat:0`).
- Devotion point cap is **55**; slider default is **55**.
- Like-stat bonuses stack **additively** (sum values sharing a stat id).
- **Every created file (source AND test) MUST begin with a 2-line `ABOUTME:` header** describing what it does (repo convention). `.ts`/`.js`: `// ABOUTME: …` on two lines. `.css`: `/* ABOUTME: … */` on two lines. `.py` scripts: the two `# ABOUTME: …` lines go immediately after the shebang, before the PEP 723 block. `index.html`: `<!-- ABOUTME: … -->`. The `types.ts` template (Task 2) shows the exact format; other code templates omit it for brevity but it is required on all of them.
- Documentation and comments use no emojis, em-dashes, or hyperbole.
- No image assets are committed. `assets/`, `web/dist/`, and `web/node_modules/` are git-ignored.
- The app must work with zero art (SVG dots) and only overlay art when `assets/devotions/manifest.json` is present.
- All runtime asset references are **relative** (e.g. `./data/…`, `./assets/…`), so the site works unchanged under a GitHub Pages project subpath (`/<repo>/`). The end-goal deliverable is a GitHub Pages deploy (Task 16).
- Affinity is granted only by **completing** a whole constellation. An **incomplete** constellation grants nothing, so its entry star needs affinity from *elsewhere* to be added. But a **completed** constellation's affinity counts toward the total pool, **including its own requirement**, so once a constellation is self-sustaining (its own grant is at least its requirement) you can remove the bootstrap Crossroads stars that opened it, and it stays valid. (E.g. Crossroads `primordial:1` opens Eel; completing Eel grants `primordial:5`; deselect the Crossroads and Eel still satisfies its own `primordial:1`.)

---

### Task 1: Scaffold `web/`, Bun toolchain, and `just test`

**Files:**
- Create: `web/package.json`
- Create: `web/tsconfig.json`
- Create: `web/src/core/smoke.test.ts`
- Modify: `.gitignore` (append web/python ignores)
- Modify: `justfile` (bun in `install`/`doctor`; add `web-install`, `test`)

**Interfaces:**
- Consumes: nothing.
- Produces: a working `just test` that runs `bun test` against `web/`.

- [ ] **Step 1: Create `web/package.json`**

```json
{
  "name": "grimdawn-devotion-planner",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "bun test",
    "build": "bun build src/app/main.ts --outdir dist --target browser",
    "serve": "bun --bun x serve dist"
  },
  "devDependencies": {
    "typescript": "^5.5.0"
  }
}
```

- [ ] **Step 2: Create `web/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "resolveJsonModule": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "types": ["bun-types"],
    "lib": ["ES2022", "DOM", "DOM.Iterable"]
  },
  "include": ["src", "test"]
}
```

- [ ] **Step 3: Write the smoke test** in `web/src/core/smoke.test.ts`

```ts
import { test, expect } from "bun:test";

test("bun test runs", () => {
  expect(1 + 1).toBe(2);
});
```

- [ ] **Step 4: Append to `.gitignore`**

```gitignore
# Web app
web/node_modules/
web/dist/
web/bun.lockb

# Optimized art (regenerate with `just assets`) - never committed
/assets/
```

- [ ] **Step 5: Add bun to the justfile**

Add a check line inside the `doctor` recipe's "Tools:" block (after the `winget` check):

```bash
    check bun  "run 'just install' (winget install Oven-sh.Bun) then open a new shell"
    check jq   "run 'just install' (winget install jqlang.jq) then open a new shell"
```

Add a bun install to the `install-uv`/`install` area. Append this recipe:

```make
# Install bun (web toolchain) via winget if missing
install-bun:
    #!/usr/bin/env bash
    set -euo pipefail
    if command -v bun >/dev/null 2>&1; then echo "bun already installed: $(bun --version)"; exit 0; fi
    echo "Installing bun via winget..."
    winget install --id Oven-sh.Bun -e --accept-source-agreements --accept-package-agreements
    echo "bun installed. NOTE: open a new shell so 'bun' is on PATH."

# Install jq (JSON CLI) via winget if missing
install-jq:
    #!/usr/bin/env bash
    set -euo pipefail
    if command -v jq >/dev/null 2>&1; then echo "jq already installed: $(jq --version)"; exit 0; fi
    echo "Installing jq via winget..."
    winget install --id jqlang.jq -e --accept-source-agreements --accept-package-agreements
    echo "jq installed. NOTE: open a new shell so 'jq' is on PATH."
```

Change the `install` recipe dependency line from `install: install-uv` to:

```make
install: install-uv install-bun install-jq
```

Add web recipes at the end:

```make
# Install web dependencies (bun)
web-install:
    cd "{{justfile_directory()}}/web" && bun install

# Run the core test suite
test:
    cd "{{justfile_directory()}}/web" && bun test
```

- [ ] **Step 6: Install + run**

Run: `just web-install && just test`
Expected: bun installs typescript; `smoke.test.ts` passes (`1 pass`).

- [ ] **Step 7: Commit**

```bash
git add web/package.json web/tsconfig.json web/src/core/smoke.test.ts .gitignore justfile
git commit -m "chore(web): scaffold bun + typescript project and just test"
```

---

### Task 2: Domain types + `buildModel`

**Files:**
- Create: `web/src/core/types.ts`
- Create: `web/src/core/model.ts`
- Test: `web/test/model.test.ts`

**Interfaces:**
- Consumes: `data/devotions.json`.
- Produces:
  - `types.ts`: `Affinity`, `AffinityMap = Partial<Record<Affinity, number>>`, `StarId = string`, `Star`, `Constellation`, `DevotionModel`, `SelectionState`, `AFFINITIES: Affinity[]`.
  - `model.ts`: `buildModel(doc: DevotionsDoc): DevotionModel`.

- [ ] **Step 1: Write the failing test** in `web/test/model.test.ts`

```ts
import { test, expect } from "bun:test";
import doc from "../../data/devotions.json";
import { buildModel } from "../src/core/model";

const model = buildModel(doc as any);

test("indexes every constellation and star", () => {
  expect(model.constellations.size).toBe(86);
  expect(model.stars.size).toBe(438);
});

test("star global ids and predecessor links resolve to ids", () => {
  const bat0 = model.stars.get("bat:0")!;
  const bat1 = model.stars.get("bat:1")!;
  expect(bat0.predecessors).toEqual([]);
  expect(bat1.predecessors).toEqual(["bat:0"]);
  expect(bat0.position).toEqual({ x: -968, y: 80 });
  expect(bat0.bonuses.offensiveLifeModifier).toBe(15);
});

test("constellation carries affinity req/bonus and member ids", () => {
  const bat = model.constellations.get("bat")!;
  expect(bat.affinityRequired).toEqual({ eldritch: 1 });
  expect(bat.affinityBonus).toEqual({ chaos: 2, eldritch: 3 });
  expect(bat.starIds).toEqual(["bat:0", "bat:1", "bat:2", "bat:3", "bat:4"]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && bun test test/model.test.ts`
Expected: FAIL, cannot find `../src/core/model`.

- [ ] **Step 3: Write `web/src/core/types.ts`**

```ts
// ABOUTME: Core domain types for the devotion planner (affinities, stars, model, selection).
// ABOUTME: Pure data shapes with no DOM or IO dependencies.
export type Affinity = "ascendant" | "chaos" | "eldritch" | "order" | "primordial";
export const AFFINITIES: Affinity[] = ["ascendant", "chaos", "eldritch", "order", "primordial"];

export type AffinityMap = Partial<Record<Affinity, number>>;
export type StarId = string; // `${constellationId}:${index}`

export interface Star {
  id: StarId;
  constellationId: string;
  index: number;
  predecessors: StarId[];
  position: { x: number; y: number };
  bonuses: Record<string, number>;
  celestialPower: { name: string } | null;
  weaponRequirement: { weapons: string[] } | null;
}

export interface Constellation {
  id: string;
  name: string;
  tier: number | null;
  affinityRequired: AffinityMap;
  affinityBonus: AffinityMap;
  background: { image: string | null; x: number | null; y: number | null } | null;
  starIds: StarId[];
}

export interface DevotionModel {
  stars: Map<StarId, Star>;
  constellations: Map<string, Constellation>;
}

export interface SelectionState {
  selected: Set<StarId>;
  pointCap: number;
}
```

- [ ] **Step 4: Write `web/src/core/model.ts`**

```ts
import type { Constellation, DevotionModel, Star, StarId } from "./types";

interface RawStar {
  index: number;
  predecessors: number[];
  position: { x: number; y: number };
  bonuses: Record<string, number>;
  celestial_power: { name: string | null } | null;
  weapon_requirement: { weapons: string[] } | null;
}
interface RawConstellation {
  id: string;
  name: string;
  tier: number | null;
  affinity_required: Record<string, number>;
  affinity_bonus: Record<string, number>;
  background: { image: string | null; x: number | null; y: number | null } | null;
  stars: RawStar[];
}
export interface DevotionsDoc {
  constellations: RawConstellation[];
}

export function buildModel(doc: DevotionsDoc): DevotionModel {
  const stars = new Map<StarId, Star>();
  const constellations = new Map<string, Constellation>();

  for (const c of doc.constellations) {
    const starIds: StarId[] = c.stars.map((s) => `${c.id}:${s.index}`);
    for (const s of c.stars) {
      const id = `${c.id}:${s.index}`;
      stars.set(id, {
        id,
        constellationId: c.id,
        index: s.index,
        predecessors: s.predecessors.map((p) => `${c.id}:${p}`),
        position: s.position,
        bonuses: s.bonuses,
        celestialPower: s.celestial_power && s.celestial_power.name
          ? { name: s.celestial_power.name }
          : null,
        weaponRequirement: s.weapon_requirement
          ? { weapons: s.weapon_requirement.weapons }
          : null,
      });
    }
    constellations.set(c.id, {
      id: c.id,
      name: c.name,
      tier: c.tier,
      affinityRequired: c.affinity_required,
      affinityBonus: c.affinity_bonus,
      background: c.background,
      starIds,
    });
  }
  return { stars, constellations };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd web && bun test test/model.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add web/src/core/types.ts web/src/core/model.ts web/test/model.test.ts
git commit -m "feat(core): types and buildModel graph indexing"
```

---

### Task 3: Affinity totals + completion

**Files:**
- Create: `web/src/core/affinity.ts`
- Test: `web/test/affinity.test.ts`

**Interfaces:**
- Consumes: `DevotionModel`, `StarId`, `Affinity`, `AffinityMap` from Task 2.
- Produces:
  - `completedConstellations(model, selected: Set<StarId>): Set<string>`
  - `affinityFrom(model, completedIds: Iterable<string>): Record<Affinity, number>`
  - `affinityTotals(model, selected: Set<StarId>): Record<Affinity, number>`
  - `meetsRequirement(have: Record<Affinity, number>, need: AffinityMap): boolean`

- [ ] **Step 1: Write the failing test** in `web/test/affinity.test.ts`

```ts
import { test, expect } from "bun:test";
import doc from "../../data/devotions.json";
import { buildModel } from "../src/core/model";
import {
  completedConstellations, affinityTotals, meetsRequirement,
} from "../src/core/affinity";

const model = buildModel(doc as any);

test("a single-star Crossroads completes when its star is taken", () => {
  const completed = completedConstellations(model, new Set(["crossroads_eldritch:0"]));
  expect(completed.has("crossroads_eldritch")).toBe(true);
});

test("an incomplete constellation grants no affinity", () => {
  const totals = affinityTotals(model, new Set(["bat:0"]));
  expect(totals.eldritch).toBe(0);
});

test("completed Crossroads grants its affinity", () => {
  const totals = affinityTotals(model, new Set(["crossroads_eldritch:0"]));
  expect(totals.eldritch).toBe(1);
  expect(totals.chaos).toBe(0);
});

test("meetsRequirement compares per-affinity", () => {
  expect(meetsRequirement({ ascendant: 0, chaos: 0, eldritch: 1, order: 0, primordial: 0 }, { eldritch: 1 })).toBe(true);
  expect(meetsRequirement({ ascendant: 0, chaos: 0, eldritch: 0, order: 0, primordial: 0 }, { eldritch: 1 })).toBe(false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && bun test test/affinity.test.ts`
Expected: FAIL, cannot find `../src/core/affinity`.

- [ ] **Step 3: Write `web/src/core/affinity.ts`**

```ts
import { AFFINITIES, type Affinity, type AffinityMap, type DevotionModel, type StarId } from "./types";

export function completedConstellations(model: DevotionModel, selected: Set<StarId>): Set<string> {
  const out = new Set<string>();
  for (const c of model.constellations.values()) {
    if (c.starIds.length > 0 && c.starIds.every((id) => selected.has(id))) out.add(c.id);
  }
  return out;
}

function zeroAffinity(): Record<Affinity, number> {
  return { ascendant: 0, chaos: 0, eldritch: 0, order: 0, primordial: 0 };
}

export function affinityFrom(model: DevotionModel, completedIds: Iterable<string>): Record<Affinity, number> {
  const totals = zeroAffinity();
  for (const id of completedIds) {
    const c = model.constellations.get(id);
    if (!c) continue;
    for (const a of AFFINITIES) {
      const v = c.affinityBonus[a];
      if (v) totals[a] += v;
    }
  }
  return totals;
}

export function affinityTotals(model: DevotionModel, selected: Set<StarId>): Record<Affinity, number> {
  return affinityFrom(model, completedConstellations(model, selected));
}

export function meetsRequirement(have: Record<Affinity, number>, need: AffinityMap): boolean {
  for (const a of AFFINITIES) {
    const n = need[a] ?? 0;
    if (have[a] < n) return false;
  }
  return true;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && bun test test/affinity.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add web/src/core/affinity.ts web/test/affinity.test.ts
git commit -m "feat(core): affinity totals, completion, requirement check"
```

---

### Task 4: `validClosure` (fixpoint pruning, used as the removal guard)

**Files:**
- Create: `web/src/core/rules.ts`
- Test: `web/test/rules-closure.test.ts`

**Interfaces:**
- Consumes: Task 2 + Task 3 exports.
- Produces: `validClosure(model: DevotionModel, selected: Set<StarId>): Set<StarId>`.
  Rule: a star survives iff all its predecessors survive AND, if it is an **entry star** (no predecessors), the constellation's `affinityRequired` is met by the affinity pool from **all completed constellations, including its own once complete**. (An incomplete constellation contributes 0, so a partial/lone constellation still needs external affinity; a fully-completed one can satisfy its own requirement, enabling Crossroads bootstrap removal.)

- [ ] **Step 1: Write the failing test** in `web/test/rules-closure.test.ts`

```ts
import { test, expect } from "bun:test";
import doc from "../../data/devotions.json";
import { buildModel } from "../src/core/model";
import { validClosure } from "../src/core/rules";

const model = buildModel(doc as any);

test("drops a star whose predecessor is absent", () => {
  const closed = validClosure(model, new Set(["crossroads_eldritch:0", "bat:0", "bat:2"]));
  expect(closed.has("bat:2")).toBe(false); // bat:2 needs bat:1
  expect(closed.has("bat:0")).toBe(true);
});

test("drops an entry star whose affinity requirement is unmet", () => {
  // bat needs eldritch:1, but nothing grants it here
  const closed = validClosure(model, new Set(["bat:0"]));
  expect(closed.has("bat:0")).toBe(false);
});

test("keeps a gated chain when affinity is satisfied", () => {
  const closed = validClosure(model, new Set(["crossroads_eldritch:0", "bat:0", "bat:1"]));
  expect(closed.has("bat:0")).toBe(true);
  expect(closed.has("bat:1")).toBe(true);
});

test("prunes an inconsistent set (the property the removal guard relies on)", () => {
  // bat is incomplete (2 of 5) so it grants nothing; with no eldritch, bat:0's
  // requirement is unmet -> bat:0 and its dependent bat:1 are pruned.
  const closed = validClosure(model, new Set(["bat:0", "bat:1"]));
  expect(closed.size).toBe(0);
});

test("a completed constellation sustains its own requirement (bootstrap removable)", () => {
  // Eel is 3 stars, requires primordial:1, grants primordial:5 when complete.
  // With all of Eel selected and NO Crossroads, Eel's own affinity keeps it valid.
  const closed = validClosure(model, new Set(["eel:0", "eel:1", "eel:2"]));
  expect(closed.size).toBe(3);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && bun test test/rules-closure.test.ts`
Expected: FAIL, cannot find `../src/core/rules`.

- [ ] **Step 3: Write `web/src/core/rules.ts`**

```ts
import type { DevotionModel, StarId } from "./types";
import { affinityFrom, completedConstellations, meetsRequirement } from "./affinity";

export function validClosure(model: DevotionModel, selected: Set<StarId>): Set<StarId> {
  let cur = new Set(selected);
  for (;;) {
    const completed = completedConstellations(model, cur);
    const next = new Set<StarId>();
    for (const id of cur) {
      const star = model.stars.get(id);
      if (!star) continue;
      if (!star.predecessors.every((p) => cur.has(p))) continue; // predecessor gone
      if (star.predecessors.length === 0) {
        const con = model.constellations.get(star.constellationId)!;
        // Total pool from ALL completed constellations, including this one once
        // complete — so a self-sustaining constellation survives bootstrap removal.
        if (!meetsRequirement(affinityFrom(model, completed), con.affinityRequired)) continue;
      }
      next.add(id);
    }
    if (next.size === cur.size) return next;
    cur = next;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && bun test test/rules-closure.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add web/src/core/rules.ts web/test/rules-closure.test.ts
git commit -m "feat(core): validClosure fixpoint with affinity gating + self-sustain"
```

---

### Task 5: `selectableStars`

**Files:**
- Modify: `web/src/core/rules.ts`
- Test: `web/test/rules-selectable.test.ts`

**Interfaces:**
- Consumes: Task 2-4.
- Produces: `selectableStars(model: DevotionModel, state: SelectionState): Set<StarId>`.
  A star qualifies iff it is unselected, points remain (`selected.size < pointCap`), its predecessors are all selected, and (if it is an entry star) its constellation's `affinityRequired` is met by affinity from all completed constellations.

- [ ] **Step 1: Write the failing test** in `web/test/rules-selectable.test.ts`

```ts
import { test, expect } from "bun:test";
import doc from "../../data/devotions.json";
import { buildModel } from "../src/core/model";
import { selectableStars } from "../src/core/rules";

const model = buildModel(doc as any);

test("from empty, only Crossroads entry stars are selectable; gated entries are not", () => {
  const sel = selectableStars(model, { selected: new Set(), pointCap: 55 });
  expect(sel.has("crossroads_eldritch:0")).toBe(true);
  expect(sel.has("bat:0")).toBe(false); // needs eldritch:1
});

test("a satisfied affinity requirement unlocks the constellation's entry star", () => {
  const sel = selectableStars(model, { selected: new Set(["crossroads_eldritch:0"]), pointCap: 55 });
  expect(sel.has("bat:0")).toBe(true);
  expect(sel.has("bat:1")).toBe(false); // needs bat:0 first
});

test("predecessor order gates non-entry stars", () => {
  const sel = selectableStars(model, {
    selected: new Set(["crossroads_eldritch:0", "bat:0"]), pointCap: 55,
  });
  expect(sel.has("bat:1")).toBe(true);
  expect(sel.has("bat:2")).toBe(false);
});

test("no points remaining means nothing is selectable", () => {
  const sel = selectableStars(model, { selected: new Set(["crossroads_eldritch:0"]), pointCap: 1 });
  expect(sel.size).toBe(0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && bun test test/rules-selectable.test.ts`
Expected: FAIL, `selectableStars` is not exported.

- [ ] **Step 3: Append to `web/src/core/rules.ts`**

```ts
import type { SelectionState } from "./types";

export function selectableStars(model: DevotionModel, state: SelectionState): Set<StarId> {
  const out = new Set<StarId>();
  if (state.selected.size >= state.pointCap) return out;
  const completed = completedConstellations(model, state.selected);
  const totals = affinityFrom(model, completed);
  for (const star of model.stars.values()) {
    if (state.selected.has(star.id)) continue;
    if (!star.predecessors.every((p) => state.selected.has(p))) continue;
    if (star.predecessors.length === 0) {
      const con = model.constellations.get(star.constellationId)!;
      if (!meetsRequirement(totals, con.affinityRequired)) continue;
    }
    out.add(star.id);
  }
  return out;
}
```

Update the existing import line at the top of `rules.ts` to include `SelectionState`:

```ts
import type { DevotionModel, SelectionState, StarId } from "./types";
```
(and delete the now-redundant second `import type { SelectionState }` line you added, keeping a single import.)

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && bun test test/rules-selectable.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add web/src/core/rules.ts web/test/rules-selectable.test.ts
git commit -m "feat(core): selectableStars with point-cap and affinity gating"
```

---

### Task 6: `toggleStar`

**Files:**
- Modify: `web/src/core/rules.ts`
- Test: `web/test/rules-toggle.test.ts`

**Interfaces:**
- Consumes: Task 2-5.
- Produces:
  - `canRemove(model, state, starId): boolean`: true iff the star is selected and removing it leaves every remaining star valid (`validClosure(selected − star)` does not shrink). This is the **guarded/leaf** rule: a star is removable only when no selected star depends on it and removing it won't drop affinity another selected constellation requires.
  - `toggleStar(model, state: SelectionState, starId: StarId): SelectionState`: if the star is selectable, add it; if it is selected **and `canRemove`**, remove it; otherwise return the state unchanged (a click that would invalidate other selections is **rejected, not cascaded**). Always returns a new object on change; never mutates input.

- [ ] **Step 1: Write the failing test** in `web/test/rules-toggle.test.ts`

```ts
import { test, expect } from "bun:test";
import doc from "../../data/devotions.json";
import { buildModel } from "../src/core/model";
import { toggleStar, canRemove } from "../src/core/rules";
import type { SelectionState } from "../src/core/types";

const model = buildModel(doc as any);
const empty: SelectionState = { selected: new Set(), pointCap: 55 };

test("adds a selectable star", () => {
  const s = toggleStar(model, empty, "crossroads_eldritch:0");
  expect([...s.selected]).toEqual(["crossroads_eldritch:0"]);
});

test("ignores an unselectable star", () => {
  const s = toggleStar(model, empty, "bat:0"); // gated
  expect(s.selected.size).toBe(0);
});

test("blocks removing a star that other selections depend on (no cascade)", () => {
  let s = toggleStar(model, empty, "crossroads_eldritch:0");
  s = toggleStar(model, s, "bat:0");
  s = toggleStar(model, s, "bat:1");
  expect(s.selected.size).toBe(3);
  // removing the affinity source would invalidate bat -> rejected, state unchanged
  expect(toggleStar(model, s, "crossroads_eldritch:0").selected.size).toBe(3);
  // removing a non-leaf (bat:0 has successor bat:1) -> rejected
  expect(toggleStar(model, s, "bat:0").selected.size).toBe(3);
  // removing the leaf bat:1 -> allowed
  expect(toggleStar(model, s, "bat:1").selected.size).toBe(2);
});

test("canRemove reflects the guard", () => {
  let s = toggleStar(model, empty, "crossroads_eldritch:0");
  s = toggleStar(model, s, "bat:0");
  s = toggleStar(model, s, "bat:1");
  expect(canRemove(model, s, "bat:1")).toBe(true);
  expect(canRemove(model, s, "bat:0")).toBe(false);
  expect(canRemove(model, s, "crossroads_eldritch:0")).toBe(false);
});

test("does not mutate the input state", () => {
  const before = new Set(empty.selected);
  toggleStar(model, empty, "crossroads_eldritch:0");
  expect(empty.selected).toEqual(before);
});

test("self-sustaining constellation: the bootstrap IS removable (no cascade)", () => {
  // Crossroads primordial:1 opens Eel; completing Eel grants primordial:5;
  // removing the Crossroads causes no cascade (Eel self-sustains) -> allowed.
  let s: SelectionState = { selected: new Set(), pointCap: 55 };
  s = toggleStar(model, s, "crossroads_primordial:0");
  for (const id of ["eel:0", "eel:1", "eel:2"]) s = toggleStar(model, s, id);
  expect(s.selected.size).toBe(4);
  expect(canRemove(model, s, "crossroads_primordial:0")).toBe(true);
  s = toggleStar(model, s, "crossroads_primordial:0"); // refund the bootstrap
  expect(s.selected.has("eel:0")).toBe(true);
  expect(s.selected.size).toBe(3);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && bun test test/rules-toggle.test.ts`
Expected: FAIL, `toggleStar` is not exported.

- [ ] **Step 3: Append to `web/src/core/rules.ts`**

```ts
export function canRemove(model: DevotionModel, state: SelectionState, starId: StarId): boolean {
  if (!state.selected.has(starId)) return false;
  const next = new Set(state.selected);
  next.delete(starId);
  // Removable only if nothing else falls out of validity (guarded / leaf rule).
  return validClosure(model, next).size === next.size;
}

export function toggleStar(model: DevotionModel, state: SelectionState, starId: StarId): SelectionState {
  if (state.selected.has(starId)) {
    if (!canRemove(model, state, starId)) return state; // reject: would invalidate others
    const next = new Set(state.selected);
    next.delete(starId);
    return { selected: next, pointCap: state.pointCap };
  }
  if (selectableStars(model, state).has(starId)) {
    // Adding a selectable star never invalidates existing selections.
    const next = new Set(state.selected);
    next.add(starId);
    return { selected: next, pointCap: state.pointCap };
  }
  return state;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && bun test test/rules-toggle.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add web/src/core/rules.ts web/test/rules-toggle.test.ts
git commit -m "feat(core): toggleStar add + guarded (leaf-valid) remove"
```

---

### Task 7: Aggregation (bonuses, powers, weapon reqs)

**Files:**
- Create: `web/src/core/aggregate.ts`
- Test: `web/test/aggregate.test.ts`

**Interfaces:**
- Consumes: Task 2.
- Produces:
  - `sumBonuses(model, selected: Set<StarId>): Record<string, number>` (additive per stat id)
  - `powersGained(model, selected: Set<StarId>): string[]`
  - `weaponRequirements(model, selected: Set<StarId>): { starId: StarId; weapons: string[] }[]`

- [ ] **Step 1: Write the failing test** in `web/test/aggregate.test.ts`

```ts
import { test, expect } from "bun:test";
import doc from "../../data/devotions.json";
import { buildModel } from "../src/core/model";
import { sumBonuses, powersGained } from "../src/core/aggregate";

const model = buildModel(doc as any);

test("sums like stat ids additively across stars", () => {
  // bat:0 offensiveLifeModifier=15, bat:2 offensiveLifeModifier=24 -> 39
  const totals = sumBonuses(model, new Set(["bat:0", "bat:2"]));
  expect(totals.offensiveLifeModifier).toBe(39);
  expect(totals.offensiveSlowBleedingModifier).toBe(65); // 15 + 50
});

test("collects celestial power names", () => {
  const powers = powersGained(model, new Set(["bat:4"]));
  expect(powers).toContain("Twin Fangs");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && bun test test/aggregate.test.ts`
Expected: FAIL, cannot find `../src/core/aggregate`.

- [ ] **Step 3: Write `web/src/core/aggregate.ts`**

```ts
import type { DevotionModel, StarId } from "./types";

export function sumBonuses(model: DevotionModel, selected: Set<StarId>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const id of selected) {
    const star = model.stars.get(id);
    if (!star) continue;
    for (const [stat, val] of Object.entries(star.bonuses)) {
      out[stat] = (out[stat] ?? 0) + val;
    }
  }
  return out;
}

export function powersGained(model: DevotionModel, selected: Set<StarId>): string[] {
  const out: string[] = [];
  for (const id of selected) {
    const star = model.stars.get(id);
    if (star?.celestialPower) out.push(star.celestialPower.name);
  }
  return out;
}

export function weaponRequirements(
  model: DevotionModel,
  selected: Set<StarId>,
): { starId: StarId; weapons: string[] }[] {
  const out: { starId: StarId; weapons: string[] }[] = [];
  for (const id of selected) {
    const star = model.stars.get(id);
    if (star?.weaponRequirement) out.push({ starId: id, weapons: star.weaponRequirement.weapons });
  }
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && bun test test/aggregate.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add web/src/core/aggregate.ts web/test/aggregate.test.ts
git commit -m "feat(core): bonus/power/weapon aggregation"
```

---

### Task 8: Stat labels

**Files:**
- Create: `web/src/core/labels.ts`
- Test: `web/test/labels.test.ts`

**Interfaces:**
- Consumes: nothing (takes a plain `Record<string,string>`).
- Produces: `makeLabeler(statLabels: Record<string, string>): (statId: string) => string`. Uses the map when present; otherwise humanizes the id (camelCase/`._` to spaced Title-ish).

- [ ] **Step 1: Write the failing test** in `web/test/labels.test.ts`

```ts
import { test, expect } from "bun:test";
import { makeLabeler } from "../src/core/labels";

test("uses provided label when present", () => {
  const label = makeLabeler({ offensiveFireModifier: "% Fire Damage" });
  expect(label("offensiveFireModifier")).toBe("% Fire Damage");
});

test("humanizes unknown stat ids", () => {
  const label = makeLabeler({});
  expect(label("offensiveSlowBleedingModifier")).toBe("Offensive Slow Bleeding Modifier");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && bun test test/labels.test.ts`
Expected: FAIL, cannot find `../src/core/labels`.

- [ ] **Step 3: Write `web/src/core/labels.ts`**

```ts
export function makeLabeler(statLabels: Record<string, string>): (statId: string) => string {
  return (statId: string): string => {
    const known = statLabels[statId];
    if (known) return known;
    const spaced = statId
      .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
      .replace(/[._]/g, " ")
      .trim();
    return spaced.charAt(0).toUpperCase() + spaced.slice(1);
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && bun test test/labels.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add web/src/core/labels.ts web/test/labels.test.ts
git commit -m "feat(core): stat labeler with humanize fallback"
```

---

### Task 9: Pan/zoom viewBox math (pure)

**Files:**
- Create: `web/src/core/viewbox.ts`
- Test: `web/test/viewbox.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `interface ViewBox { x: number; y: number; w: number; h: number }`
  - `fitViewBox(points: { x: number; y: number }[], pad: number): ViewBox`
  - `panViewBox(vb: ViewBox, worldDx: number, worldDy: number): ViewBox`
  - `zoomViewBox(vb, worldX, worldY, factor, minW, maxW): ViewBox`: scales about the given world point, clamped by width.
  - `toViewBoxString(vb: ViewBox): string`

- [ ] **Step 1: Write the failing test** in `web/test/viewbox.test.ts`

```ts
import { test, expect } from "bun:test";
import { fitViewBox, panViewBox, zoomViewBox, toViewBoxString } from "../src/core/viewbox";

test("fitViewBox bounds points with padding", () => {
  const vb = fitViewBox([{ x: 0, y: 0 }, { x: 100, y: 50 }], 10);
  expect(vb).toEqual({ x: -10, y: -10, w: 120, h: 70 });
});

test("pan shifts the window opposite to world delta", () => {
  expect(panViewBox({ x: 0, y: 0, w: 100, h: 100 }, 5, -5)).toEqual({ x: -5, y: 5, w: 100, h: 100 });
});

test("zoom keeps the focus world point stationary", () => {
  const vb = zoomViewBox({ x: 0, y: 0, w: 100, h: 100 }, 50, 50, 0.5, 10, 1000);
  // focus at center stays center: new w=50, x=25
  expect(vb).toEqual({ x: 25, y: 25, w: 50, h: 50 });
});

test("zoom clamps to min width", () => {
  const vb = zoomViewBox({ x: 0, y: 0, w: 20, h: 20 }, 10, 10, 0.1, 10, 1000);
  expect(vb.w).toBe(10);
});

test("toViewBoxString formats", () => {
  expect(toViewBoxString({ x: 1, y: 2, w: 3, h: 4 })).toBe("1 2 3 4");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && bun test test/viewbox.test.ts`
Expected: FAIL, cannot find `../src/core/viewbox`.

- [ ] **Step 3: Write `web/src/core/viewbox.ts`**

```ts
export interface ViewBox { x: number; y: number; w: number; h: number }

export function fitViewBox(points: { x: number; y: number }[], pad: number): ViewBox {
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  return { x: minX - pad, y: minY - pad, w: (maxX - minX) + 2 * pad, h: (maxY - minY) + 2 * pad };
}

export function panViewBox(vb: ViewBox, worldDx: number, worldDy: number): ViewBox {
  return { x: vb.x - worldDx, y: vb.y - worldDy, w: vb.w, h: vb.h };
}

export function zoomViewBox(
  vb: ViewBox, worldX: number, worldY: number, factor: number, minW: number, maxW: number,
): ViewBox {
  let nw = vb.w * factor;
  if (nw < minW) nw = minW;
  if (nw > maxW) nw = maxW;
  const applied = nw / vb.w;
  const nh = vb.h * applied;
  return {
    x: worldX - (worldX - vb.x) * applied,
    y: worldY - (worldY - vb.y) * applied,
    w: nw, h: nh,
  };
}

export function toViewBoxString(vb: ViewBox): string {
  return `${vb.x} ${vb.y} ${vb.w} ${vb.h}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && bun test test/viewbox.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add web/src/core/viewbox.ts web/test/viewbox.test.ts
git commit -m "feat(core): pure pan/zoom viewBox math"
```

---

### Task 10: Ports + HTTP data source adapter

**Files:**
- Create: `web/src/ports/DataSource.ts`
- Create: `web/src/adapters/httpDataSource.ts`

**Interfaces:**
- Consumes: `buildModel`/`DevotionsDoc` (Task 2), `makeLabeler` (Task 8).
- Produces:
  - `DataSource.ts`: `interface AssetManifest { images: Record<string, string> }` and `interface LoadedData { model: DevotionModel; label: (statId: string) => string; manifest: AssetManifest | null }` and `interface DataSource { load(): Promise<LoadedData> }`.
  - `httpDataSource.ts`: `httpDataSource(base = "."): DataSource`.

This task is a thin IO adapter; verify by build/runtime in Task 14, not a unit test.

- [ ] **Step 1: Write `web/src/ports/DataSource.ts`**

```ts
import type { DevotionModel } from "../core/types";

export interface AssetManifest {
  // maps a constellation background image name (basename) -> resolved asset URL
  images: Record<string, string>;
}

export interface LoadedData {
  model: DevotionModel;
  label: (statId: string) => string;
  manifest: AssetManifest | null;
}

export interface DataSource {
  load(): Promise<LoadedData>;
}
```

- [ ] **Step 2: Write `web/src/adapters/httpDataSource.ts`**

```ts
import { buildModel, type DevotionsDoc } from "../core/model";
import { makeLabeler } from "../core/labels";
import type { AssetManifest, DataSource, LoadedData } from "../ports/DataSource";

async function getJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export function httpDataSource(base = "."): DataSource {
  return {
    async load(): Promise<LoadedData> {
      const doc = await getJson<DevotionsDoc>(`${base}/data/devotions.json`);
      if (!doc) throw new Error("failed to load data/devotions.json");
      const labels = (await getJson<Record<string, string>>(`${base}/data/stat_labels.json`)) ?? {};
      const manifest = await getJson<AssetManifest>(`${base}/assets/devotions/manifest.json`);
      return { model: buildModel(doc), label: makeLabeler(labels), manifest };
    },
  };
}
```

- [ ] **Step 3: Typecheck**

Run: `cd web && bunx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add web/src/ports/DataSource.ts web/src/adapters/httpDataSource.ts
git commit -m "feat(adapter): DataSource port + http loader"
```

---

### Task 11: SVG renderer adapter

**Files:**
- Create: `web/src/adapters/svgRenderer.ts`
- Test: `web/test/svgRenderer.test.ts` (jsdom-free: assert on produced SVG string structure via a tiny helper)

**Interfaces:**
- Consumes: `DevotionModel`, `SelectionState`, `selectableStars` (Task 5), `fitViewBox`/`toViewBoxString` (Task 9), `AssetManifest` (Task 10), `AFFINITIES`.
- Produces:
  - `affinityColor(affinity: Affinity): string`
  - `renderSvgMarkup(model, state, opts): string`: pure string builder producing the `<svg>` inner markup (art `<image>` if manifest has it, `<line>` links, `<circle class="star ...">` with `data-star-id`). Used by the test and by the DOM mount.
  - `mountSvg(container: HTMLElement, model, deps): { update(state): void; svg: SVGSVGElement }`: creates the live SVG, delegates clicks/hover via `data-star-id`.

The pure `renderSvgMarkup` is unit-tested; `mountSvg` is verified at runtime (Task 14).

- [ ] **Step 1: Write the failing test** in `web/test/svgRenderer.test.ts`

```ts
import { test, expect } from "bun:test";
import doc from "../../data/devotions.json";
import { buildModel } from "../src/core/model";
import { renderSvgMarkup } from "../src/adapters/svgRenderer";

const model = buildModel(doc as any);

test("marks selected and selectable stars with classes and ids", () => {
  const markup = renderSvgMarkup(model, { selected: new Set(["crossroads_eldritch:0"]), pointCap: 55 }, { manifest: null });
  expect(markup).toContain('data-star-id="crossroads_eldritch:0"');
  expect(markup).toContain('class="star selected"');
  // bat:0 becomes selectable once eldritch is satisfied
  expect(markup).toMatch(/data-star-id="bat:0"[^>]*class="star selectable"|class="star selectable"[^>]*data-star-id="bat:0"/);
});

test("omits the art layer when no manifest", () => {
  const markup = renderSvgMarkup(model, { selected: new Set(), pointCap: 55 }, { manifest: null });
  expect(markup).not.toContain("<image");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && bun test test/svgRenderer.test.ts`
Expected: FAIL, cannot find `../src/adapters/svgRenderer`.

- [ ] **Step 3: Write `web/src/adapters/svgRenderer.ts`**

```ts
import { AFFINITIES, type Affinity, type DevotionModel, type SelectionState, type StarId } from "../core/types";
import { selectableStars } from "../core/rules";
import { affinityFrom, completedConstellations } from "../core/affinity";
import { fitViewBox, toViewBoxString } from "../core/viewbox";
import type { AssetManifest } from "../ports/DataSource";

const AFFINITY_COLORS: Record<Affinity, string> = {
  ascendant: "#e8c558", chaos: "#c0392b", eldritch: "#8e44ad", order: "#2980b9", primordial: "#27ae60",
};
export function affinityColor(a: Affinity): string { return AFFINITY_COLORS[a]; }

function dominantAffinity(con: { affinityBonus: Partial<Record<Affinity, number>> }): Affinity {
  let best: Affinity = "primordial"; let bestV = -1;
  for (const a of AFFINITIES) { const v = con.affinityBonus[a] ?? 0; if (v > bestV) { bestV = v; best = a; } }
  return best;
}

export interface RenderOpts { manifest: AssetManifest | null }

export function renderSvgMarkup(model: DevotionModel, state: SelectionState, opts: RenderOpts): string {
  const selectable = selectableStars(model, state);
  const parts: string[] = [];

  // Layer 1: optional art
  if (opts.manifest) {
    for (const c of model.constellations.values()) {
      const name = c.background?.image?.split("/").pop() ?? "";
      const url = opts.manifest.images[name];
      if (url && c.background && c.background.x != null && c.background.y != null) {
        parts.push(`<image href="${url}" x="${c.background.x}" y="${c.background.y}" class="art"/>`);
      }
    }
  }

  // Layer 2: links
  for (const star of model.stars.values()) {
    for (const p of star.predecessors) {
      const a = model.stars.get(p);
      if (!a) continue;
      parts.push(`<line class="link" x1="${a.position.x}" y1="${a.position.y}" x2="${star.position.x}" y2="${star.position.y}"/>`);
    }
  }

  // Layer 3: stars
  for (const star of model.stars.values()) {
    const con = model.constellations.get(star.constellationId)!;
    const color = affinityColor(dominantAffinity(con));
    let cls = "star locked";
    if (state.selected.has(star.id)) cls = "star selected";
    else if (selectable.has(star.id)) cls = "star selectable";
    parts.push(
      `<circle data-star-id="${star.id}" class="${cls}" cx="${star.position.x}" cy="${star.position.y}" r="6" style="--affinity:${color}"/>`,
    );
  }

  const pts = [...model.stars.values()].map((s) => s.position);
  const vb = toViewBoxString(fitViewBox(pts, 60));
  return `<svg id="map" viewBox="${vb}" preserveAspectRatio="xMidYMid meet">${parts.join("")}</svg>`;
}

export interface SvgHandle { update(state: SelectionState): void; svg: SVGSVGElement }
export interface SvgDeps {
  manifest: AssetManifest | null;
  onStarClick(id: StarId): void;
  onStarHover(id: StarId | null, clientX: number, clientY: number): void;
}

export function mountSvg(container: HTMLElement, model: DevotionModel, deps: SvgDeps): SvgHandle {
  function render(state: SelectionState) {
    container.innerHTML = renderSvgMarkup(model, state, { manifest: deps.manifest });
  }
  render({ selected: new Set(), pointCap: 55 });
  const svg = container.querySelector("svg") as SVGSVGElement;

  container.addEventListener("click", (e) => {
    const id = (e.target as Element)?.getAttribute?.("data-star-id");
    if (id) deps.onStarClick(id);
  });
  container.addEventListener("mousemove", (e) => {
    const id = (e.target as Element)?.getAttribute?.("data-star-id") ?? null;
    deps.onStarHover(id, (e as MouseEvent).clientX, (e as MouseEvent).clientY);
  });

  return {
    svg,
    update(state) {
      const live = container.querySelector("svg") as SVGSVGElement | null;
      const vb = live?.getAttribute("viewBox");
      render(state);
      const next = container.querySelector("svg") as SVGSVGElement | null;
      if (vb && next) next.setAttribute("viewBox", vb); // preserve pan/zoom across re-render
    },
  };
}
```

(Unused import note: `affinityFrom`/`completedConstellations` may be removed if your linter flags them. They are imported for parity with future per-star tinting; delete if `bunx tsc --noEmit` complains about unused locals. The repo's tsconfig does not set `noUnusedLocals`, so this is safe to leave.)

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && bun test test/svgRenderer.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add web/src/adapters/svgRenderer.ts web/test/svgRenderer.test.ts
git commit -m "feat(adapter): SVG renderer with selectable/selected/locked states"
```

---

### Task 12: Navigation controller (pan/drag/zoom + click-vs-drag)

**Files:**
- Create: `web/src/adapters/navController.ts`

**Interfaces:**
- Consumes: `ViewBox`/`fitViewBox`/`panViewBox`/`zoomViewBox`/`toViewBoxString` (Task 9).
- Produces: `attachNav(svgGetter: () => SVGSVGElement | null, opts: NavOpts): { reset(): void }` where `NavOpts = { fitPoints: {x:number;y:number}[]; onDragStateChange?(dragging: boolean): void }`. Wheel zooms at cursor; drag on empty space pans; a >4px move suppresses the subsequent click (so star clicks during a tiny jitter still register, real drags don't select).

Runtime-verified in Task 14 (DOM/pointer events).

- [ ] **Step 1: Write `web/src/adapters/navController.ts`**

```ts
import { fitViewBox, panViewBox, toViewBoxString, zoomViewBox, type ViewBox } from "../core/viewbox";

export interface NavOpts {
  fitPoints: { x: number; y: number }[];
  onDragStateChange?(dragging: boolean): void;
}

const DRAG_THRESHOLD = 4;

export function attachNav(svgGetter: () => SVGSVGElement | null, opts: NavOpts): { reset(): void } {
  const baseVb: ViewBox = fitViewBox(opts.fitPoints, 60);

  function current(): ViewBox {
    const svg = svgGetter();
    const raw = svg?.getAttribute("viewBox");
    if (!raw) return baseVb;
    const [x, y, w, h] = raw.split(" ").map(Number);
    return { x, y, w, h };
  }
  function apply(vb: ViewBox) { svgGetter()?.setAttribute("viewBox", toViewBoxString(vb)); }

  function clientToWorld(svg: SVGSVGElement, clientX: number, clientY: number): { x: number; y: number } {
    const rect = svg.getBoundingClientRect();
    const vb = current();
    return {
      x: vb.x + ((clientX - rect.left) / rect.width) * vb.w,
      y: vb.y + ((clientY - rect.top) / rect.height) * vb.h,
    };
  }

  let dragging = false, moved = false, lastX = 0, lastY = 0;

  function onWheel(e: WheelEvent) {
    const svg = svgGetter(); if (!svg) return;
    e.preventDefault();
    const w = clientToWorld(svg, e.clientX, e.clientY);
    const factor = e.deltaY > 0 ? 1.1 : 1 / 1.1;
    apply(zoomViewBox(current(), w.x, w.y, factor, 80, baseVb.w * 1.5));
  }
  function onDown(e: MouseEvent) {
    if ((e.target as Element)?.getAttribute?.("data-star-id")) return; // let star clicks through
    dragging = true; moved = false; lastX = e.clientX; lastY = e.clientY;
    opts.onDragStateChange?.(true);
  }
  function onMove(e: MouseEvent) {
    if (!dragging) return;
    const svg = svgGetter(); if (!svg) return;
    const vb = current();
    const rect = svg.getBoundingClientRect();
    const dx = ((e.clientX - lastX) / rect.width) * vb.w;
    const dy = ((e.clientY - lastY) / rect.height) * vb.h;
    if (Math.abs(e.clientX - lastX) + Math.abs(e.clientY - lastY) > DRAG_THRESHOLD) moved = true;
    apply(panViewBox(vb, dx, dy));
    lastX = e.clientX; lastY = e.clientY;
  }
  function onUp() { if (dragging) { dragging = false; opts.onDragStateChange?.(false); } }
  function onClickCapture(e: MouseEvent) { if (moved) { e.stopPropagation(); moved = false; } }

  window.addEventListener("mousemove", onMove);
  window.addEventListener("mouseup", onUp);
  // Caller attaches these to the container in main.ts:
  (attachNav as any)._handlers = { onWheel, onDown, onClickCapture };

  return { reset() { apply(baseVb); } };
}

export function navHandlers() {
  return (attachNav as any)._handlers as {
    onWheel(e: WheelEvent): void; onDown(e: MouseEvent): void; onClickCapture(e: MouseEvent): void;
  };
}
```

- [ ] **Step 2: Typecheck**

Run: `cd web && bunx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add web/src/adapters/navController.ts
git commit -m "feat(adapter): pan/zoom nav controller with click-vs-drag"
```

---

### Task 13: Sidebar + tooltip views

**Files:**
- Create: `web/src/adapters/sidebarView.ts`
- Create: `web/src/adapters/tooltipView.ts`

**Interfaces:**
- Consumes: `sumBonuses`/`powersGained` (Task 7), `affinityTotals` (Task 3), `AFFINITIES`, the `label` fn.
- Produces:
  - `renderSidebars(deps): void`: `renderBenefits(el, model, selected, label)`, `renderAffinities(el, model, selected)`.
  - `tooltipView(el)` returns `{ show(model, starId, clientX, clientY, label): void; hide(): void }`.

Runtime-verified in Task 14.

- [ ] **Step 1: Write `web/src/adapters/sidebarView.ts`**

```ts
import { AFFINITIES, type DevotionModel, type StarId } from "../core/types";
import { sumBonuses, powersGained } from "../core/aggregate";
import { affinityTotals } from "../core/affinity";

export function renderBenefits(
  el: HTMLElement, model: DevotionModel, selected: Set<StarId>, label: (s: string) => string,
): void {
  const bonuses = sumBonuses(model, selected);
  const powers = powersGained(model, selected);
  const rows = Object.entries(bonuses)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([stat, val]) => `<div class="benefit"><span>${label(stat)}</span><span>${val}</span></div>`)
    .join("");
  const powerRows = powers.map((p) => `<div class="power">${p}</div>`).join("");
  el.innerHTML = `<h2>Benefits</h2>${rows}${powers.length ? `<h3>Celestial Powers</h3>${powerRows}` : ""}`;
}

export function renderAffinities(el: HTMLElement, model: DevotionModel, selected: Set<StarId>): void {
  const totals = affinityTotals(model, selected);
  const rows = AFFINITIES.map(
    (a) => `<div class="affinity affinity-${a}"><span>${a}</span><span>${totals[a]}</span></div>`,
  ).join("");
  el.innerHTML = `<h2>Affinity</h2>${rows}`;
}
```

- [ ] **Step 2: Write `web/src/adapters/tooltipView.ts`**

```ts
import { AFFINITIES, type DevotionModel, type StarId } from "../core/types";

export function tooltipView(el: HTMLElement) {
  return {
    show(model: DevotionModel, starId: StarId, clientX: number, clientY: number, label: (s: string) => string) {
      const star = model.stars.get(starId);
      if (!star) return;
      const con = model.constellations.get(star.constellationId)!;
      const bonusRows = Object.entries(star.bonuses)
        .map(([s, v]) => `<div>${label(s)}: ${v}</div>`).join("");
      const power = star.celestialPower ? `<div class="tip-power">${star.celestialPower.name}</div>` : "";
      const req = AFFINITIES
        .filter((a) => (con.affinityRequired[a] ?? 0) > 0)
        .map((a) => `${a} ${con.affinityRequired[a]}`).join(", ");
      el.innerHTML = `<strong>${con.name}</strong>${power}${bonusRows}${req ? `<div class="tip-req">Requires: ${req}</div>` : ""}`;
      el.style.left = `${clientX + 14}px`;
      el.style.top = `${clientY + 14}px`;
      el.style.display = "block";
    },
    hide() { el.style.display = "none"; },
  };
}
```

- [ ] **Step 3: Typecheck**

Run: `cd web && bunx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add web/src/adapters/sidebarView.ts web/src/adapters/tooltipView.ts
git commit -m "feat(adapter): sidebar + tooltip DOM views"
```

---

### Task 14: App wiring, HTML shell, styles, build + serve

**Files:**
- Create: `web/index.html`
- Create: `web/src/styles.css`
- Create: `web/src/app/main.ts`
- Modify: `justfile` (add `build`, `serve`)

**Interfaces:**
- Consumes: every adapter + core function above. Owns `SelectionState`.
- Produces: a working static page. Deliverable: `just build && just serve` shows the interactive map (dots) with both sidebars and a working slider.

- [ ] **Step 1: Write `web/index.html`**

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Grim Dawn Devotion Planner</title>
  <link rel="stylesheet" href="./styles.css" />
</head>
<body>
  <header>
    <label>Points
      <input id="point-slider" type="range" min="1" max="55" value="55" />
      <span id="point-count">0 / 55</span>
    </label>
    <button id="reset-view">Reset view</button>
  </header>
  <main>
    <aside id="benefits" class="sidebar"></aside>
    <div id="map-container"></div>
    <aside id="affinity" class="sidebar"></aside>
  </main>
  <div id="tooltip"></div>
  <script type="module" src="./main.js"></script>
</body>
</html>
```

- [ ] **Step 2: Write `web/src/styles.css`**

```css
* { box-sizing: border-box; }
body { margin: 0; font-family: system-ui, sans-serif; background: #0d1117; color: #e6edf3; height: 100vh; display: flex; flex-direction: column; }
header { display: flex; gap: 1rem; align-items: center; padding: .5rem 1rem; background: #161b22; border-bottom: 1px solid #30363d; }
main { flex: 1; display: grid; grid-template-columns: 240px 1fr 200px; min-height: 0; }
.sidebar { overflow-y: auto; padding: .75rem; background: #11161d; border-inline: 1px solid #30363d; font-size: .85rem; }
.sidebar h2 { font-size: 1rem; margin: .25rem 0 .5rem; }
.benefit, .affinity { display: flex; justify-content: space-between; padding: 2px 0; }
.power, .tip-power { color: #f0c14b; }
#map-container { position: relative; overflow: hidden; cursor: grab; background: radial-gradient(circle at 50% 40%, #15203a, #0d1117 70%); }
#map-container.grabbing { cursor: grabbing; }
#map { width: 100%; height: 100%; }
.link { stroke: #3a4252; stroke-width: 1.5; }
.art { opacity: .9; }
.star { stroke: #0d1117; stroke-width: 1; }
.star.locked { fill: #39414f; opacity: .5; }
.star.selectable { fill: var(--affinity); opacity: 1; filter: drop-shadow(0 0 4px var(--affinity)); cursor: pointer; }
.star.selected { fill: #fff; stroke: var(--affinity); stroke-width: 3; cursor: pointer; }
#tooltip { position: fixed; display: none; pointer-events: none; background: #1c2330; border: 1px solid #30363d; padding: .5rem .6rem; border-radius: 6px; font-size: .8rem; max-width: 260px; z-index: 10; }
.tip-req { margin-top: .35rem; color: #9aa4b2; }
</style>
```

(Note: write only the CSS, not the trailing `</style>` tag; it is a `.css` file.)

- [ ] **Step 3: Write `web/src/app/main.ts`**

```ts
import { httpDataSource } from "../adapters/httpDataSource";
import { mountSvg } from "../adapters/svgRenderer";
import { attachNav, navHandlers } from "../adapters/navController";
import { renderBenefits, renderAffinities } from "../adapters/sidebarView";
import { tooltipView } from "../adapters/tooltipView";
import { toggleStar } from "../core/rules";
import type { SelectionState } from "../core/types";

async function boot() {
  const data = await httpDataSource(".").load();
  const model = data.model;

  let state: SelectionState = { selected: new Set(), pointCap: 55 };

  const mapContainer = document.getElementById("map-container") as HTMLElement;
  const benefitsEl = document.getElementById("benefits") as HTMLElement;
  const affinityEl = document.getElementById("affinity") as HTMLElement;
  const tooltipEl = document.getElementById("tooltip") as HTMLElement;
  const slider = document.getElementById("point-slider") as HTMLInputElement;
  const countEl = document.getElementById("point-count") as HTMLElement;
  const resetBtn = document.getElementById("reset-view") as HTMLButtonElement;
  const tip = tooltipView(tooltipEl);

  const handle = mountSvg(mapContainer, model, {
    manifest: data.manifest,
    onStarClick: (id) => { state = toggleStar(model, state, id); refresh(); },
    onStarHover: (id, x, y) => { if (id) tip.show(model, id, x, y, data.label); else tip.hide(); },
  });

  const nav = attachNav(() => mapContainer.querySelector("svg"), {
    fitPoints: [...model.stars.values()].map((s) => s.position),
    onDragStateChange: (d) => mapContainer.classList.toggle("grabbing", d),
  });
  const h = navHandlers();
  mapContainer.addEventListener("wheel", h.onWheel, { passive: false });
  mapContainer.addEventListener("mousedown", h.onDown);
  mapContainer.addEventListener("click", h.onClickCapture, true);
  resetBtn.addEventListener("click", () => nav.reset());

  slider.addEventListener("input", () => {
    // The cap only gates ADDING (selectableStars checks selected.size < pointCap).
    // Lowering it below the current allocation is allowed and shown as over-budget;
    // the user removes leaf stars to get back under. No auto-removal (guarded model).
    state = { selected: state.selected, pointCap: Number(slider.value) };
    refresh();
  });

  function refresh() {
    handle.update(state);
    renderBenefits(benefitsEl, model, state.selected, data.label);
    renderAffinities(affinityEl, model, state.selected);
    countEl.textContent = `${state.selected.size} / ${state.pointCap}`;
  }
  refresh();
}

boot().catch((e) => { document.body.innerHTML = `<pre style="color:#f88;padding:1rem">${String(e)}</pre>`; });
```

- [ ] **Step 4: Add build + serve to the justfile**

```make
# Build the static site into web/dist (bundles JS, copies html/css/data/assets)
build:
    #!/usr/bin/env bash
    set -euo pipefail
    cd "{{justfile_directory()}}/web"
    rm -rf dist && mkdir -p dist/data
    bun build src/app/main.ts --outdir dist --target browser
    cp index.html dist/index.html
    cp src/styles.css dist/styles.css
    cp "{{justfile_directory()}}/data/devotions.json" dist/data/devotions.json
    cp "{{justfile_directory()}}/data/stat_labels.json" dist/data/stat_labels.json
    if [ -d "{{justfile_directory()}}/assets" ]; then cp -r "{{justfile_directory()}}/assets" dist/assets; fi
    echo "Built web/dist"

# Serve web/dist locally for development
serve: build
    cd "{{justfile_directory()}}/web/dist" && bunx serve -l 5173 .
```

- [ ] **Step 5: Build, serve, verify**

Run: `just build && just serve`
Expected: build succeeds; open `http://localhost:5173`. Map shows affinity-colored dots; only the 5 Crossroads stars are bright/selectable; slider reads `0 / 55`. Wheel zooms at cursor; drag empty space pans (grab cursor); clicking a Crossroads star selects it (turns white), its affinity appears in the right sidebar, and that constellation's neighbors light up. Hover shows a tooltip. Clicking a depended-on star (e.g. the affinity source) is **rejected**: you must remove leaf stars first; clicking a removable leaf deselects it. `Reset view` recenters.

- [ ] **Step 6: Commit**

```bash
git add web/index.html web/src/styles.css web/src/app/main.ts justfile
git commit -m "feat(app): wire planner UI, slider, sidebars, build + serve"
```

---

### Task 15: Optimized WebP art pipeline (`just assets`)

**Files:**
- Create: `scripts/build_assets.py`
- Modify: `justfile` (add `assets`)

**Interfaces:**
- Consumes: `scripts/tex2png.py`'s `tex_to_image` (Task imports the existing decoder), Crate `ArchiveTool`, `data/devotions.json` (for which background images to include).
- Produces: git-ignored `assets/devotions/*.webp` + `assets/devotions/manifest.json` (`{ "images": { "<basename>.tex"|"<basename>.png": "assets/devotions/<id>.webp" } }`) under the size target.

- [ ] **Step 1: Write `scripts/build_assets.py`**

```python
#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.10"
# dependencies = ["pillow"]
# ///
"""Extract devotion .tex from UI.arc, decode, downscale, and write optimized WebP
plus a manifest the web app reads. Output dir is git-ignored. See
docs/assets-and-textures.md for the .tex format."""
from __future__ import annotations
import argparse, json, subprocess, sys, tempfile
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))
from tex2png import tex_to_image  # reuse the proven decoder

def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--gd-dir", required=True, type=Path)
    ap.add_argument("--out-dir", required=True, type=Path)
    ap.add_argument("--max-dim", type=int, default=512, help="downscale longest side to this")
    ap.add_argument("--quality", type=int, default=85)
    ap.add_argument("--include-nebula", action="store_true")
    args = ap.parse_args(argv)

    arc = args.gd_dir / "resources/UI.arc"
    tool = args.gd_dir / "ArchiveTool.exe"
    if not arc.exists() or not tool.exists():
        print(f"need UI.arc + ArchiveTool under {args.gd_dir}", file=sys.stderr); return 2

    listing = subprocess.run([str(tool), str(arc), "-list"], capture_output=True, text=True).stdout
    entries = [ln.strip() for ln in listing.splitlines()
               if ln.strip().lower().startswith("skills/devotion/") and ln.strip().lower().endswith(".tex")]
    if not args.include_nebula:
        entries = [e for e in entries if "nebula" not in e.lower()]

    args.out_dir.mkdir(parents=True, exist_ok=True)
    images: dict[str, str] = {}
    with tempfile.TemporaryDirectory() as td:
        for e in entries:
            subprocess.run([str(tool), str(arc), "-extract", td, e], capture_output=True)
            tex = Path(td) / e
            if not tex.exists():
                continue
            img = tex_to_image(tex.read_bytes())
            w, h = img.size
            scale = min(1.0, args.max_dim / max(w, h))
            if scale < 1.0:
                img = img.resize((max(1, int(w * scale)), max(1, int(h * scale))))
            stem = tex.stem
            out = args.out_dir / f"{stem}.webp"
            img.save(out, "WEBP", quality=args.quality, method=6)
            images[f"{stem}.tex"] = f"assets/devotions/{stem}.webp"
            images[f"{stem}.png"] = f"assets/devotions/{stem}.webp"

    (args.out_dir / "manifest.json").write_text(json.dumps({"images": images}, indent=2))
    total = sum(p.stat().st_size for p in args.out_dir.glob("*.webp"))
    print(f"Wrote {len(images)//2} images, {total/1_048_576:.1f} MB, manifest -> {args.out_dir}")
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
```

- [ ] **Step 2: Add the `assets` recipe to the justfile**

```make
# Extract + optimize devotion artwork into git-ignored assets/ (WebP + manifest)
assets *ARGS:
    uv run scripts/build_assets.py --gd-dir "{{gd_dir}}" \
        --out-dir "{{justfile_directory()}}/assets/devotions" {{ARGS}}
```

- [ ] **Step 3: Run and verify size**

Run: `just assets`
Expected: prints image count + total MB (target at most ~8 MB without nebulas; add `just assets --include-nebula` for the full look, target ~15 MB). `git status` shows nothing new (assets/ is git-ignored).

- [ ] **Step 4: Verify the app picks up the art**

Run: `just build && just serve`
Expected: constellation art renders behind the dots; with `assets/` absent the page still works as dots (confirm by temporarily renaming `assets/`).

- [ ] **Step 5: Commit**

```bash
git add scripts/build_assets.py justfile
git commit -m "feat(assets): optimized WebP devotion art pipeline (git-ignored output)"
```

---

### Task 16: GitHub Pages deployment pipeline (end-goal deliverable)

**Files:**
- Create: `.github/workflows/deploy.yml`

**Interfaces:**
- Consumes: the built site (`web/dist`) produced the same way as `just build`.
- Produces: a public GitHub Pages deployment on every push to `main`.

**Decision gate (document, don't block):** CI **cannot** run `just assets` (no game install / `ArchiveTool.exe` in Actions), so the public site is **SVG-only** until a chosen, optimized WebP subset is **committed** to the repo. That image-commit decision (constellations only vs + nebulas; size/copyright) is a separate step; this task ships the always-working SVG-only deploy now and copies `assets/` if/when it exists in the repo.

- [ ] **Step 1: Create `.github/workflows/deploy.yml`**

```yaml
name: Deploy to GitHub Pages
on:
  push:
    branches: [main]
  workflow_dispatch:
permissions:
  contents: read
  pages: write
  id-token: write
concurrency:
  group: pages
  cancel-in-progress: true
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
      - name: Build static site
        working-directory: web
        run: |
          bun install
          bun build src/app/main.ts --outdir dist --target browser
          cp index.html dist/index.html
          cp src/styles.css dist/styles.css
          mkdir -p dist/data
          cp ../data/devotions.json dist/data/
          cp ../data/stat_labels.json dist/data/
          # Art only appears if a committed assets/ exists (see decision gate).
          if [ -d ../assets ]; then cp -r ../assets dist/assets; fi
      - uses: actions/upload-pages-artifact@v3
        with:
          path: web/dist
  deploy:
    needs: build
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - id: deployment
        uses: actions/deploy-pages@v4
```

- [ ] **Step 2: Enable Pages (one-time, manual)**

In the GitHub repo: **Settings > Pages > Build and deployment > Source = GitHub Actions**. (No `gh` CLI step required; this is a repo setting.)

- [ ] **Step 3: Commit, push, verify**

```bash
git add .github/workflows/deploy.yml
git commit -m "ci: GitHub Pages deploy pipeline for the static planner"
git push
```

Expected: the workflow runs on `main`; the `deploy` job prints the Pages URL. Open it: the planner loads and is interactive as **SVG dots** (relative asset paths resolve under the `/<repo>/` subpath). Art is absent until the image-commit decision is made and a committed `assets/` subset is added.

---

### Task 17: Headless-browser e2e verification (`just e2e`)

Runs after Task 14 (the page builds). This is the "verified in a real browser"
gate for the goal, complementing the `bun test` core suite.

**As-built note (important).** The original intent was to drive the page with
`@playwright/cli` (`microsoft/playwright-cli`). On this toolchain (bun on
Windows) neither `@playwright/cli` nor `playwright-core` can connect to Chrome:
Playwright's pipe transport (used by `launch()`) cannot wire its fds under bun,
and its bundled ws client cannot complete Chrome's CDP handshake under bun
(`connectOverCDP` hangs). Bun's *native* `WebSocket`, however, talks to Chrome's
CDP fine. So the e2e is implemented as a small self-contained harness that drives
the already-installed Chromium directly over a raw CDP client on bun's native
WebSocket. No Node, pure bun. (`@playwright/cli` is still installed globally and
usable interactively where a Node runtime is present.)

**Files:**
- Modify: `web/package.json` (add `playwright-core` as a devDependency; it ships the Chromium binary + `executablePath()`)
- Create: `web/e2e/smoke.ts` (self-serves `web/dist`, launches headless Chromium, drives it over raw CDP, asserts, tears down)
- Modify: `justfile` (add `install-e2e` to fetch Chromium, and `e2e: build` to run the harness)

**Interfaces:**
- Consumes: built `web/dist` (`just build`), the Chromium installed by `just install-e2e` (`bunx playwright@1.61.0 install chromium`).
- Produces: `just e2e` that exits nonzero on any failed assertion.

- [x] **Step 1: Install the browser** once: `just install-e2e` (`bunx playwright@1.61.0 install chromium`).

- [x] **Step 2: `web/e2e/smoke.ts`** (pure bun, no external test framework):
  - starts an in-process `Bun.serve` static server for `web/dist` on a random port (no cwd lock on `dist`, unlike `bunx serve`).
  - launches `chrome-headless-shell` (via a `cmd /c` wrapper, since `Bun.spawn` cannot exec the chrome binary directly here) with `--remote-debugging-port` + `--remote-allow-origins=*` + a temp profile + a startup page so a page target exists.
  - connects a tiny CDP client (native `WebSocket`) to the page target, enables `Page`/`Runtime`, navigates, and asserts via `Runtime.evaluate`:
    - renders 438 `circle.star`.
    - exactly the 5 Crossroads entry stars are `selectable` from the empty state.
    - clicking `crossroads_eldritch:0` (a bubbling synthetic click) makes the count read `1 / 55`, the eldritch affinity total `1`, `bat:0` selectable, and the clicked star `selected`.
    - no `Runtime.consoleAPICalled` errors or `Runtime.exceptionThrown` during the run.
  - always tears down the server and `taskkill`s `chrome-headless-shell.exe`.

- [x] **Step 3: justfile recipes** `install-e2e` and `e2e: build`.

- [x] **Step 4: Run** `just e2e` -> build succeeds, 9/9 checks pass, exit 0; a regression exits nonzero.

- [x] **Step 5: Commit** `test(e2e): headless-browser page check via raw CDP over bun websocket (just e2e)`.

---

## Self-Review

**Spec coverage:**
- Full GD validity (predecessor + affinity gating, completion grants, Crossroads): Tasks 3-6. Covered
- In-memory JSON graph: Task 2. Covered
- SVG+CSS render, selectable/locked states: Task 11, 14. Covered
- grimtools-style click/drag-pan/wheel-zoom + reset: Tasks 9, 12, 14. Covered
- Guarded (leaf-valid) removal, reject rather than cascade: Task 6 `canRemove`/`toggleStar`, using Task 4 `validClosure` as the guard. Covered
- Slider default 55 + "Allocated X/N": Task 14. Covered
- Sidebar A (benefits + powers) and Sidebar B (affinity totals): Tasks 13, 14. Covered
- Hover tooltip (bonuses + requirement): Tasks 13, 14. Covered
- Optimized, git-ignored WebP art + manifest + graceful fallback: Tasks 10 (manifest load), 11 (optional art layer), 15 (pipeline). Covered
- bun + jq in install/doctor; test/build/serve/assets recipes: Tasks 1, 14, 15. Covered
- Playwright e2e verification of the real page in a headless browser: Task 17. Covered
- Hexagonal core fully unit-tested: Tasks 2-9. Covered
- GitHub Pages deploy pipeline (end-goal deliverable; SVG-only until the image-commit decision): Task 16. Covered

**Notes / deferred (per spec "out of scope"):** optimizer, URL build sharing. Committing images is gated on a separate decision (Task 16 ships SVG-only Pages until then). Also deferred: a *visual* "removable" hint on selected leaf stars (the guard is implemented via `canRemove`, but v1 simply makes a non-removable click a no-op; wiring a `removable` CSS class is a fast follow). Over-budget (cap lowered below allocation) is shown as the count text only.

**Type consistency:** `StarId`, `SelectionState`, `DevotionModel`, `affinityFrom`, `selectableStars`, `toggleStar`, `validClosure`, `renderSvgMarkup`/`mountSvg`, `httpDataSource`/`LoadedData`/`AssetManifest` names are used identically across producing and consuming tasks.

## Verification (end-to-end)

1. `just test`: all core suites green (model, affinity, rules-closure, rules-selectable, rules-toggle, aggregate, labels, viewbox, svgRenderer).
2. `just build && just serve`: manual interaction checklist in Task 14 Step 5.
3. `just assets [--include-nebula]`: art overlays; size at/under target; nothing committed.
