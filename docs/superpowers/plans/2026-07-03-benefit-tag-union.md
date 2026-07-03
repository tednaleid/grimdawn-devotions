# Benefit-Tag Discriminated Union Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One core module owns the benefit-tag vocabulary (player, pet, affinity) as a discriminated union with a parse/format codec; the nine string-surgery sites use it; zero behavior change.

**Architecture:** New `web/src/core/benefitTag.ts` exports the `BenefitTag` union, `parseTag`/`formatTag`, and string builders `petTagId`/`affinityTagId` (the latter moves out of urlState). `Set<string>` stays the working representation; the union is used at semantic read sites and the builders at construction sites. The URL `b=` format and DOM `data-vid` strings are unchanged.

**Tech Stack:** TypeScript, Bun tests, biome, `just` targets. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-07-03-benefit-tag-union-design.md`

## Global Constraints

- Work on branch `benefit-tag-union` off `main`, in place (no worktree; single-session inline execution): `git checkout -b benefit-tag-union`.
- Pre-commit hook runs `just check` (format, full test suite, lint, typecheck); every commit is a full gate. NEVER use `--no-verify`.
- Zero behavior change: `web/test/urlState.test.ts` (canonical `b=` ordering) and the sidebar/tooltip tests must pass untouched, except where a signature they call changes (Task 4 notes the one case). The characterization snapshot must be untouched.
- Canonical string forms are FROZEN: `"<statId>"`, `"pet:<statId>"`, `"aff:<dir>:<affinity>"`.
- New files start with two `// ABOUTME:` lines. No emojis, no emdashes, no hyperbole.
- Commit messages: `refactor(tags): <what>` ending with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

---

### Task 1: The codec module

**Files:**
- Create: `web/src/core/benefitTag.ts`
- Test: `web/test/benefitTag.test.ts`

**Interfaces:**
- Produces (later tasks import these exact names from `../src/core/benefitTag` / `./benefitTag` / `../core/benefitTag`):
  - `type BenefitTag = { kind: "player"; statId: string } | { kind: "pet"; statId: string } | { kind: "affinity"; dir: "grant" | "req"; affinity: Affinity }`
  - `formatTag(tag: BenefitTag): string`
  - `parseTag(s: string): BenefitTag | null`
  - `petTagId(statId: string): string`
  - `affinityTagId(dir: "grant" | "req", a: Affinity): string`

- [ ] **Step 1: Write the failing test**

```ts
// ABOUTME: Tests the benefit-tag codec: union round-trips, canonical strings, malformed aff:* forms.
// ABOUTME: Round-trip property runs over every canonical benefit id from the real dataset.
import { expect, test, describe } from "bun:test";
import doc from "../../data/devotions.json";
import { buildModel, type DevotionsDoc } from "../src/core/model";
import { canonicalBenefitIds } from "../src/core/urlState";
import { parseTag, formatTag, petTagId, affinityTagId } from "../src/core/benefitTag";

describe("parseTag variants", () => {
  test("bare id is a player tag", () => {
    expect(parseTag("offensiveFireModifier")).toEqual({ kind: "player", statId: "offensiveFireModifier" });
  });
  test("pet: prefix is a pet tag", () => {
    expect(parseTag("pet:defensiveProtection")).toEqual({ kind: "pet", statId: "defensiveProtection" });
  });
  test("bare pet: parses as a pet tag with empty statId (matches the old slice(4))", () => {
    expect(parseTag("pet:")).toEqual({ kind: "pet", statId: "" });
  });
  test("aff:grant and aff:req parse with validated affinity", () => {
    expect(parseTag("aff:grant:eldritch")).toEqual({ kind: "affinity", dir: "grant", affinity: "eldritch" });
    expect(parseTag("aff:req:chaos")).toEqual({ kind: "affinity", dir: "req", affinity: "chaos" });
  });
  test("malformed aff:* forms parse to null", () => {
    expect(parseTag("aff:grant:banana")).toBeNull();
    expect(parseTag("aff:bogus")).toBeNull();
    expect(parseTag("aff:grant:")).toBeNull();
    expect(parseTag("aff:")).toBeNull();
  });
});

describe("formatTag and builders", () => {
  test("formatTag emits the canonical forms", () => {
    expect(formatTag({ kind: "player", statId: "x" })).toBe("x");
    expect(formatTag({ kind: "pet", statId: "x" })).toBe("pet:x");
    expect(formatTag({ kind: "affinity", dir: "req", affinity: "order" })).toBe("aff:req:order");
  });
  test("builders match formatTag", () => {
    expect(petTagId("x")).toBe("pet:x");
    expect(affinityTagId("grant", "primordial")).toBe("aff:grant:primordial");
  });
});

test("round-trip: every canonical benefit id parses and reformats identically", () => {
  const model = buildModel(doc as DevotionsDoc);
  for (const id of canonicalBenefitIds(model)) {
    const tag = parseTag(id);
    expect(tag).not.toBeNull();
    expect(formatTag(tag!)).toBe(id);
  }
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd web && bun test test/benefitTag.test.ts`
Expected: FAIL, module `../src/core/benefitTag` not found.

