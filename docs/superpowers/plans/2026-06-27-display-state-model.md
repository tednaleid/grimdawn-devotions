# Display-State Model Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the map's scattered class-and-cascade styling with a pure `core/displayState.ts` that resolves every constellation/star/edge into a record (brightness + color + emphasis), which the adapter maps to SVG.

**Architecture:** Pure `core/displayState.ts` computes, per element, an
attainability `brightness` enum, an affinity-driven `color` outcome, and a set of
emphasis flags - all semantic (affinities, never hex). The adapter
(`svgRenderer.ts` + `styles.css`) maps records to SVG: brightness to an inline
`opacity` value, color to a desaturate filter / match halo / identity tint, and
emphasis to the existing glow/selection/diff treatments. Opacity stops being a
CSS class so independent signals can never collide on it again.

**Tech Stack:** TypeScript, Bun test, raw SVG strings, biome, CDP e2e (`web/e2e/smoke.ts`).

## Global Constraints

- Hexagonal boundary: `core/displayState.ts` is pure (no DOM, no hex colors, no
  SVG strings). Affinity match outcomes carry `Affinity[]`; the adapter resolves
  color via `affinityColor` (`web/src/adapters/affinityColors.ts`).
- Brightness representation: the spec says "a resolved opacity number." Because
  the axis model makes brightness a single tri-state enum (no composition left to
  do), this plan refines that to **core emits the `Brightness` enum and the
  adapter owns the enum -> opacity-number map.** Same anti-collision guarantee
  (one brightness signal, no cascade), with the tunable values kept in the
  adapter next to the other look values. This is intentional, not a spec gap.
- Three orthogonal channels, never cross-wired: brightness <- attainability
  (opacity only); color <- the affinity filter alone (`mute | match | identity`);
  emphasis <- a union (active self-glow, selection, taken gold, benefit-match
  enlarge+glow, compare-diff outline).
- The benefit filter only *emphasizes* matches (enlarge + glow); it does NOT
  de-emphasize non-matches (the old `.star.dim` behavior is removed).
- `mute` is desaturation (SVG `feColorMatrix`), never an opacity change. Nothing
  is exempt from `mute` (an active/selected element that fails the affinity filter
  is bright/glowing AND desaturated).
- Benefit-match glow renders as its own full-opacity layer so it reads on an
  unattainable (dim) star.
- Do NOT touch the reachability engine, `ReachView`'s shape, the `ports`
  boundary, the URL/`b=` format, or the tooltip/sidebar.
- Use the `justfile`: `just check` (biome format + full `bun test` + biome lint +
  `tsc --noEmit`) and `just e2e` (CDP smoke). The pre-commit hook runs the same
  unit gate; never `--no-verify`.
- New code files start with two `// ABOUTME:` lines. No emojis/emdashes/hyperbole.

## Spec

`docs/superpowers/specs/2026-06-27-display-state-model-design.md`.

## File Structure

- Create `web/src/core/displayState.ts` - pure per-element resolver + types
  (`Brightness`, `ColorOutcome`, `ConstellationDisplay`, `StarDisplay`,
  `EdgeDisplay`, `DisplaySettings`; functions `constellationDisplay`,
  `starDisplay`, `edgeDisplay`).
- Create `web/test/displayState.test.ts` - headless tests for the resolver.
- Modify `web/src/adapters/svgRenderer.ts` - consume the records; replace the
  class-based dim/aff-dim/match logic; add the `#mute` filter def and the
  enum->opacity / color / emphasis mappings.
- Modify `web/src/styles.css` - delete the opacity-collision rules; add the
  `mute` desaturate hook; opacity becomes a per-element inline attribute.
- Modify `web/test/svgRenderer.test.ts` - retarget the dim/aff-dim assertions.
- Modify `web/e2e/smoke.ts` - retarget the affinity/benefit-filter checks.
- Create `docs/display-model.md` - the evergreen reference.

## Reference: current renderer facts (read before Task 4)

- `renderSvgMarkup(model, state, opts: RenderOpts)` where `RenderOpts` =
  `{ manifest, highlight?, reach?, diff?, affinityFilter? }`.
  `affinityFilter` = `{ grants: Set<Affinity>; requires: Set<Affinity> }`.
- `ReachView` (`core/reachability.ts:1001`) = `{ completable: Set<string>;
  clickable: Set<StarId>; have; need; needSource }`.
- `matchedAffinities(con, grants, requires): Affinity[]`
  (`core/affinity.ts`) - the filter affinities a constellation provides.
- Star id format: `` `${constellationId}:${index}` `` (`core/types.ts:7`).
- Current per-element class logic to replace lives at `svgRenderer.ts:283-338`
  (art `ao`, link `cd`/`ao`, star `st`/`m`/`cd`/`ao`/`cmp`).

