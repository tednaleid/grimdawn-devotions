# Conditional Bonus Qualifiers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface a devotion star's conditional weapon requirement (e.g. Kraken's two-handed requirement) on hover, in both the star and constellation tooltips, so a bonus like "+120% Total Damage" no longer reads as unconditional.

**Architecture:** Display-only change plus one model-layer fix. The qualifier data already reaches `data/devotions.json` and the model, but the model drops the human-readable `description`. Carry it through, then render it: verbatim on the star tooltip, and aggregated/deduped as a "Some bonuses require ..." line on the constellation tooltip.

**Tech Stack:** TypeScript, Bun test runner, vanilla DOM adapters. Reference: `docs/superpowers/specs/2026-06-24-conditional-bonus-qualifiers-design.md`.

## Global Constraints

- Run tests and checks through `just`, never raw `bun test`. `just test <path>` runs a single file (path is relative to `web/`); `just check` is the full gate and also runs on every commit via the pre-commit hook.
- New code files start with two `// ABOUTME: ` comment lines.
- No emojis, emdashes, or hyperbole in code or docs.
- Styling for the qualifier is neutral (`#d7c89a`, the existing `.tip-bonus` color), never the `#e0696a` red used for unmet affinities. The planner has no character context, so this is informational, not a warning.
- No URL-state, parser, or dataset changes. Star ids are `${constellationId}:${index}` (e.g. `kraken:0`).

---

### Task 1: Carry the requirement description through the model

**Files:**
- Modify: `web/src/core/types.ts:39` (widen `Star.weaponRequirement`)
- Modify: `web/src/core/model.ts:23` (widen `RawStar.weapon_requirement`) and `web/src/core/model.ts:72` (map the field)
- Test: `web/test/model.test.ts` (append one test)

**Interfaces:**
- Produces: `Star.weaponRequirement` is now `{ weapons: string[]; description: string | null } | null`. Tasks 2-4 read `.description`.

- [ ] **Step 1: Write the failing test**

Append to `web/test/model.test.ts` (`model` and `doc` are already imported there):

```ts
test("carries a star's weapon-requirement description through the model", () => {
  expect(model.stars.get("kraken:0")?.weaponRequirement?.description).toBe(
    "Requires a two-handed melee or two-handed ranged weapon.",
  );
  // an ungated star has no requirement at all
  expect(model.stars.get("anvil:0")?.weaponRequirement).toBeNull();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `just test test/model.test.ts`
Expected: FAIL — the new test's first assertion gets `undefined` (the model currently keeps only `{ weapons }`), so `toBe("Requires...")` fails. Existing tests still pass.

- [ ] **Step 3: Write minimal implementation**

In `web/src/core/types.ts`, widen line 39 from:

```ts
  weaponRequirement: { weapons: string[] } | null;
```

to:

```ts
  weaponRequirement: { weapons: string[]; description: string | null } | null;
```

In `web/src/core/model.ts`, widen the `RawStar` field at line 23 from:

```ts
  weapon_requirement: { weapons: string[] } | null;
```

to:

```ts
  weapon_requirement: { weapons: string[]; description?: string | null } | null;
```

In `web/src/core/model.ts`, change the mapping at line 72 from:

```ts
        weaponRequirement: s.weapon_requirement ? { weapons: s.weapon_requirement.weapons } : null,
```

to:

```ts
        weaponRequirement: s.weapon_requirement
          ? { weapons: s.weapon_requirement.weapons, description: s.weapon_requirement.description ?? null }
          : null,