- [ ] **Step 3: Implement the module**

```ts
// ABOUTME: The benefit filter tag vocabulary as a discriminated union with one parse/format codec.
// ABOUTME: Canonical strings ("<id>", "pet:<id>", "aff:<dir>:<affinity>") are the wire/DOM/URL form.
import { AFFINITIES, type Affinity } from "./types";

export type BenefitTag =
  | { kind: "player"; statId: string }
  | { kind: "pet"; statId: string }
  | { kind: "affinity"; dir: "grant" | "req"; affinity: Affinity };

const isAffinity = (s: string): s is Affinity => (AFFINITIES as readonly string[]).includes(s);

/** The canonical string form of a tag (the shape stored in selectedBenefits, data-vid, and the URL bitset). */
export function formatTag(tag: BenefitTag): string {
  switch (tag.kind) {
    case "player":
      return tag.statId;
    case "pet":
      return `pet:${tag.statId}`;
    case "affinity":
      return `aff:${tag.dir}:${tag.affinity}`;
  }
}

/** Parse a canonical tag string. Bare ids are player tags, pet: anything is a pet tag; only a
 *  malformed aff:* form (unknown direction or affinity) returns null. */
export function parseTag(s: string): BenefitTag | null {
  if (s.startsWith("aff:")) {
    const rest = s.slice("aff:".length);
    const sep = rest.indexOf(":");
    if (sep < 0) return null;
    const dir = rest.slice(0, sep);
    const affinity = rest.slice(sep + 1);
    if (dir !== "grant" && dir !== "req") return null;
    if (!isAffinity(affinity)) return null;
    return { kind: "affinity", dir, affinity };
  }
  if (s.startsWith("pet:")) return { kind: "pet", statId: s.slice("pet:".length) };
  return { kind: "player", statId: s };
}

/** The pet-scoped tag id for a raw stat id. */
export function petTagId(statId: string): string {
  return formatTag({ kind: "pet", statId });
}

/** The affinity filter tag for a grant/require of one affinity, e.g. `aff:grant:eldritch`. */
export function affinityTagId(dir: "grant" | "req", a: Affinity): string {
  return formatTag({ kind: "affinity", dir, affinity: a });
}
```

- [ ] **Step 4: Run to verify pass**

Run: `cd web && bun test test/benefitTag.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add web/src/core/benefitTag.ts web/test/benefitTag.test.ts
git commit -m "refactor(tags): benefit-tag union and codec module

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

Note: `affinityTagId` now exists in BOTH benefitTag.ts and urlState.ts. That is intentional for this commit only; Task 2 deletes the urlState copy.

---

### Task 2: urlState and aggregate build tags through the codec

**Files:**
- Modify: `web/src/core/urlState.ts:45-68` (delete `affinityTagId`, import builders)
- Modify: `web/src/core/aggregate.ts:132`
- Modify: `web/src/adapters/tooltipView.ts:15`, `web/src/adapters/sidebarView.ts:8` (import path only)
- Test: existing `web/test/urlState.test.ts` (unchanged, the compatibility guard)

**Interfaces:**
- Consumes: `petTagId`, `affinityTagId` from Task 1.
- Produces: `urlState.ts` no longer exports `affinityTagId`; every importer uses `core/benefitTag`.

- [ ] **Step 1: Convert urlState.ts**

Delete the `affinityTagId` function (lines 45-48) and add the import. The converted region:

```ts
import { petTagId, affinityTagId } from "./benefitTag";

