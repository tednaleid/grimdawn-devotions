# Affinity Filter Visuals Refinement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Unify the selected-filter affordance on one blue squircle + hover standard (which also makes the active affinity obvious in the desktop tooltip), and replace the affinity-filter constellation dimming with a matched-color glow plus a much milder fade.

**Architecture:** Pure matched-color logic moves to a `matchedAffinities` core helper; the renderer takes the active `{grants, requires}` affinity sets and draws a blurred, art-masked colored halo behind matching constellations (WebKit-safe SVG filter) with a mild fade on the rest; `main.ts` parses the `aff:` tags into the two sets. CSS factors the selected affordance into one shared rule.

**Tech Stack:** TypeScript, Bun (tests), inline SVG filters/gradients/masks, raw-CDP e2e (`web/e2e/smoke.ts`).

## Global Constraints

- No emojis, emdashes, or hyperbole in code or comments.
- Glows use SVG-native `<filter>` (feGaussianBlur), never CSS `filter: drop-shadow()` on SVG (renders nothing on WebKit/iOS).
- The affinity glow color is built from ONLY the matched filter colors (`matchedAffinities`), as a left-to-right gradient when several match, reusing `gradientStops`.
- A benefit `match` star is never also faded by the affinity layer (keeps its blue glow), the same exemption the current renderer enforces.
- The selected affordance is one shared rule: faint fill `rgba(108, 182, 255, 0.08)` + 1.5px outline `rgba(108, 182, 255, 0.6)`; hover lights label text `#6cb6ff`.
- The benefit filter (per-star `match` glow + `dim`), the `b=` URL/tag model, and the `ports` boundary are untouched.
- Targeted tests: `cd web && bun test test/<file>.test.ts`. Full gate: `just check`. E2e: `just e2e`.

---

### Task 1: Unify the selected-filter styling (Part 1)

**Files:**
- Modify: `web/src/styles.css` (the `.bgroup.gsel` 247-250, `.brow.vsel` 266-269 and `.brow.vsel .brow-lbl.subj` 281-283, `.brow-lbl.subj:hover` 284-286, `.affinity > span:first-child` 410-412, `.affinity.vsel` 465-468, and the tooltip `.tip-bonus.vsel`/`.aff.vsel` rules near 684)

**Interfaces:** CSS only. No new classes; `vsel`/`gsel` keep their names (the class-application unit tests are unaffected).

- [ ] **Step 1: Add the shared selected affordance and retire the gold/opaque variants**

In `web/src/styles.css`, REPLACE the `.bgroup.gsel` rule (lines 247-250):

```css
.bgroup.gsel {
  background: rgba(108, 182, 255, 0.08);
  box-shadow: 0 0 0 1.5px rgba(108, 182, 255, 0.6);
}
```