---

### Task 1: Pure module types + `constellationDisplay`

**Files:**
- Create: `web/src/core/displayState.ts`
- Test: `web/test/displayState.test.ts`

**Interfaces:**
- Consumes: `matchedAffinities` from `core/affinity.ts`; `Affinity`,
  `Constellation`, `Star`, `StarId` from `core/types.ts`; `ReachView` from
  `core/reachability.ts`.
- Produces:
  - `type Brightness = "active" | "attainable" | "unattainable"`
  - `type ColorOutcome = { kind: "identity" } | { kind: "mute" } | { kind: "match"; affinities: Affinity[] }`
  - `interface DisplaySettings { selected: Set<StarId>; reach?: ReachView; affinityFilter?: { grants: Set<Affinity>; requires: Set<Affinity> }; benefitMatch?: Set<StarId>; diff?: { added: Set<StarId>; removed: Set<StarId> } | null }`
  - `interface ConstellationDisplay { brightness: Brightness; color: ColorOutcome; selfGlow: boolean }`
  - `function constellationDisplay(con: Constellation, s: DisplaySettings): ConstellationDisplay`

- [ ] **Step 1: Write the failing test**

```ts
// web/test/displayState.test.ts
// ABOUTME: Headless tests for the pure display-state resolver.
// ABOUTME: Synthetic constellations/stars + ReachView keep each case deterministic.
import { test, expect } from "bun:test";
import { constellationDisplay, type DisplaySettings } from "../src/core/displayState";
import type { Affinity, Constellation, Star } from "../src/core/types";
import type { ReachView } from "../src/core/reachability";

function con(id: string, starIds: string[], bonus: Partial<Record<Affinity, number>> = {}): Constellation {
  return { id, name: id, starIds, affinityBonus: bonus, affinityRequired: {}, background: null } as unknown as Constellation;
}
function reach(over: Partial<ReachView> = {}): ReachView {
  return { completable: new Set(), clickable: new Set(), have: [0, 0, 0, 0, 0], need: [0, 0, 0, 0, 0], needSource: new Map(), ...over } as ReachView;
}
function settings(over: Partial<DisplaySettings> = {}): DisplaySettings {
  return { selected: new Set(), ...over };
}

test("constellation brightness: active when every star selected", () => {
  const c = con("c", ["c:0", "c:1"]);
  const d = constellationDisplay(c, settings({ selected: new Set(["c:0", "c:1"]), reach: reach() }));
  expect(d.brightness).toBe("active");
  expect(d.selfGlow).toBe(true);
});

test("constellation brightness: attainable when completable, unattainable otherwise", () => {
  const c = con("c", ["c:0"]);
  expect(constellationDisplay(c, settings({ reach: reach({ completable: new Set(["c"]) }) })).brightness).toBe("attainable");
  expect(constellationDisplay(c, settings({ reach: reach() })).brightness).toBe("unattainable");
});

test("constellation brightness: no reach view is permissively attainable", () => {
  expect(constellationDisplay(con("c", ["c:0"]), settings()).brightness).toBe("attainable");
});

test("constellation color: identity with no filter, match with matched affinities, mute otherwise", () => {
  const c = con("c", ["c:0"], { chaos: 2 });
  expect(constellationDisplay(c, settings()).color).toEqual({ kind: "identity" });
  const match = constellationDisplay(c, settings({ affinityFilter: { grants: new Set<Affinity>(["chaos"]), requires: new Set() } }));
  expect(match.color).toEqual({ kind: "match", affinities: ["chaos"] });
  const mute = constellationDisplay(c, settings({ affinityFilter: { grants: new Set<Affinity>(["order"]), requires: new Set() } }));
  expect(mute.color).toEqual({ kind: "mute" });
});

test("constellation: active and off-filter is active AND muted (no exemption)", () => {
  const c = con("c", ["c:0"], { chaos: 2 });
  const d = constellationDisplay(c, settings({ selected: new Set(["c:0"]), reach: reach({ completable: new Set(["c"]) }), affinityFilter: { grants: new Set<Affinity>(["order"]), requires: new Set() } }));
  expect(d.brightness).toBe("active");
  expect(d.color).toEqual({ kind: "mute" });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && bun test test/displayState.test.ts`
Expected: FAIL ("Cannot find module ... displayState").

- [ ] **Step 3: Write the module**