/** The 10 affinity filter tags (each affinity x grant/require), in a stable order. */
function canonicalAffinityIds(): string[] {
  return AFFINITIES.flatMap((a) => [affinityTagId("grant", a), affinityTagId("req", a)]);
}
```

and in `canonicalBenefitIds`, replace `` ...canonicalPetStatIds(model).map((id) => `pet:${id}`), `` with:

```ts
    ...canonicalPetStatIds(model).map(petTagId),
```

- [ ] **Step 2: Convert aggregate.ts**

In `availablePetKeys`, replace `` out.add(`pet:${k}`); `` with `out.add(petTagId(k));` and add `import { petTagId } from "./benefitTag";`.

- [ ] **Step 3: Update the two adapter imports**

In `tooltipView.ts` and `sidebarView.ts`, change `import { affinityTagId } from "../core/urlState";` to `import { affinityTagId } from "../core/benefitTag";`. No other change in this task.

- [ ] **Step 4: Run the guards**

Run: `cd web && bun test test/urlState.test.ts test/benefitTag.test.ts test/sidebar-affinity.test.ts && bunx tsc --noEmit`
Expected: PASS — canonical ordering identical, no dangling import.

- [ ] **Step 5: Commit**

```bash
git add web/src/core/urlState.ts web/src/core/aggregate.ts web/src/adapters/tooltipView.ts web/src/adapters/sidebarView.ts
git commit -m "refactor(tags): tag construction goes through the codec builders

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: main.ts parses with the union

**Files:**
- Modify: `web/src/app/main.ts:176-206` (`taggedStars`, `affinityFilterSets`)

**Interfaces:**
- Consumes: `parseTag` from Task 1.
- Produces: no signature changes; both functions keep their exact return types.

- [ ] **Step 1: Convert both functions**

Add `import { parseTag } from "../core/benefitTag";` and replace the two bodies:

```ts
  // The map stars to emphasize for the current benefit tags: player tags scan player bonuses,
  // pet tags scan pet bonuses; affinity tags are constellation-level (see affinityFilterSets).
  function taggedStars(): Set<StarId> {
    const playerTags = new Set<string>();
    const petTags = new Set<string>();
    for (const k of selectedBenefits) {
      const tag = parseTag(k);
      if (tag?.kind === "player") playerTags.add(tag.statId);
      else if (tag?.kind === "pet") petTags.add(tag.statId);
    }
    const out = starsGranting(model, playerTags);
    for (const id of starsGrantingPet(model, petTags)) out.add(id);
    return out;
  }

  // The active affinity filter as grant/require sets, or undefined when no affinity tag is selected.
  // The renderer matches each constellation against these (matchedAffinities) to glow it or mild-fade it.
  function affinityFilterSets(): { grants: Set<Affinity>; requires: Set<Affinity> } | undefined {
    const grants = new Set<Affinity>();
    const requires = new Set<Affinity>();
    for (const k of selectedBenefits) {
      const tag = parseTag(k);
      if (tag?.kind !== "affinity") continue;
      (tag.dir === "grant" ? grants : requires).add(tag.affinity);
    }
    if (grants.size === 0 && requires.size === 0) return undefined;
    return { grants, requires };
  }
```

The `as Affinity` casts are gone; a malformed `aff:*` string now parses to null and is skipped in both functions (previously `taggedStars` skipped it and `affinityFilterSets` would have admitted it unvalidated).

- [ ] **Step 2: Run the guards**

Run: `cd web && bunx tsc --noEmit && bun test test/i18nCharacterization.test.ts`
Expected: PASS (main.ts has no unit tests; typecheck plus the full-suite commit hook are the gate).

- [ ] **Step 3: Commit**