with a shared rule covering every active filter tag (the per-element `border-radius` stays on each element's own rule, so the pill/row shapes are preserved):

```css
/* The single "active filter tag" affordance: a light blue fill + squircle outline, matching the
   Available-to-get pills. Each element keeps its own border-radius; hover rules light the label. */
.bgroup.gsel,
.brow.vsel,
.affinity.vsel,
.tip-bonus.vsel,
.aff.vsel {
  background: rgba(108, 182, 255, 0.08);
  box-shadow: 0 0 0 1.5px rgba(108, 182, 255, 0.6);
}
```

- [ ] **Step 2: Strip the old gold edge from `.brow.vsel` and add the hover**

REPLACE `.brow.vsel` (lines 266-269):

```css
.brow.vsel {
  background: #20313f;
  box-shadow: inset 3px 0 0 #e3c97a;
}
```

with (the blue look now comes from the shared rule; keep the row's existing `border-radius: 4px` from `.brow`):

```css
.brow.vsel {
  border-radius: 4px;
}
```

REPLACE `.brow.vsel .brow-lbl.subj` (lines 281-283):

```css
.brow.vsel .brow-lbl.subj {
  color: #eef2f8;
}
```

with a hover that lights the subject label to the standard blue:

```css
.brow-lbl.subj:hover,
.brow.vsel .brow-lbl.subj {
  color: #6cb6ff;
}
```

Then REPLACE the now-duplicate `.brow-lbl.subj:hover` rule (lines 284-286):

```css
.brow-lbl.subj:hover {
  text-decoration: underline;
}
```

with just the underline-free state folded above — delete this rule entirely (the hover color is handled by the combined rule you just wrote).

- [ ] **Step 3: Affinity panel row + hover**

REPLACE `.affinity.vsel` (lines 465-468):

```css
.affinity.vsel {
  box-shadow: inset 3px 0 0 #e3c97a;
  border-radius: 4px;
}
```

with (blue from the shared rule; keep a rounded outline; the row is already `cursor: pointer`):

```css
.affinity.vsel {
  border-radius: 6px;
}
```

REPLACE `.affinity > span:first-child` (lines 410-412):

```css
.affinity > span:first-child {
  text-transform: capitalize;
}
```

with a hover that lights the affinity name:

```css
.affinity > span:first-child {
  text-transform: capitalize;
}
.affinity:hover > span:first-child {
  color: #6cb6ff;
}
```

- [ ] **Step 4: Tooltip rows**

Find the tooltip selected rules added earlier (after the `.tip-grant .aff` block, near line 684):

```css
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

REPLACE both with (blue fill + outline from the shared rule; keep the small radius so the inline pill hugs the text):

```css
.tip-bonus.vsel {
  border-radius: 3px;
}
.aff.vsel {
  border-radius: 3px;
  padding: 0 2px;
}
```

- [ ] **Step 5: Verify the existing class-application tests still pass and build is clean**

Run: `cd web && bun test test/sidebar-affinity.test.ts test/tooltip-filter.test.ts`
Expected: PASS (these assert the `vsel`/`data-vid` classes, which are unchanged).

Run: `just check`
Expected: fmt/test/lint/typecheck green.

- [ ] **Step 6: Commit**

```bash
git add web/src/styles.css
git commit -m "feat(ui): unify selected-filter styling on the blue squircle + hover standard"
```

---

### Task 2: `matchedAffinities` core helper

**Files:**
- Modify: `web/src/core/affinity.ts` (imports line 3; add a function after `constellationsMatchingAffinity`)
- Test: `web/test/affinity.test.ts` (append one test)

**Interfaces:**
- Produces: `matchedAffinities(con: Constellation, grants: Set<Affinity>, requires: Set<Affinity>): Affinity[]` — the affinities, in `AFFINITIES` order, that are in `grants` and granted (`affinityBonus > 0`) or in `requires` and required (`affinityRequired > 0`). Empty when none match.

This is additive; `constellationsMatchingAffinity` stays for now (Task 3 removes it after `main.ts` stops using it), so the build stays green.

- [ ] **Step 1: Write the failing test**

Append to `web/test/affinity.test.ts`:

```ts
import { matchedAffinities } from "../src/core/affinity";

test("matchedAffinities returns only the filter affinities the constellation provides, in canonical order", () => {
  // Synthetic constellation: grants eldritch + order, requires chaos.
  const con = { affinityBonus: { eldritch: 3, order: 2 }, affinityRequired: { chaos: 5 } } as any;
  expect(matchedAffinities(con, new Set(["eldritch"]), new Set())).toEqual(["eldritch"]);
  expect(matchedAffinities(con, new Set(["order", "eldritch"]), new Set())).toEqual(["eldritch", "order"]); // canonical order
  expect(matchedAffinities(con, new Set(["chaos"]), new Set())).toEqual([]); // chaos is required, not granted -> no grant match
  expect(matchedAffinities(con, new Set(), new Set(["chaos"]))).toEqual(["chaos"]);
  expect(matchedAffinities(con, new Set(), new Set(["order"]))).toEqual([]); // order is granted, not required
  expect(matchedAffinities(con, new Set(), new Set())).toEqual([]);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd web && bun test test/affinity.test.ts`
Expected: FAIL with `Export named 'matchedAffinities' not found`.

- [ ] **Step 3: Implement**

In `web/src/core/affinity.ts`, change the import on line 3 from:

```ts
import { AFFINITIES, type Affinity, type AffinityMap, type DevotionModel, type StarId } from "./types";
```

to add `Constellation`:

```ts
import { AFFINITIES, type Affinity, type AffinityMap, type Constellation, type DevotionModel, type StarId } from "./types";
```

Add after `constellationsMatchingAffinity`:

```ts
// The affinities a constellation provides for the active affinity filter: those in `grants` it grants
// (affinityBonus > 0) or in `requires` it requires (affinityRequired > 0), in canonical order. Drives
// the renderer's matched-color glow; empty means the constellation does not match the filter.
export function matchedAffinities(con: Constellation, grants: Set<Affinity>, requires: Set<Affinity>): Affinity[] {
  return AFFINITIES.filter(
    (a) => (grants.has(a) && (con.affinityBonus[a] ?? 0) > 0) || (requires.has(a) && (con.affinityRequired[a] ?? 0) > 0),
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd web && bun test test/affinity.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/core/affinity.ts web/test/affinity.test.ts
git commit -m "feat(core): matchedAffinities helper for the affinity match glow"
```

---

### Task 3: Renderer takes the affinity filter sets; mild fade replaces the hard fade

**Files:**
- Modify: `web/src/adapters/svgRenderer.ts` (imports lines 3-5; `RenderOpts` 50-56; the `affFiltering`/`affOff` block 159-162; art image 219-220; art-tint 221-227; links 233-243; stars 249-271; `SvgHandle.update` interface; inner `render`; returned `update`)
- Modify: `web/src/app/main.ts` (the `affinity` import line 33; `affinityMatchCons` and its `handle.update` call site)
- Modify: `web/src/core/affinity.ts` (remove `constellationsMatchingAffinity`)
- Modify: `web/src/styles.css` (replace the `.aff-off` block 630-642)
- Modify: `web/test/svgRenderer.test.ts` (retune the three aff-off tests to aff-dim + the new input)
- Modify: `web/test/affinity.test.ts` (remove the `constellationsMatchingAffinity` test)
- Modify: `web/e2e/smoke.ts` (the desktop affinity block: `.star.aff-off` -> `.star.aff-dim`)

**Interfaces:**
- Consumes: `matchedAffinities` (Task 2).
- Produces: `RenderOpts.affinityFilter?: { grants: Set<Affinity>; requires: Set<Affinity> }` replacing `affinityMatch`; `SvgHandle.update`'s 5th arg becomes `affinityFilter?`; `main.ts` `affinityFilterSets(): { grants: Set<Affinity>; requires: Set<Affinity> } | undefined` replacing `affinityMatchCons`.

- [ ] **Step 1: Retune the renderer tests (RED)**

In `web/test/svgRenderer.test.ts`, add the import (top of file, with the other imports):

```ts
import { AFFINITIES } from "../src/core/types";
```

REPLACE the three aff-off tests (the ones titled "no affinity filter leaves no aff-off classes", "an affinity filter fades non-matching constellations but exempts benefit matches", and "affinity off-target fades the constellation art") with:

```ts
test("no affinity filter leaves no aff-dim classes", () => {
  const markup = renderSvgMarkup(model, { selected: new Set(), pointCap: 55 }, { manifest: null });
  expect(markup).not.toContain("aff-dim");
});

test("an affinity filter mild-fades non-matching constellations but exempts benefit matches", () => {
  const matchStar = "crossroads_eldritch:0"; // crossroads grant no affinity, so this constellation never matches
  const markup = renderSvgMarkup(model, { selected: new Set(), pointCap: 55 }, {
    manifest: null,
    affinityFilter: { grants: new Set(["eldritch"]), requires: new Set() },
    highlight: new Set([matchStar]),
  });
  expect(markup).toContain('class="star selectable match"'); // benefit match keeps full treatment
  expect(markup).not.toContain("match aff-dim"); // a match is never faded by the affinity layer
  expect(markup).toContain(' aff-dim"'); // non-matching stars fade
  expect(markup).toContain('class="link aff-dim"'); // links fade too
});

test("a non-matching constellation's art gets aff-dim", () => {
  const c = [...model.constellations.values()].find((c) => c.background?.image && c.background.x != null)!;
  const notGranted = AFFINITIES.find((a) => (c.affinityBonus[a] ?? 0) === 0)!; // an affinity c does not grant
  const name = c.background!.image!.split("/").pop()!;
  const manifest = { images: { [name]: { url: "art.webp", w: 64, h: 64 } } };
  const markup = renderSvgMarkup(model, { selected: new Set(), pointCap: 55 }, {
    manifest,
    affinityFilter: { grants: new Set([notGranted]), requires: new Set() },
  });
  expect(markup).toContain('class="art aff-dim"');
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd web && bun test test/svgRenderer.test.ts`
Expected: FAIL (`affinityFilter` is not a known option; `aff-dim` not emitted).

- [ ] **Step 3: Renderer — input type, match set, mild fade**

In `web/src/adapters/svgRenderer.ts`, add `Affinity` to the type import (lines 3-5 import block; the `types` import currently lists `Constellation, DevotionModel, SelectionState, StarId`) and import `matchedAffinities`:

```ts
import type { Affinity, Constellation, DevotionModel, SelectionState, StarId } from "../core/types";
```

and add with the other core imports:

```ts
import { matchedAffinities } from "../core/affinity";
```

REPLACE the `RenderOpts.affinityMatch` field (in the interface at lines 50-56):

```ts
  // When present, an affinity filter is active: constellations NOT in this set fade (aff-off).
  // Empty set means a filter is active but nothing matches, so every constellation fades.
  affinityMatch?: Set<string>;
```

with:

```ts
  // When present, an affinity filter is active. A constellation matches when it provides any of these
  // filter affinities (matchedAffinities); matching constellations glow (see the aff-glow layer) and
  // the rest get a mild aff-dim fade.
  affinityFilter?: { grants: Set<Affinity>; requires: Set<Affinity> };
```

REPLACE the `affFiltering`/`affOff` block (lines 159-162):

```ts
  // Affinity filter: when affinityMatch is present, constellations not in it fade their art, links,
  // and stars (a stronger, separate fade from con-dim). A benefit match star is exempt (see below).
  const affFiltering = opts.affinityMatch !== undefined;
  const affOff = (conId: string): boolean => affFiltering && !opts.affinityMatch!.has(conId);
```

with a precomputed match set and a mild-fade predicate:

```ts
  // Affinity filter: a constellation matches when it provides any filtered affinity. Matching
  // constellations glow (aff-glow layer); the rest get a mild aff-dim fade (a benefit match star is
  // exempt, see below). Precompute the matching set once for both the glow layer and the fade.
  const affFilter = opts.affinityFilter;
  const affMatchCons = new Set<string>();
  if (affFilter) {
    for (const c of model.constellations.values())
      if (matchedAffinities(c, affFilter.grants, affFilter.requires).length > 0) affMatchCons.add(c.id);
  }
  const affDim = (conId: string): boolean => affFilter !== undefined && !affMatchCons.has(conId);
```

Now swap every `affOff(...)`/`aff-off` for `affDim(...)`/`aff-dim`:

- Art image (line 219-220): change `const ao = affOff(c.id) ? " aff-off" : "";` to `const ao = affDim(c.id) ? " aff-dim" : "";` (the `${ao}` interpolation on the `class="art..."` is unchanged).
- Art-tint (line 225): the `${ao}` on `class="art-tint..."` is unchanged (it uses the same `ao`).
- Links (line 235): change `const ao = affOff(star.constellationId) ? " aff-off" : "";` to `const ao = affDim(star.constellationId) ? " aff-dim" : "";`.
- Stars (line 265): change `const ao = !isMatch && affOff(star.constellationId) ? " aff-off" : "";` to `const ao = !isMatch && affDim(star.constellationId) ? " aff-dim" : "";`.

REPLACE the `SvgHandle.update` interface signature's 5th param `affinityMatch?: Set<StarId>` (in the `update(...)` type) with `affinityFilter?: { grants: Set<Affinity>; requires: Set<Affinity> }`. Concretely the interface becomes:

```ts
  update(
    state: SelectionState,
    highlight?: Set<StarId>,
    reach?: ReachView,
    diff?: { added: Set<StarId>; removed: Set<StarId> } | null,
    affinityFilter?: { grants: Set<Affinity>; requires: Set<Affinity> },
  ): void;
```

REPLACE the inner `render` function's 5th param and its `renderSvgMarkup` call:

```ts
  function render(
    state: SelectionState,
    highlight?: Set<StarId>,
    reach?: ReachView,
    diff?: { added: Set<StarId>; removed: Set<StarId> } | null,
    affinityFilter?: { grants: Set<Affinity>; requires: Set<Affinity> },
  ) {
    container.innerHTML = renderSvgMarkup(model, state, { manifest: deps.manifest, highlight, reach, diff, affinityFilter });
  }
```

REPLACE the returned `update` method:

```ts
    update(state, highlight, reach, diff, affinityFilter) {
      const live = container.querySelector("svg") as SVGSVGElement | null;
      const vb = live?.getAttribute("viewBox");
      render(state, highlight, reach, diff, affinityFilter);
      const next = container.querySelector("svg") as SVGSVGElement | null;
      if (vb && next) next.setAttribute("viewBox", vb); // preserve pan/zoom across re-render
    },
```

- [ ] **Step 4: CSS — mild fade replaces the hard fade**

In `web/src/styles.css`, REPLACE the `.aff-off` block (lines 630-642):

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

with a much milder fade (matches glow instead, so non-matches only need a gentle de-emphasis, clearly lighter than the reachability con-dim):

```css
/* Affinity filter active: non-matching constellations get a MILD fade (matching ones glow, see the
   aff-glow layer). Deliberately lighter than the reachability con-dim so the two read differently;
   benefit matches never get aff-dim, so they keep their glow. */
.art.aff-dim,
.art-tint.aff-dim {
  opacity: 0.45;
}
.link.aff-dim {
  opacity: 0.5;
}
.star.aff-dim {
  opacity: 0.5;
}
```

- [ ] **Step 5: main.ts — pass the filter sets; remove the old helper**

In `web/src/app/main.ts`, REPLACE the affinity import (line 33):

```ts
import { affinityTotals, constellationsMatchingAffinity } from "../core/affinity";
```

with:

```ts
import { affinityTotals } from "../core/affinity";
```

REPLACE the `affinityMatchCons` function:

```ts
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

with one that returns the sets:

```ts
  // The active affinity filter as grant/require sets, or undefined when no affinity tag is selected.
  // The renderer matches each constellation against these (matchedAffinities) to glow it or mild-fade it.
  function affinityFilterSets(): { grants: Set<Affinity>; requires: Set<Affinity> } | undefined {
    const grants = new Set<Affinity>();
    const requires = new Set<Affinity>();
    for (const k of selectedBenefits) {
      if (k.startsWith("aff:grant:")) grants.add(k.slice("aff:grant:".length) as Affinity);
      else if (k.startsWith("aff:req:")) requires.add(k.slice("aff:req:".length) as Affinity);
    }
    if (grants.size === 0 && requires.size === 0) return undefined;
    return { grants, requires };
  }
```

REPLACE the `handle.update` call:

```ts
    handle.update(state, taggedStars(), reach, diff, affinityMatchCons());
```

with:

```ts
    handle.update(state, taggedStars(), reach, diff, affinityFilterSets());
```

- [ ] **Step 6: Remove the superseded core helper and its test**

In `web/src/core/affinity.ts`, DELETE the entire `constellationsMatchingAffinity` function (the export added previously, including its doc comment).

In `web/test/affinity.test.ts`, DELETE the test titled "constellationsMatchingAffinity matches granted and required affinities" and remove the now-unused `import { constellationsMatchingAffinity } from ...` if it is a standalone import line (keep the `matchedAffinities` import added in Task 2).

- [ ] **Step 7: e2e — aff-off becomes aff-dim**

In `web/e2e/smoke.ts`, in the desktop affinity-filter block (the one that clicks `.affinity[data-vid="aff:grant:eldritch"]`), change the two `.star.aff-off` selectors to `.star.aff-dim`:

- the check `"an affinity grant filter fades non-matching constellations (.star.aff-off)"` -> assert `document.querySelectorAll('.star.aff-dim').length > 0`, message `"...(.star.aff-dim)"`.
- the toggle-off check -> assert `document.querySelectorAll('.star.aff-dim').length === 0`.

- [ ] **Step 8: Verify**

Run: `cd web && bun test test/svgRenderer.test.ts test/affinity.test.ts`
Expected: PASS (retuned renderer tests; affinity tests minus the removed one).

Run: `cd web && bunx tsc --noEmit` then `just e2e` then `just check`
Expected: tsc clean; `E2E PASS` (the desktop block now asserts `.star.aff-dim`); full gate green.

- [ ] **Step 9: Commit**

```bash
git add web/src/adapters/svgRenderer.ts web/src/app/main.ts web/src/core/affinity.ts web/src/styles.css web/test/svgRenderer.test.ts web/test/affinity.test.ts web/e2e/smoke.ts
git commit -m "feat(ui): affinity filter passes grant/require sets; mild fade replaces the hard fade"
```

---

### Task 4: Affinity match glow layer

**Files:**
- Modify: `web/src/adapters/svgRenderer.ts` (add the `#aff-glow` filter def; add a `maskBuilt`/`ensureMask` helper; add a Layer 0 glow pass before the art layer; refactor the art-tint mask to use `ensureMask`)
- Modify: `web/src/styles.css` (add `.aff-glow`)
- Modify: `web/test/svgRenderer.test.ts` (append glow tests)
- Modify: `web/e2e/smoke.ts` (assert the glow in the desktop affinity block)

**Interfaces:**
- Consumes: `affMatchCons`, `matchedAffinities`, `affinityColor`, `gradientStops` (all in scope / imported).
- Produces: matching constellations emit `<rect class="aff-glow" ... fill="url(#aff-grad-<id>)" mask="url(#mask-<id>)" filter="url(#aff-glow)"/>`.

- [ ] **Step 1: Append the glow tests (RED)**

In `web/test/svgRenderer.test.ts`, add the import (with the other imports):

```ts
import { affinityColor, presentAffinities } from "../src/adapters/affinityColors";
```

Append:

```ts
test("a matching constellation emits a colored glow with its matched-color gradient", () => {
  const c = [...model.constellations.values()].find(
    (c) => c.background?.image && c.background.x != null && presentAffinities(c.affinityBonus).length > 0,
  )!;
  const a = presentAffinities(c.affinityBonus)[0]!; // an affinity c grants
  const name = c.background!.image!.split("/").pop()!;
  const manifest = { images: { [name]: { url: "art.webp", w: 64, h: 64 } } };
  const markup = renderSvgMarkup(model, { selected: new Set(), pointCap: 55 }, {
    manifest,
    affinityFilter: { grants: new Set([a]), requires: new Set() },
  });
  expect(markup).toContain(`<linearGradient id="aff-grad-${c.id}"`);
  expect(markup).toContain('class="aff-glow"');
  expect(markup).toContain(`mask="url(#mask-${c.id})"`);
  expect(markup).toContain('filter="url(#aff-glow)"');
  expect(markup).toContain(affinityColor(a)); // glow uses the matched color
});

test("no glow without an affinity filter", () => {
  const markup = renderSvgMarkup(model, { selected: new Set(), pointCap: 55 }, { manifest: null });
  expect(markup).not.toContain("aff-glow");
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd web && bun test test/svgRenderer.test.ts`
Expected: FAIL (no `aff-glow` / `aff-grad` emitted).

- [ ] **Step 3: Add the glow filter def**

In `web/src/adapters/svgRenderer.ts`, after the `self-glow` / `self-glow-art` defs (the `defs.push(` block ending around line 194), add:

```ts
  // Affinity match glow: a diffuse colored halo. The source is a gradient-filled, art-masked rect (the
  // constellation's MATCHED affinity colors), blurred and brightened into a soft halo. SVG-native (CSS
  // drop-shadow on SVG fails on WebKit). stdDeviation is in user units, so the halo scales with zoom;
  // start diffuse and tune. The filter region is expanded so the blur is not clipped.
  defs.push(
    `<filter id="aff-glow" x="-100%" y="-100%" width="300%" height="300%" color-interpolation-filters="sRGB">` +
      `<feGaussianBlur in="SourceGraphic" stdDeviation="40" result="b"/>` +
      `<feComponentTransfer in="b" result="bright"><feFuncR type="linear" slope="1.4"/><feFuncG type="linear" slope="1.4"/><feFuncB type="linear" slope="1.4"/></feComponentTransfer>` +
      `<feMerge><feMergeNode in="bright"/><feMergeNode in="bright"/></feMerge>` +
      `</filter>`,
  );
```

- [ ] **Step 4: Shared mask builder**

Immediately before the "Layer 1: optional art" block (before the `if (opts.manifest) {` at line 206), add a once-per-constellation mask builder:

```ts
  // Art-silhouette masks, built once per constellation and shared by the glow halo (Layer 0) and the
  // art tint (Layer 1). A constellation needs one only if it has art AND it either matches the filter
  // or carries an affinity-requirement tint.
  const maskBuilt = new Set<string>();
  const ensureMask = (cid: string, url: string, x: number, y: number, w: number, h: number) => {
    if (maskBuilt.has(cid)) return;
    maskBuilt.add(cid);
    defs.push(`<mask id="mask-${cid}"><image href="${url}" x="${x}" y="${y}" width="${w}" height="${h}"/></mask>`);
  };
```

- [ ] **Step 5: Layer 0 glow pass (before the art layer)**

Immediately before the "Layer 1: optional art" comment/block, add:

```ts
  // Layer 0: affinity match glow, drawn beneath the art so the colored halo bleeds out around matching
  // constellations. The gradient is built from ONLY the matched affinity colors (solid when one matches).
  if (opts.manifest && affFilter) {
    for (const c of model.constellations.values()) {
      if (!affMatchCons.has(c.id)) continue;
      const name = c.background?.image?.split("/").pop() ?? "";
      const art = opts.manifest.images[name];
      if (!(art && c.background && c.background.x != null && c.background.y != null)) continue;
      const { x, y } = c.background;
      const cols = matchedAffinities(c, affFilter.grants, affFilter.requires).map(affinityColor);
      defs.push(`<linearGradient id="aff-grad-${c.id}" x1="0" y1="0" x2="1" y2="0">${gradientStops(cols)}</linearGradient>`);
      ensureMask(c.id, art.url, x, y, art.w, art.h);
      parts.push(
        `<rect class="aff-glow" x="${x}" y="${y}" width="${art.w}" height="${art.h}" fill="url(#aff-grad-${c.id})" mask="url(#mask-${c.id})" filter="url(#aff-glow)"/>`,
      );
    }
  }
```

- [ ] **Step 6: Refactor the art-tint mask to share `ensureMask`**

In the art layer (the `if (presentAffinities(c.affinityRequired).length > 0)` block, lines 221-227), REPLACE:

```ts
      if (presentAffinities(c.affinityRequired).length > 0) {
        const mid = `mask-${c.id}`;
        defs.push(`<mask id="${mid}"><image ${img}/></mask>`);
        parts.push(
          `<rect class="art-tint${dim}${active}${ao}" x="${x}" y="${y}" width="${art.w}" height="${art.h}" fill="url(#grad-${c.id})" mask="url(#${mid})"/>`,
        );
      }
```

with (reuse the shared mask so a constellation that both matches and has a requirement does not get a duplicate mask id):

```ts
      if (presentAffinities(c.affinityRequired).length > 0) {
        ensureMask(c.id, art.url, x, y, art.w, art.h);
        parts.push(
          `<rect class="art-tint${dim}${active}${ao}" x="${x}" y="${y}" width="${art.w}" height="${art.h}" fill="url(#grad-${c.id})" mask="url(#mask-${c.id})"/>`,
        );
      }
```

- [ ] **Step 7: CSS for the glow rect**

In `web/src/styles.css`, add near the `.aff-dim` block:

```css
/* The affinity match halo (see #aff-glow in the renderer). Non-interactive so it never intercepts a
   click meant for the art/stars beneath or around it. */
.aff-glow {
  pointer-events: none;
}
```

- [ ] **Step 8: Add the glow assertion to the desktop e2e block**

In `web/e2e/smoke.ts`, in the desktop affinity block, after the `.star.aff-dim` check (filter ON), add a check that matching constellations glow:

```ts
  check(
    (await cdp.evaluate<number>("document.querySelectorAll('.aff-glow').length")) > 0,
    "an affinity grant filter glows matching constellations (.aff-glow)",
  );
```

and after the toggle-off `.star.aff-dim === 0` check, assert the glow is gone:

```ts
  check(
    (await cdp.evaluate<number>("document.querySelectorAll('.aff-glow').length")) === 0,
    "toggling the affinity filter off removes the glow",
  );
```

- [ ] **Step 9: Verify**

Run: `cd web && bun test test/svgRenderer.test.ts`
Expected: PASS (glow tests plus the retuned fade tests).

Run: `just e2e` then `just check`
Expected: `E2E PASS` (glow present with the filter on, gone when off); full gate green.

- [ ] **Step 10: Commit**

```bash
git add web/src/adapters/svgRenderer.ts web/src/styles.css web/test/svgRenderer.test.ts web/e2e/smoke.ts
git commit -m "feat(ui): matched-color glow on constellations matching the affinity filter"
```

---

### Task 5: Affinity panel click filters by the color (grant + require)

**Files:**
- Modify: `web/src/adapters/sidebarView.ts` (the `renderAffinities` row template, lines 206-208)
- Modify: `web/test/sidebar-affinity.test.ts` (the two affinity-row tests)
- Modify: `web/e2e/smoke.ts` (the two `.affinity[data-vid="aff:grant:eldritch"]` click selectors)

**Context:** The desktop affinity panel only sets the `aff:grant:<a>` tag, so filtering a color glows the inner constellations that GRANT it but never the outer constellations that REQUIRE it (the payoff constellations). The renderer already matches and glows both grant and require (`matchedAffinities`); only the panel control needs to set both tags. The fix makes a panel row toggle the COLOR: both `aff:grant:<a>` and `aff:req:<a>` together, reusing the existing `onBenefitClick` group-toggle (no renderer or `main.ts` change).

**Interfaces:**
- Consumes: the existing `onBenefitClick` group branch (`closest("[data-gtoggle]")?.closest("[data-gkey]")`, toggles every id in `data-ids` together) and `affinityTagId`.
- Produces: the affinity row carries `data-gkey`, `data-gtoggle`, and `data-ids="aff:grant:<a>,aff:req:<a>"` (no `data-vid`); selected (`vsel`) when the grant tag is active.

- [ ] **Step 1: Update the panel tests (RED)**

In `web/test/sidebar-affinity.test.ts`, REPLACE the test "every affinity row carries its grant data-vid" with:

```ts
test("every affinity row toggles both the grant and require tag for its color", () => {
  const html = render([0, 0, 0, 0, 0], [0, 0, 0, 0, 0], new Map());
  expect(html).toContain('data-ids="aff:grant:order,aff:req:order"');
  expect(html).toContain('data-ids="aff:grant:eldritch,aff:req:eldritch"');
  expect(html).toContain("data-gtoggle");
  expect(html).not.toContain("data-vid"); // the row is a color group-toggle now, not a single-tag vid
});
```

and REPLACE the test "an active grant tag marks its affinity row selected" with:

```ts
test("an active color filter marks its affinity row selected", () => {
  const html = render([0, 0, 5, 0, 0], [0, 0, 0, 0, 0], new Map(), new Set(["aff:grant:eldritch", "aff:req:eldritch"]));
  expect(html).toMatch(/class="affinity affinity-eldritch[^"]*vsel"/);
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd web && bun test test/sidebar-affinity.test.ts`
Expected: FAIL (row still emits `data-vid`, no `data-ids`/`data-gtoggle`).

- [ ] **Step 3: Make the row a color group-toggle**

In `web/src/adapters/sidebarView.ts`, REPLACE the row template (lines 206-208):

```ts
    const vid = affinityTagId("grant", a);
    const sel = selectedBenefits.has(vid) ? " vsel" : "";
    return `<div class="affinity affinity-${a}${flash}${sel}" data-vid="${vid}"><span>${affinityOrb(a)}${a}</span><span class="aff-have">${have[i]}</span>${needCell}</div>`;
```

with:

```ts
    // The row toggles the COLOR: both the grant and require tags, so filtering a color glows the
    // constellations that grant it AND the outer ones that require it. Reuses the group-toggle path
    // (data-gtoggle on the row, data-ids the two tags); selected when the grant tag is active.
    const grantId = affinityTagId("grant", a);
    const reqId = affinityTagId("req", a);
    const sel = selectedBenefits.has(grantId) ? " vsel" : "";
    return `<div class="affinity affinity-${a}${flash}${sel}" data-gkey="aff:${a}" data-gtoggle data-ids="${grantId},${reqId}"><span>${affinityOrb(a)}${a}</span><span class="aff-have">${have[i]}</span>${needCell}</div>`;
```

- [ ] **Step 4: Run to verify they pass**

Run: `cd web && bun test test/sidebar-affinity.test.ts`
Expected: PASS (the two existing tests, which use the defaulted `selectedBenefits`, still pass too).

- [ ] **Step 5: Update the e2e selectors**

In `web/e2e/smoke.ts`, the desktop affinity block dispatches a click on `.affinity[data-vid="aff:grant:eldritch"]` twice (toggle on, then off). Change BOTH selectors to `.affinity.affinity-eldritch` (the row no longer has `data-vid`):

```ts
`document.querySelector('.affinity.affinity-eldritch').dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true}))`
```

The surrounding assertions are unchanged: clicking still sets `b=` (now both tags), `.affinity-eldritch` still gains `vsel` (grant active), and `.star.aff-dim` / `.aff-glow` still go non-zero then back to zero on toggle off.

- [ ] **Step 6: Verify**

Run: `cd web && bunx tsc --noEmit` then `just e2e` then `just check`
Expected: tsc clean; `E2E PASS` (the desktop affinity checks pass with the new selector and both tags set); full gate green.

- [ ] **Step 7: Commit**

```bash
git add web/src/adapters/sidebarView.ts web/test/sidebar-affinity.test.ts web/e2e/smoke.ts
git commit -m "feat(ui): affinity panel filters by color (grant and require together)"
```

---

## Notes for the implementer

- The `affinityFilter` interface change (Task 3) is a coupled flip: `svgRenderer.ts` and `main.ts` change together, in one commit, so the build never sees a type mismatch. Do not split them.
- `matchedAffinities` (Task 2) is additive and keeps `constellationsMatchingAffinity` alive; Task 3 removes the old helper only after `main.ts` stops calling it.
- The glow `stdDeviation` (40 user units) and brightness (slope 1.4) are the tuning knobs; the feature owner expects to iterate on them after seeing it live. If the value is raised substantially, widen the `#aff-glow` filter region beyond `-100%/300%` so the larger blur is not clipped.
- A benefit `match` star must stay exempt from `aff-dim` (the `!isMatch &&` guard in the star's `ao`), the same invariant the hard fade enforced.