```ts
// web/src/core/displayState.ts
// ABOUTME: Pure resolver mapping each constellation/star/edge to a display record.
// ABOUTME: Three orthogonal channels - brightness (attainability), color (affinity filter), emphasis.
import type { Affinity, Constellation, Star, StarId } from "./types";
import type { ReachView } from "./reachability";
import { matchedAffinities } from "./affinity";

export type Brightness = "active" | "attainable" | "unattainable";
export type ColorOutcome = { kind: "identity" } | { kind: "mute" } | { kind: "match"; affinities: Affinity[] };

export interface DisplaySettings {
  selected: Set<StarId>;
  reach?: ReachView;
  affinityFilter?: { grants: Set<Affinity>; requires: Set<Affinity> };
  benefitMatch?: Set<StarId>;
  diff?: { added: Set<StarId>; removed: Set<StarId> } | null;
}

export interface ConstellationDisplay {
  brightness: Brightness;
  color: ColorOutcome;
  selfGlow: boolean;
}

// A constellation is active when fully selected, attainable when started or completable
// (or when no reach view is present, the permissive default), else unattainable.
function constellationBrightness(con: Constellation, s: DisplaySettings): Brightness {
  if (con.starIds.length > 0 && con.starIds.every((id) => s.selected.has(id))) return "active";
  if (!s.reach) return "attainable";
  if (con.starIds.some((id) => s.selected.has(id))) return "attainable";
  if (s.reach.completable.has(con.id)) return "attainable";
  return "unattainable";
}

// Color is driven by the affinity filter ALONE: a constellation that provides a filtered
// affinity matches (its matched colors), one that provides none mutes, no filter is identity.
function constellationColor(con: Constellation, s: DisplaySettings): ColorOutcome {
  if (!s.affinityFilter) return { kind: "identity" };
  const matched = matchedAffinities(con, s.affinityFilter.grants, s.affinityFilter.requires);
  return matched.length > 0 ? { kind: "match", affinities: matched } : { kind: "mute" };
}

export function constellationDisplay(con: Constellation, s: DisplaySettings): ConstellationDisplay {
  const brightness = constellationBrightness(con, s);
  return { brightness, color: constellationColor(con, s), selfGlow: brightness === "active" };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && bun test test/displayState.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add web/src/core/displayState.ts web/test/displayState.test.ts
git commit -m "feat(core): display-state resolver - types + constellationDisplay"
```

---

### Task 2: `starDisplay`

**Files:**
- Modify: `web/src/core/displayState.ts`
- Test: `web/test/displayState.test.ts`

**Interfaces:**
- Consumes: the Task 1 types + `constellationBrightness` helper (already in the module).
- Produces:
  - `interface StarDisplay { brightness: Brightness; color: { kind: "mute" } | { kind: "identity" }; clickable: boolean; selected: boolean; benefitMatch: boolean; diff: "add" | "remove" | null }`
  - `function starDisplay(star: Star, con: Constellation, s: DisplaySettings): StarDisplay`
- Note: stars never produce a `match` color (the affinity halo is a constellation
  concern); their color is `mute` or `identity`. `clickable` carries immediacy
  (colored vs grey). `benefitMatch` is emphasis, fully independent of `color`.

- [ ] **Step 1: Write the failing test**

```ts
// append to web/test/displayState.test.ts
import { starDisplay } from "../src/core/displayState";
import type { Star as StarT } from "../src/core/types";

function star(id: string, conId: string, preds: string[] = []): StarT {
  return { id, constellationId: conId, predecessors: preds, celestialPower: null, position: { x: 0, y: 0 } } as unknown as StarT;
}

test("star brightness: active selected; attainable when clickable OR constellation completable; else unattainable", () => {
  const c = con("c", ["c:0", "c:1"]);
  const s0 = star("c:0", "c");
  expect(starDisplay(s0, c, settings({ selected: new Set(["c:0"]), reach: reach() })).brightness).toBe("active");
  expect(starDisplay(s0, c, settings({ reach: reach({ clickable: new Set(["c:0"]) }) })).brightness).toBe("attainable");
  expect(starDisplay(star("c:1", "c"), c, settings({ reach: reach({ completable: new Set(["c"]) }) })).brightness).toBe("attainable");
  expect(starDisplay(s0, c, settings({ reach: reach() })).brightness).toBe("unattainable");
});

test("star immediacy: clickable true only when clickable (or no reach)", () => {
  const c = con("c", ["c:0"]);
  expect(starDisplay(star("c:0", "c"), c, settings({ reach: reach({ clickable: new Set(["c:0"]) }) })).clickable).toBe(true);
  expect(starDisplay(star("c:0", "c"), c, settings({ reach: reach() })).clickable).toBe(false);
  expect(starDisplay(star("c:0", "c"), c, settings()).clickable).toBe(true);
});

test("star color: muted when its constellation fails the affinity filter, identity when it passes", () => {
  const c = con("c", ["c:0"], { chaos: 2 });
  const onChaos = settings({ affinityFilter: { grants: new Set<Affinity>(["chaos"]), requires: new Set() } });
  const onOrder = settings({ affinityFilter: { grants: new Set<Affinity>(["order"]), requires: new Set() } });
  expect(starDisplay(star("c:0", "c"), c, onChaos).color).toEqual({ kind: "identity" });
  expect(starDisplay(star("c:0", "c"), c, onOrder).color).toEqual({ kind: "mute" });
});

test("star benefit-match is emphasis, independent of color: muted AND benefitMatch at once", () => {
  const c = con("c", ["c:0"], { chaos: 2 });
  const d = starDisplay(star("c:0", "c"), c, settings({ benefitMatch: new Set(["c:0"]), affinityFilter: { grants: new Set<Affinity>(["order"]), requires: new Set() } }));
  expect(d.benefitMatch).toBe(true);
  expect(d.color).toEqual({ kind: "mute" });
});

test("star diff add/remove flows through", () => {
  const c = con("c", ["c:0"]);
  const d = starDisplay(star("c:0", "c"), c, settings({ diff: { added: new Set(["c:0"]), removed: new Set() } }));
  expect(d.diff).toBe("add");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && bun test test/displayState.test.ts`