```

- [ ] **Step 4: Run test to verify it passes**

Run: `just test test/model.test.ts`
Expected: PASS (all tests in the file).

- [ ] **Step 5: Commit**

```bash
git add web/src/core/types.ts web/src/core/model.ts web/test/model.test.ts
git commit -m "feat(model): carry weapon_requirement description through the model"
```

---

### Task 2: Return the description from `weaponRequirements()`

**Files:**
- Modify: `web/src/core/aggregate.ts:122-132` (`weaponRequirements`)
- Test: `web/test/aggregate.test.ts` (append one test)

**Interfaces:**
- Consumes: `Star.weaponRequirement.description` from Task 1.
- Produces: `weaponRequirements(model, selected)` returns `{ starId: StarId; weapons: string[]; description: string | null }[]`. Task 4 reads `.description`.

- [ ] **Step 1: Write the failing test**

Append to `web/test/aggregate.test.ts` (`weaponRequirements`, `model` are already imported there):

```ts
test("weaponRequirements carries each gated star's description", () => {
  const reqs = weaponRequirements(model, new Set(["kraken:0"]));
  expect(reqs).toHaveLength(1);
  expect(reqs[0]!.description).toBe("Requires a two-handed melee or two-handed ranged weapon.");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `just test test/aggregate.test.ts`
Expected: FAIL — `reqs[0].description` is `undefined` today (the helper returns only `starId` + `weapons`), so `toBe("Requires...")` fails.

- [ ] **Step 3: Write minimal implementation**

In `web/src/core/aggregate.ts`, replace `weaponRequirements` (lines 122-132) with:

```ts
export function weaponRequirements(
  model: DevotionModel,
  selected: Set<StarId>,
): { starId: StarId; weapons: string[]; description: string | null }[] {
  const out: { starId: StarId; weapons: string[]; description: string | null }[] = [];
  for (const id of selected) {
    const star = model.stars.get(id);
    if (star?.weaponRequirement)
      out.push({
        starId: id,
        weapons: star.weaponRequirement.weapons,
        description: star.weaponRequirement.description,
      });
  }
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `just test test/aggregate.test.ts`
Expected: PASS (all tests in the file).

- [ ] **Step 5: Commit**

```bash
git add web/src/core/aggregate.ts web/test/aggregate.test.ts
git commit -m "feat(aggregate): weaponRequirements returns the requirement description"
```

---

### Task 3: Render the qualifier on the star tooltip (+ style)

**Files:**
- Modify: `web/src/adapters/tooltipView.ts` (add `weaponReqHtml` helper near line 39; render it in `show` at line 108)
- Modify: `web/src/styles.css` (add `.tip-weapon-req` near `.tip-req`, line 580)
- Test: `web/test/tooltip-weapon-req.test.ts` (new)

**Interfaces:**
- Consumes: `Star.weaponRequirement.description` from Task 1.
- Produces: `weaponReqHtml(description: string | null | undefined): string` in `tooltipView.ts`, reused by Task 4.

- [ ] **Step 1: Write the failing test**

Create `web/test/tooltip-weapon-req.test.ts`:

```ts
// ABOUTME: The conditional weapon-requirement qualifier shows on the star tooltip (and constellation
// ABOUTME: tooltip, Task 4), and is absent for ungated stars/constellations. Mirrors tooltip-dim.test.ts.
import { test, expect, beforeEach } from "bun:test";
import doc from "../../data/devotions.json";
import { buildModel } from "../src/core/model";
import { tooltipView } from "../src/adapters/tooltipView";

const model = buildModel(doc as any);

beforeEach(() => {
  global.window = { innerWidth: 1024, innerHeight: 768 } as any;
});

function render(fn: (tip: ReturnType<typeof tooltipView>) => void): string {
  const el = { style: {}, innerHTML: "", offsetWidth: 0, offsetHeight: 0 } as any as HTMLElement;
  fn(tooltipView(el));
  return (el as any).innerHTML as string;
}

test("star tooltip shows the weapon-requirement description for a gated star", () => {
  const html = render((tip) => tip.show(model, "kraken:0", 0, 0));
  expect(html).toContain("tip-weapon-req");
  expect(html).toContain("Requires a two-handed melee or two-handed ranged weapon.");
});

test("star tooltip omits the qualifier for an ungated star", () => {
  const html = render((tip) => tip.show(model, "anvil:0", 0, 0));
  expect(html).not.toContain("tip-weapon-req");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `just test test/tooltip-weapon-req.test.ts`
Expected: FAIL — the gated-star test fails (`tip-weapon-req` not in the HTML; nothing renders the requirement yet). The ungated-star test passes.

- [ ] **Step 3: Write minimal implementation**

In `web/src/adapters/tooltipView.ts`, add this helper right after `bonusRowsHtml` (after line 39):

```ts
// A star's conditional qualifier (e.g. Kraken's two-handed weapon requirement), shown verbatim
// under its bonuses. Empty when the star has no requirement or no description text.
function weaponReqHtml(description: string | null | undefined): string {
  return description ? `<div class="tip-weapon-req">${description}</div>` : "";
}
```

In the `show` method, change the `el.innerHTML` assignment (line 108) from:

```ts
      el.innerHTML = `<strong>${con.name}</strong>${power}${bonusRowsHtml(star.bonuses, star.racialTarget)}${petBonusHtml(star.petBonuses)}${affinitySections(con, totals)}`;
```

to insert the requirement after the bonus rows:

```ts
      el.innerHTML = `<strong>${con.name}</strong>${power}${bonusRowsHtml(star.bonuses, star.racialTarget)}${weaponReqHtml(star.weaponRequirement?.description)}${petBonusHtml(star.petBonuses)}${affinitySections(con, totals)}`;
```

In `web/src/styles.css`, add after the `.tip-req` block (after line 583):

```css
.tip-weapon-req {
  margin-top: 0.35rem;
  color: #d7c89a;
  font-style: italic;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `just test test/tooltip-weapon-req.test.ts`
Expected: PASS (both tests).

- [ ] **Step 5: Commit**

```bash
git add web/src/adapters/tooltipView.ts web/src/styles.css web/test/tooltip-weapon-req.test.ts
git commit -m "feat(tooltip): show weapon-requirement qualifier on the star tooltip"
```

---

### Task 4: Render the aggregated qualifier on the constellation tooltip

**Files:**
- Modify: `web/src/adapters/tooltipView.ts` (import `weaponRequirements`; build a deduped line in `showConstellation` at line 133)
- Test: `web/test/tooltip-weapon-req.test.ts` (append two tests)

**Interfaces:**
- Consumes: `weaponRequirements(model, selected)` from Task 2; `weaponReqHtml` is not reused here because the constellation line uses the "Some bonuses require ..." phrasing.

- [ ] **Step 1: Write the failing test**

Append to `web/test/tooltip-weapon-req.test.ts`:

```ts
test("constellation tooltip shows one deduped 'Some bonuses require' line", () => {
  const html = render((tip) => tip.showConstellation(model, "kraken", 0, 0));
  expect(html).toContain("Some bonuses require a two-handed melee or two-handed ranged weapon.");
  // Kraken's stars share one description, so it collapses to a single line.
  expect(html.match(/tip-weapon-req/g)?.length).toBe(1);
});

test("constellation tooltip omits the qualifier when no star is gated", () => {
  const html = render((tip) => tip.showConstellation(model, "anvil", 0, 0));
  expect(html).not.toContain("tip-weapon-req");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `just test test/tooltip-weapon-req.test.ts`
Expected: FAIL — the Kraken constellation test fails (no "Some bonuses require" line yet). The other three tests pass.

- [ ] **Step 3: Write minimal implementation**

In `web/src/adapters/tooltipView.ts`, add `weaponRequirements` to the existing `../core/aggregate` import (line 13):

```ts
import { sumBonuses, sumPetBonuses, powersGained, racialTargets, weaponRequirements } from "../core/aggregate";
```

In `showConstellation`, just before the `el.innerHTML` assignment (line 133), build the deduped line. Each description in the data begins with "Requires ", so strip that prefix and lead with "Some bonuses require " for a natural, honest reading when only some stars are gated:

```ts
      const weaponReq = [
        ...new Set(
          weaponRequirements(model, stars)
            .map((r) => r.description)
            .filter((d): d is string => !!d),
        ),
      ]
        .map((d) => `<div class="tip-weapon-req">Some bonuses require ${d.replace(/^Requires\s+/i, "")}</div>`)
        .join("");
```

Then change the `el.innerHTML` assignment (line 133) from:

```ts
      el.innerHTML = `${head}${powers}${bonusRowsHtml(sumBonuses(model, stars), racialTargets(model, stars))}${petBonusHtml(sumPetBonuses(model, stars))}${affinitySections(con, totals)}${dimLine}`;
```

to insert `weaponReq` after the bonus rows:

```ts
      el.innerHTML = `${head}${powers}${bonusRowsHtml(sumBonuses(model, stars), racialTargets(model, stars))}${weaponReq}${petBonusHtml(sumPetBonuses(model, stars))}${affinitySections(con, totals)}${dimLine}`;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `just test test/tooltip-weapon-req.test.ts`
Expected: PASS (all four tests).

- [ ] **Step 5: Run the full gate, then commit**

Run: `just check`
Expected: PASS (format, full test suite, lint, typecheck). This also runs automatically on the commit hook.

```bash
git add web/src/adapters/tooltipView.ts web/test/tooltip-weapon-req.test.ts
git commit -m "feat(tooltip): show aggregated weapon-requirement line on the constellation tooltip"
```

---

## Manual verification (after Task 4)

Optional visual confirmation: `just serve`, open http://localhost:5173, hover a Kraken star (expect the italic "Requires a two-handed melee or two-handed ranged weapon." line under its bonuses) and hover the Kraken constellation glyph (expect a single "Some bonuses require a two-handed melee or two-handed ranged weapon." line). Hover any ungated constellation (e.g. Anvil) and confirm no qualifier appears.

## Self-review notes

- Spec coverage: model description (Task 1), aggregate helper (Task 2), star tooltip + style (Task 3), constellation tooltip aggregation/dedup (Task 4), tests for all (Tasks 1-4). Benefits sidebar intentionally untouched per spec decision 2.
- The constellation phrasing strips a leading "Requires " and leads with "Some bonuses require " — every description in the dataset begins with "Requires ", and if one did not, the line degrades to slightly redundant but still correct text, never broken markup.
- Star tooltip shows the description verbatim (decision 5); constellation dedupes by exact text (decision 4).