```bash
git add web/src/app/main.ts
git commit -m "refactor(tags): main.ts reads tags through parseTag, drops the Affinity cast

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: sidebarView and tooltipView stop building prefix strings

**Files:**
- Modify: `web/src/adapters/sidebarView.ts:125,139` (two closures)
- Modify: `web/src/adapters/tooltipView.ts:48-58,81` (`bonusRowsHtml` scope param, `petBonusHtml` call)
- Test: existing `web/test/sidebar-benefits.test.ts`, `web/test/tooltip-weapon-req.test.ts`, `web/test/tooltip-filter.test.ts`

**Interfaces:**
- Consumes: `petTagId` from Task 1.
- Produces: `bonusRowsHtml(loc, bonuses, selectedBenefits, keyOf: (id: string) => string, racialTarget?)` (was `scope: string`). Internal to tooltipView; no exported signature changes.

- [ ] **Step 1: Convert sidebarView's closures**

Add `petTagId` to the benefitTag import. Replace `const pet = makeScope((id) => \`pet:${id}\`, petCatalog);` with `const pet = makeScope(petTagId, petCatalog);` and the `benefitListHtml(...petActiveHtml...)` call's `(id) => \`pet:${id}\`` with `petTagId`. Note for the reader: `makeScope`'s `gkey` also routes the SUBJECT key through the same function (producing `pet:<group>:<subjectKey>` for `data-gkey`), which `petTagId` reproduces byte-for-byte; that string is an ephemeral DOM grouping key, not a stat tag, and is unchanged.

- [ ] **Step 2: Convert tooltipView's scope parameter**

In `bonusRowsHtml`, change the parameter `scope: string` to `keyOf: (id: string) => string`, and the vid construction from `` const vid = `${scope}${r.id}`; `` to `const vid = keyOf(r.id);`. Update the two callers: player call sites pass `(id) => id` (was `""`), and `petBonusHtml` passes `petTagId` (was `"pet:"`). Add `petTagId` to the benefitTag import. Update the comment above `bonusRowsHtml` ("`scope` is ..." becomes "keyOf maps a raw stat id to its tag key: identity for player rows, petTagId for pet rows").

- [ ] **Step 3: Run the guards**

Run: `cd web && bun test test/sidebar-benefits.test.ts test/tooltip-weapon-req.test.ts test/tooltip-filter.test.ts test/i18nCharacterization.test.ts && bunx tsc --noEmit`
Expected: PASS — rendered `data-vid`/`data-gkey` strings identical.

- [ ] **Step 4: Verify no string surgery remains**

Run: `grep -rn '\`pet:\|"pet:"\|startsWith("pet\|startsWith("aff\|aff:grant:\|aff:req:' web/src --include="*.ts" | grep -v benefitTag.ts`
Expected: no output (the vocabulary lives only in benefitTag.ts).

- [ ] **Step 5: Commit**

```bash
git add web/src/adapters/sidebarView.ts web/src/adapters/tooltipView.ts
git commit -m "refactor(tags): adapters build tag keys through petTagId, keyOf replaces scope prefix

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: Full gate and finish

**Files:**
- No source changes.

- [ ] **Step 1: Full check**

Run: `just check`
Expected: all pass (format, full suite including both characterization snapshots, lint, typecheck).

- [ ] **Step 2: Diff review**

Run: `git diff main...HEAD --stat`
Expected: benefitTag.ts + test added; urlState, aggregate, main.ts, sidebarView, tooltipView touched; NOTHING else (no snapshot, no catalog files).

- [ ] **Step 3: Finish the branch**

Use the superpowers:finishing-a-development-branch flow: merge `benefit-tag-union` into `main`, verify `just check` on main, delete the branch. Push only if Ted asks.

## Self-Review Notes

- Spec coverage: module + codec rules (Task 1), all nine sites (Tasks 2-4 cover urlState x2, aggregate, main.ts x2, sidebarView x2, tooltipView x2 including the scope param), round-trip + malformed tests (Task 1), URL compatibility via untouched urlState.test.ts (Task 2), no-surgery grep sweep (Task 4).
- Type consistency: `parseTag(s): BenefitTag | null`, builders return `string`, `keyOf: (id: string) => string` used identically in Tasks 1 and 4.
- Behavior note called out where it exists: affinityFilterSets previously admitted unvalidated affinity strings after the cast; garbage was unreachable via the URL decoder, so observable behavior is unchanged.