Expected: FAIL ("starDisplay is not a function").

- [ ] **Step 3: Add to the module**

```ts
// append to web/src/core/displayState.ts
export interface StarDisplay {
  brightness: Brightness;
  color: { kind: "mute" } | { kind: "identity" };
  clickable: boolean;
  selected: boolean;
  benefitMatch: boolean;
  diff: "add" | "remove" | null;
}

export function starDisplay(star: Star, con: Constellation, s: DisplaySettings): StarDisplay {
  const selected = s.selected.has(star.id);
  const clickable = !s.reach || s.reach.clickable.has(star.id);
  let brightness: Brightness;
  if (selected) brightness = "active";
  else if (!s.reach || clickable || s.reach.completable.has(con.id)) brightness = "attainable";
  else brightness = "unattainable";
  // Stars carry no affinity halo; the affinity axis only mutes them (when their constellation
  // provides none of the filtered colors) or leaves them at identity.
  const conColor = constellationColor(con, s);
  const color: StarDisplay["color"] = conColor.kind === "mute" ? { kind: "mute" } : { kind: "identity" };
  const diff = s.diff ? (s.diff.added.has(star.id) ? "add" : s.diff.removed.has(star.id) ? "remove" : null) : null;
  return { brightness, color, clickable, selected, benefitMatch: s.benefitMatch?.has(star.id) ?? false, diff };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && bun test test/displayState.test.ts`
Expected: PASS (10 tests).

- [ ] **Step 5: Commit**

```bash
git add web/src/core/displayState.ts web/test/displayState.test.ts
git commit -m "feat(core): display-state starDisplay"
```

---

### Task 3: `edgeDisplay`

**Files:**
- Modify: `web/src/core/displayState.ts`
- Test: `web/test/displayState.test.ts`

**Interfaces:**
- Consumes: Task 1/2 helpers.
- Produces:
  - `interface EdgeDisplay { brightness: Brightness; color: { kind: "mute" } | { kind: "identity" }; taken: boolean }`
  - `function edgeDisplay(con: Constellation, fromId: StarId, toId: StarId, s: DisplaySettings): EdgeDisplay`
- An edge is `active` when taken (both endpoints selected), else it follows its
  constellation's brightness (unattainable stays unattainable, anything else is
  attainable). Color mirrors the star rule (`mute` or `identity`).

- [ ] **Step 1: Write the failing test**

```ts
// append to web/test/displayState.test.ts
import { edgeDisplay } from "../src/core/displayState";

test("edge brightness: active when taken; else follows the constellation", () => {
  const c = con("c", ["c:0", "c:1"]);
  expect(edgeDisplay(c, "c:0", "c:1", settings({ selected: new Set(["c:0", "c:1"]), reach: reach() })).taken).toBe(true);
  expect(edgeDisplay(c, "c:0", "c:1", settings({ selected: new Set(["c:0", "c:1"]), reach: reach() })).brightness).toBe("active");
  expect(edgeDisplay(c, "c:0", "c:1", settings({ reach: reach({ completable: new Set(["c"]) }) })).brightness).toBe("attainable");
  expect(edgeDisplay(c, "c:0", "c:1", settings({ reach: reach() })).brightness).toBe("unattainable");
});

test("edge color: muted when its constellation fails the affinity filter", () => {
  const c = con("c", ["c:0", "c:1"], { chaos: 2 });
  const onOrder = settings({ affinityFilter: { grants: new Set<Affinity>(["order"]), requires: new Set() } });
  expect(edgeDisplay(c, "c:0", "c:1", onOrder).color).toEqual({ kind: "mute" });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && bun test test/displayState.test.ts`
Expected: FAIL ("edgeDisplay is not a function").

- [ ] **Step 3: Add to the module**

```ts
// append to web/src/core/displayState.ts
export interface EdgeDisplay {
  brightness: Brightness;
  color: { kind: "mute" } | { kind: "identity" };
  taken: boolean;
}

export function edgeDisplay(con: Constellation, fromId: StarId, toId: StarId, s: DisplaySettings): EdgeDisplay {
  const taken = s.selected.has(fromId) && s.selected.has(toId);
  const conBright = constellationBrightness(con, s);
  const brightness: Brightness = taken ? "active" : conBright === "unattainable" ? "unattainable" : "attainable";
  const conColor = constellationColor(con, s);
  const color: EdgeDisplay["color"] = conColor.kind === "mute" ? { kind: "mute" } : { kind: "identity" };
  return { brightness, color, taken };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && bun test test/displayState.test.ts`
Expected: PASS (12 tests).

- [ ] **Step 5: Run the full check and commit**

Run: `just check`
Expected: all green (new tests included).

```bash
git add web/src/core/displayState.ts web/test/displayState.test.ts
git commit -m "feat(core): display-state edgeDisplay"
```

---

### Task 4: Adapter migration - renderer + CSS consume the records

This is the large, atomic flip: the renderer stops emitting dim/aff-dim/match
classes and instead reads the records, applying brightness as an inline `opacity`,
color as a desaturate filter / identity, and emphasis as the existing treatments.
CSS loses the opacity-collision rules. Unit + e2e assertions retarget in the same
commit. Keep the existing affinity match-halo machinery (the `aff-glow` layer) -
it is now driven by `constellationDisplay(...).color.kind === "match"`.

**Files:**
- Modify: `web/src/adapters/svgRenderer.ts`
- Modify: `web/src/styles.css`
- Modify: `web/test/svgRenderer.test.ts`
- Modify: `web/e2e/smoke.ts`

**Interfaces:**
- Consumes: `constellationDisplay`, `starDisplay`, `edgeDisplay`, and the record
  types from `core/displayState.ts`; `affinityColor` from
  `adapters/affinityColors.ts`.

- [ ] **Step 1: Import the resolver, add the opacity maps, build `settings`, add the guarded `#mute` filter**

In `svgRenderer.ts`, add to the imports:

```ts
import { constellationDisplay, starDisplay, edgeDisplay } from "../core/displayState";
```

Add module-level constants near the other renderer constants (after `CON_PAD`):

```ts
// Brightness -> opacity, per element type. The only place these tunable values live (the spec's
// "resolved opacity number"); brightness itself is resolved purely in core, so nothing collides here.
const ART_OPACITY = { active: 1, attainable: 0.25, unattainable: 0.12 } as const;
const STAR_OPACITY = { active: 1, attainable: 1, unattainable: 0.3 } as const;
const EDGE_OPACITY = { active: 1, attainable: 1, unattainable: 0.3 } as const;
```

In `renderSvgMarkup`, right after `const diff = opts.diff ?? null;`, build the
settings object the loops share (do this first - Steps 2-4 use it):

```ts
  const settings = {
    selected: state.selected,
    reach: opts.reach,
    affinityFilter: opts.affinityFilter,
    benefitMatch: opts.highlight,
    diff,
  };
```

Add the desaturate filter **inside the existing `if (affFilter)` defs guard**
(where the `#aff-glow` def is pushed), so no `mute` substring appears in the
output when no affinity filter is active (the no-filter test asserts that):

```ts
// mute: drain color toward grey (the affinity-filter de-emphasis). SVG-native feColorMatrix
// because CSS filter: saturate() renders nothing on WebKit, like our other glows.
defs.push(
  `<filter id="mute" color-interpolation-filters="sRGB"><feColorMatrix type="saturate" values="0.18"/></filter>`,
);
```

- [ ] **Step 2: Replace the art (Layer 1) rendering with record-driven markup**

Replace the art-image + art-tint block (currently `svgRenderer.ts:283-290`, the
`const ao = affDim(...)` through the `art-tint` push) with:

```ts
      const cd = constellationDisplay(c, settings);
      const op = ART_OPACITY[cd.brightness];
      const muted = cd.color.kind === "mute" ? " mute" : "";
      const active = cd.selfGlow ? " active" : "";
      parts.push(`<image ${img} class="art${active}${muted}" opacity="${op}" data-con-id="${c.id}"/>`);
      if (presentAffinities(c.affinityRequired).length > 0) {
        ensureMask(c.id, art.url, x, y, art.w, art.h);
        parts.push(
          `<rect class="art-tint${active}${muted}" opacity="${op}" x="${x}" y="${y}" width="${art.w}" height="${art.h}" fill="url(#grad-${c.id})" mask="url(#mask-${c.id})"/>`,
        );
      }
```

(`img`, `x`, `y`, `art` are the existing locals in that loop. Remove the old
`const dim = conArtClass(c)`, `const act = isActive(c)`, `const active = act ? ...`,
and `const ao = affDim(...)` lines for this block - they are superseded.)

The Layer-0 affinity glow loop (the `aff-glow` rect) stays; two lines change so it
is driven by the resolver instead of the old `affMatchCons` set. Everything
between them (the art/background presence guards and the gradient/mask/rect
pushes) is unchanged.

(a) Replace the head line `if (!affMatchCons.has(c.id)) continue;` with:

```ts
      const cd0 = constellationDisplay(c, settings);
      if (cd0.color.kind !== "match") continue;
```

(b) Replace the matched-colors line
`const cols = matchedAffinities(c, affFilter.grants, affFilter.requires).map(affinityColor);`
with:

```ts
      const cols = cd0.color.affinities.map(affinityColor);
```

- [ ] **Step 3: Replace the links (Layer 2) rendering**

Replace the link loop body (`svgRenderer.ts:296-307`) with:

```ts
  for (const star of model.stars.values()) {
    const con = model.constellations.get(star.constellationId)!;
    for (const p of star.predecessors) {
      const a = model.stars.get(p);
      if (!a) continue;
      const ed = edgeDisplay(con, p, star.id, settings);
      const taken = ed.taken ? " taken" : "";
      const muted = ed.color.kind === "mute" ? " mute" : "";
      parts.push(
        `<line class="link${taken}${muted}" opacity="${EDGE_OPACITY[ed.brightness]}" x1="${a.position.x + STAR_CENTER}" y1="${a.position.y + STAR_CENTER}" x2="${star.position.x + STAR_CENTER}" y2="${star.position.y + STAR_CENTER}"/>`,
      );
    }
  }
```

- [ ] **Step 4: Replace the stars (Layer 3) rendering**

Replace the star loop body (`svgRenderer.ts:312-338`, from `const filtering` through
the closing `}`) with:

```ts
  for (const star of model.stars.values()) {
    const con = model.constellations.get(star.constellationId)!;
    const sd = starDisplay(star, con, settings);
    const solid = gradColors(con)[0] ?? "#9aa3b2";
    const cx = star.position.x + STAR_CENTER;
    const cy = star.position.y + STAR_CENTER;
    const style = `--affinity:${solid};--grad:url(#grad-${con.id})`;
    // Immediacy: a non-selected star is "selectable" (colored) when clickable, else "locked" (grey).
    const st = sd.selected ? "selected" : sd.clickable ? "selectable" : "locked";
    const muted = sd.color.kind === "mute" ? " mute" : "";
    const benefit = sd.benefitMatch ? " match" : "";
    const cmp = sd.diff === "add" ? " cmp-add" : sd.diff === "remove" ? " cmp-rm" : "";
    const op = STAR_OPACITY[sd.brightness];
    const cls = `star ${st}${benefit}${muted}${cmp}`;
    const visible = star.celestialPower
      ? `<polygon class="${cls}" opacity="${op}" points="${diamondPoints(cx, cy, POWER_RADIUS)}" style="${style}"/>`
      : `<circle class="${cls}" opacity="${op}" cx="${cx}" cy="${cy}" r="${STAR_RADIUS}" style="${style}"/>`;
    parts.push(`<circle data-star-id="${star.id}" class="hit ${st}" cx="${cx}" cy="${cy}" r="${HIT_RADIUS}"/>${visible}`);
  }
```

Note: the benefit-match glow must not be dimmed by the star's `opacity`. The
`.star.match` CSS already applies `filter: url(#match-glow)` and `transform:
scale(1.45)`. Since `opacity` on the element dims its filter output, in Step 6
the match treatment moves to a class that the CSS renders without the element
opacity (see Step 6). For this step, keep emitting the `match` class on the
visible star.

- [ ] **Step 5: Drop the dead helpers**

`settings` was built in Step 1. Delete the now-unused helpers and precomputes:
`conArtClass`, `isActive`, `dimCons`, `affMatchCons`, `affDim`, and the
`filtering` local. Keep `affFilter` (the `#aff-glow`/`#mute` def guards still use
it), `gradColors`, `gradientStops`, `ensureMask`, and the gradient/mask/glow defs.
(`conArtClass`'s `unmet`/`unreachable` class names disappear entirely - folded
into the `unattainable` opacity.)

- [ ] **Step 6: Rewrite the CSS - remove ALL opacity from these selectors, keep effects, add `mute`**

CRITICAL: a CSS `opacity` rule overrides an inline `opacity` presentation
attribute. So the inline opacity from Steps 2-4 only takes effect if **every**
`opacity` declaration is removed from `.art*`, `.art-tint*`, `.link*`, and
`.star*` rules. After this step the only opacity on these elements is the inline
attribute, plus the single intentional `.star.match { opacity: 1 !important }`
below.

In `web/src/styles.css`:

- Remove the `opacity` declaration from every one of these rules (delete the rule
  if `opacity` was its only declaration): `.art`, `.art.unmet`, `.art.unreachable`,
  `.art.active`, `.art-tint`, `.art-tint.unmet`, `.art-tint.unreachable`,
  `.art-tint.active`, `.link.con-dim`, `.star.locked`, `.star.locked.con-dim`,
  `.star.selectable`, `.star.con-dim`, `.star.dim`, `.star.match.con-dim`,
  `.art.aff-dim`, `.art-tint.aff-dim`, `.link.aff-dim`, `.star.aff-dim`.
- Delete the `--art-opacity`, `--art-tint-opacity`, and `--art-unmet-factor`
  custom properties (no longer referenced).
- KEEP the non-opacity effect rules: `.art.active` self-glow `filter`,
  `.art-tint.active` (only if it has non-opacity props; otherwise delete),
  `.link.taken` (gold + glow), `.star.locked { fill }`, `.star.selectable { fill;
  filter }`, `.star.selected` (white fill + stroke), `.star.match` (scale + halo).
- Note: the art-tint reuses `ART_OPACITY` for now (its old `--art-tint-opacity`
  base of 0.6 is gone). Task 5 may give the tint its own scale if the wash reads
  too weak.

Add the desaturate hook:

```css
/* Affinity-filter de-emphasis: drain color, never brightness (see #mute in the renderer). */
.mute {
  filter: url(#mute);
}
```

Make the benefit-match glow survive the star's `opacity`: draw it via a class
whose filter is composited independently. The simplest robust approach that keeps
the existing `#match-glow`: keep `.star.match { transform: scale(1.45); filter:
url(#match-glow); }` but set the visible matched star's own `opacity` to 1
regardless of attainability by adding, after the star rules:

```css
/* A benefit match is emphasized at full strength even on an unattainable (dim) star: the size
   and glow must read, so the matched marker ignores the attainability opacity. */
.star.match {
  opacity: 1 !important;
}
```

(`!important` overrides the inline `opacity` attribute. This is the one place we
intentionally let the benefit emphasis ignore brightness, per the spec's
"renders at full opacity so it reads on an unattainable star.")

- [ ] **Step 7: Retarget the renderer unit tests**

In `web/test/svgRenderer.test.ts`, update the dimming/affinity assertions to the
new output. Replace class-string expectations:

- The "two-layer dimming" tests: assert the inline opacity instead of `unmet`/
  `unreachable`/`con-dim` classes. For an unattainable constellation's art expect
  `opacity="0.12"`; for a completable one expect `opacity="1"` only when active,
  else `opacity="0.25"`. For a star in an unattainable constellation expect
  `opacity="0.3"`. Example replacement for the existing con-dim test:

```ts
test("stars and links in an unattainable constellation carry the unattainable opacity", () => {
  const dimCon = [...model.constellations.values()].find((c) =>
    c.starIds.some((id) => (model.stars.get(id)?.predecessors.length ?? 0) > 0),
  )!;
  const reach: ReachView = {
    completable: new Set([...model.constellations.keys()].filter((id) => id !== dimCon.id)),
    clickable: new Set(),
    have: [0, 0, 0, 0, 0],
    need: [0, 0, 0, 0, 0],
    needSource: new Map(),
  };
  const svg = renderSvgMarkup(model, { selected: new Set(), pointCap: 55 }, { manifest: null, reach });
  expect(svg).toMatch(/class="link"[^>]*opacity="0.3"/);
});
```

- The affinity tests: `aff-dim` becomes the `mute` class. Replace
  `toContain('class="art aff-dim"')` with `toContain(' class="art mute"')` (or a
  regex tolerant of the active prefix), `toContain('class="link aff-dim"')` with
  `toContain(' class="link mute"')`, and the star `aff-dim` checks with `mute`.
  Keep the `aff-glow` match-halo assertions unchanged (still emitted for matches).
- Update the "no affinity filter leaves no aff-dim classes" test to assert
  `not.toContain("mute")`.
- The regression test added earlier ("reachability dim dominates the affinity
  fade") is now structurally impossible to violate (separate channels): rewrite it
  to assert a muted, unattainable constellation's star carries BOTH
  `class="...mute"` AND `opacity="0.3"` (color and brightness independent).

Run: `cd web && bun test test/svgRenderer.test.ts` until green.

- [ ] **Step 8: Retarget the e2e smoke checks**

In `web/e2e/smoke.ts`, the affinity-filter block (around the
`.affinity.affinity-eldritch` toggle):

- Replace `document.querySelectorAll('.star.aff-dim').length > 0` with
  `document.querySelectorAll('.star.mute').length > 0`.
- Replace the toggle-off `=== 0` check's selector `.star.aff-dim` with
  `.star.mute`.
- Keep the `.aff-glow` present/absent checks unchanged.
- The benefit-filter checks: there is no longer a `.star.dim`; if any assertion
  references non-matching stars dimming, change it to assert matching stars carry
  `.star.match` and remove any non-match-dim assertion (benefit no longer dims
  non-matches).

Run: `just e2e` until green (49/49 or adjusted count).

- [ ] **Step 9: Full check and commit**

Run: `just check && just e2e`
Expected: all green.

```bash
git add web/src/adapters/svgRenderer.ts web/src/styles.css web/test/svgRenderer.test.ts web/e2e/smoke.ts
git commit -m "feat(ui): render the map from the pure display-state records"
```

---

### Task 5: Retune the values with visual verification

The migration carries the spec's starting values; this task tunes them live with
the human and fixes the muddiness the model was built to remove (`unmet` darker
than `unreachable` is already gone - both fold into `unattainable`).

**Files:**
- Modify: `web/src/adapters/svgRenderer.ts` (the `ART_OPACITY` / `STAR_OPACITY` /
  `EDGE_OPACITY` maps)
- Modify: `web/src/styles.css` (the `#mute` `saturate` value via the renderer def;
  effect looks - active glow, taken gold, match glow)

- [ ] **Step 1: Run the dev server and review each state with the human**

Run: `just dev` (or the project's serve recipe). Walk through, with an affinity
filter and a benefit filter: active vs attainable vs unattainable brightness;
matched vs muted constellations; a benefit-match on an unattainable star; an
active constellation that fails the filter (should read bright + glowing + greyed).

- [ ] **Step 2: Adjust the opacity maps and mute strength to the human's calls**

Edit `ART_OPACITY` / `STAR_OPACITY` / `EDGE_OPACITY` and the `#mute`
`feColorMatrix values` (and, if needed, the benefit/active/taken effect looks).
Tune iteratively; no value is frozen by the plan.

- [ ] **Step 3: Confirm tests still pass (update any pinned values)**

If a retuned opacity changes a value asserted in `svgRenderer.test.ts`, update the
assertion to match. Run `just check && just e2e`.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(ui): retune display-state brightness and mute values"
```

---

### Task 6: Evergreen `docs/display-model.md`

**Files:**
- Create: `docs/display-model.md`
- Modify: `CLAUDE.md` only if a docs index there lists the reference docs (add a
  one-line pointer next to `reachability-engine.md`).

- [ ] **Step 1: Write the reference**

Create `docs/display-model.md` covering, in broad strokes (no tuned values):

- The principle: three orthogonal channels - brightness (attainability), color
  (the affinity filter), emphasis (a union). Each owns its own channel, so they
  combine without colliding. The collision history that motivated it (one
  `opacity` property fought over by reachability and filtering).
- Brightness: `active | attainable | unattainable`, sourced from `ReachView`
  (`clickable` + `completable`); no reachability-engine changes; the deep-star
  approximation.
- Color: `mute | match | identity`, the affinity filter alone; `mute` is
  desaturation, never opacity.
- Emphasis: active self-glow, selection, taken gold, benefit-match enlarge+glow
  (its own full-opacity layer), compare-diff outline. The benefit filter only
  emphasizes matches.
- The pure-core/adapter split: `core/displayState.ts` emits semantic records
  (affinities, not hex; brightness enum, not pixels); `svgRenderer.ts` +
  `styles.css` map records to SVG and own the tunable look.

Keep it concise and current per the project's evergreen-doc rule (no dated
"update" sections).

- [ ] **Step 2: Commit**

```bash
git add docs/display-model.md CLAUDE.md
git commit -m "docs: evergreen display-model reference"
```

---

## Self-Review notes (planner)

- Spec coverage: brightness tri-state (T1-3), affinity color axis mute/match/
  identity (T1-3), benefit as independent emphasis with no non-match dim (T2, T4),
  mute-as-desaturate (T4), halo own-layer for unattainable matches (T4 step 6),
  attainability from existing `ReachView` (T1-3), adapter mapping + affinity->color
  (T4), CSS thinning (T4), retune (T5), e2e retarget (T4 step 8), evergreen doc
  (T6). All covered.
- The benefit-match `opacity: 1 !important` in T4 step 6 is the one spot where
  emphasis intentionally overrides brightness; flag it for the reviewer as
  spec-driven ("reads even on an unattainable star").
- The renderer migration (T4) is deliberately one atomic task: the render loop and
  CSS must switch together or the map is internally inconsistent. It is large; the
  implementer should expect a longer single task.
