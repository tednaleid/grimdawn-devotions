# i18n Hexagonal Boundary Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Core formatting returns locale-independent `Text` descriptors resolved by adapters through the `Localization` port; the module singleton and `buildCatalogs()` are deleted.

**Architecture:** A closed `Text` union (`app | game | gameStripped | lit | join`) plus a pure `resolveText(loc, t)` live beside the port in `core/localization.ts`. Core modules are converted bottom-up (commitAction, then statFormat family by family, then benefitRows) while a temporary `resolveTextGlobal` shim keeps unconverted adapters green; adapters then take `loc` and resolve at render, and the singleton dies last. A characterization snapshot (en + zh) written before any refactor is the merge gate.

**Tech Stack:** TypeScript, Bun (`bun test`, `toMatchSnapshot`), biome, `just` targets. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-07-02-i18n-hexagonal-boundary-design.md`

## Global Constraints

- All work on branch `i18n-hexagonal-boundary` in a worktree (create via superpowers:using-git-worktrees at execution start).
- The pre-commit hook runs `just check` (format check, full `bun test`, lint, typecheck). Every commit is therefore a full green gate; NEVER use `--no-verify`.
- The characterization snapshot written in Task 1 must never be regenerated after Task 1. If a later task fails the snapshot, the task is wrong, not the snapshot.
- The singleton (`setLocalization` / global `translate` / `gameText`) stays alive until Task 9. Converted core modules must not call it; unconverted callers bridge with `resolveTextGlobal`.
- New files start with two `// ABOUTME:` comment lines. No emojis, no emdashes, no hyperbole in docs or comments.
- Match surrounding code style; `just fmt` before committing if unsure.
- Run tests from the repo root with `just test <file>` (it cds into `web/`), or `cd web && bun test <file>`.
- Commit messages: `refactor(i18n): <what>` (or `test(i18n):` for test-only tasks), ending with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

---

### Task 1: Characterization snapshot (before any refactor)

**Files:**
- Create: `web/test/i18nCharacterization.test.ts`
- Generated: `web/test/__snapshots__/i18nCharacterization.test.ts.snap` (committed)

**Interfaces:**
- Consumes: current string-returning `statFormat` / `benefitRows` APIs and the singleton.
- Produces: the frozen snapshot every later task must reproduce, and a `collectSurfaces(loc)` harness whose internals later tasks update (its output shape and the snapshot never change).

- [ ] **Step 1: Write the harness test**

```ts
// ABOUTME: Characterization snapshot for the i18n hexagonal boundary refactor: resolves every core
// ABOUTME: text surface for a representative selection under en and zh; output must never change.
import { expect, test } from "bun:test";
import devotions from "../../data/devotions.json";
import appEn from "../src/i18n/app.en.json";
import appZh from "../src/i18n/app.zh.json";
import gameEn from "../../data/i18n/game.en.json";
import gameZh from "../../data/i18n/game.zh.json";
import { buildModel, type DevotionsDoc } from "../src/core/model";
import { makeLocalization, setLocalization } from "../src/core/localization";
import type { Localization } from "../src/ports/Localization";
import { formatBonusRowsWithIds, formatPowerStats, formatPet, condensedRows } from "../src/core/statFormat";
import { benefitRows } from "../src/core/benefitRows";
import { commitButton } from "../src/core/commitAction";
import { sumBonuses, sumPetBonuses, racialTargets } from "../src/core/aggregate";
import { buildOrderHtml } from "../src/adapters/buildOrderView";
import type { StarId } from "../src/core/types";

const model = buildModel(devotions as DevotionsDoc);

// Constellations chosen to touch every formatting path: power with durations/CC
// (akeron_s_scorpion), max-resist (abomination), weapon requirement (berserker),
// pet summon power (bysmiel_s_bonds), pet bonuses (crane), racial target (gallows).
const CONS = ["akeron_s_scorpion", "abomination", "berserker", "bysmiel_s_bonds", "crane", "gallows"];
const selection = new Set<StarId>(CONS.flatMap((c) => model.constellations.get(c)!.starIds));
const baseline = new Set<StarId>(model.constellations.get("crane")!.starIds);

const enLoc = makeLocalization(appEn, appEn, "en", gameEn, gameEn);
const zhLoc = makeLocalization(appZh as Record<string, string>, appEn, "zh", gameZh as Record<string, string>, gameEn);

// commitButton only reads clickable/completable from ReachView; a minimal stand-in avoids the engine.
function partialReach(completable: Set<string>) {
  return { completable, clickable: new Set<string>(), have: [0, 0, 0, 0, 0], need: [0, 0, 0, 0, 0], needSource: new Map() } as import("../src/core/reachability").ReachView;
}

// Resolves every core text surface to plain strings. Stage 1: formatters read the
// singleton, so install loc first. Later tasks change HOW this resolves (resolveText
// over descriptors), never WHAT it returns.
function collectSurfaces(loc: Localization): unknown {
  setLocalization(loc);
  const racial = racialTargets(model, selection);
  const perStar: Record<string, unknown> = {};
  for (const sid of selection) {
    const star = model.stars.get(sid)!;
    const entry: Record<string, unknown> = {
      bonuses: formatBonusRowsWithIds(star.bonuses, { racialTarget: star.racialTarget }),
    };
    if (star.celestialPower) {
      entry.power = formatPowerStats(star.celestialPower.stats);
      if (star.celestialPower.pet) entry.pet = formatPet(star.celestialPower.pet);
    }
    perStar[sid] = entry;
  }
  return {
    condensed: condensedRows(sumBonuses(model, selection), { racialTarget: racial }),
    condensedPet: condensedRows(sumPetBonuses(model, selection)),
    benefitRowsRegular: benefitRows(model, selection, null),
    benefitRowsCompare: benefitRows(model, selection, baseline),
    perStar,
    commit: [
      commitButton(model, selection, partialReach(new Set(CONS)), { kind: "constellation", id: "crane" }),
      commitButton(model, new Set(), partialReach(new Set()), { kind: "constellation", id: "crane" }),
    ],
    buildOrder: buildOrderHtml(model, null, [
      { kind: "scaffold-add", conId: "crossroads_order", points: 1, heldAfter: 1 },
      { kind: "complete", conId: "crane", points: 6, heldAfter: 7 },
      { kind: "scaffold-refund", conId: "crossroads_order", points: -1, heldAfter: 6 },
    ]),
    buildOrderEmpty: buildOrderHtml(model, null, null, { kind: "incomplete", deficit: [3, 0, 0, 1, 0] }),
  };
}

test("characterization: en surfaces are stable", () => {
  expect(JSON.parse(JSON.stringify(collectSurfaces(enLoc)))).toMatchSnapshot();
});
test("characterization: zh surfaces are stable", () => {
  expect(JSON.parse(JSON.stringify(collectSurfaces(zhLoc)))).toMatchSnapshot();
});
```

Note: `JSON.parse(JSON.stringify(...))` normalizes to plain JSON so the snapshot cannot depend on class/undefined quirks.

- [ ] **Step 2: Run to generate the snapshot**

Run: `cd web && bun test test/i18nCharacterization.test.ts`
Expected: 2 pass, snapshot file written with 2 entries.

- [ ] **Step 3: Eyeball the snapshot**

Open `web/test/__snapshots__/i18nCharacterization.test.ts.snap`. Verify the en entry contains recognizable rows (for example a `Cunning` label from gallows, a `Maximum` or max-resist row from abomination, a `Summons` pet line from bysmiel_s_bonds) and the zh entry contains CJK text. If any surface is empty, fix the harness before committing.

- [ ] **Step 4: Run the full suite to prove no interference**

Run: `cd web && bun test`
Expected: all pass (335 or more tests, 0 fail).

- [ ] **Step 5: Commit (snapshot included)**

```bash
git add web/test/i18nCharacterization.test.ts web/test/__snapshots__/i18nCharacterization.test.ts.snap
git commit -m "test(i18n): characterization snapshot of all core text surfaces (en + zh)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: `Text` descriptor, `resolveText`, `sortByResolved`, constructors

**Files:**
- Modify: `web/src/core/localization.ts`
- Modify: `web/src/core/statFormat.ts` (move `stripValueTokens` out, import it back)
- Create: `web/test/text.test.ts`
- Modify: `web/test/helpers/localizeEn.ts` (export `enLoc`)

**Interfaces:**
- Produces (used by every later task):
  - `type Text = {k:"app";key:string;params?:Record<string,string|number|Text>} | {k:"game";tag:string} | {k:"gameStripped";tag:string} | {k:"lit";s:string} | {k:"join";parts:Text[]}`
  - `appT(key: string, params?: Record<string, string | number | Text>): Text`
  - `gameT(tag: string): Text`, `gameStrippedT(tag: string): Text`, `litT(s: string | number): Text`, `joinT(...parts: (Text | string)[]): Text`
  - `resolveText(loc: Localization, t: Text): string`
  - `sortByResolved<T>(loc: Localization, items: T[], labelOf: (x: T) => Text): T[]` (non-mutating, localeCompare order)
  - `resolveTextGlobal(t: Text): string` (TEMPORARY shim, deleted in Task 9)
  - `stripValueTokens(s: string): string` (moved here from statFormat)
  - `enLoc: Localization` from the test helper.

- [ ] **Step 1: Write the failing tests**

Create `web/test/text.test.ts`:

```ts
// ABOUTME: Tests for the Text descriptor union and resolveText/sortByResolved.
// ABOUTME: Pure port-based resolution; no singleton involved.
import { expect, test } from "bun:test";
import {
  appT,
  gameT,
  gameStrippedT,
  litT,
  joinT,
  resolveText,
  sortByResolved,
  makeLocalization,
} from "../src/core/localization";

const loc = makeLocalization(
  { "ui.hello": "Hola {name}", "ui.plain": "Plano" },
  { "ui.hello": "Hello {name}", "ui.only.en": "Only English" },
  "es",
  { tagFire: "Fuego", tagFmt: "{%.0f0}% Reducido" },
  { tagFire: "Fire" },
);

test("lit resolves to itself; numbers stringify", () => {
  expect(resolveText(loc, litT("+5%"))).toBe("+5%");
  expect(resolveText(loc, litT(7))).toBe("7");
});
test("app resolves active locale, falls back to English, then raw key", () => {
  expect(resolveText(loc, appT("ui.plain"))).toBe("Plano");
  expect(resolveText(loc, appT("ui.only.en"))).toBe("Only English");
  expect(resolveText(loc, appT("ui.missing"))).toBe("ui.missing");
});
test("app params interpolate, including nested Text params", () => {
  expect(resolveText(loc, appT("ui.hello", { name: "Ted" }))).toBe("Hola Ted");
  expect(resolveText(loc, appT("ui.hello", { name: gameT("tagFire") }))).toBe("Hola Fuego");
});
test("game resolves game text with fallback", () => {
  expect(resolveText(loc, gameT("tagFire"))).toBe("Fuego");
  expect(resolveText(loc, gameT("tagMissing"))).toBe("tagMissing");
});
test("gameStripped strips value tokens", () => {
  expect(resolveText(loc, gameStrippedT("tagFmt"))).toBe("Reducido");
});
test("join concatenates parts, string sugar becomes lit", () => {
  expect(resolveText(loc, joinT(gameT("tagFire"), " ", litT("x")))).toBe("Fuego x");
});
test("sortByResolved orders by resolved label without mutating", () => {
  const items = [{ l: litT("b") }, { l: litT("a") }];
  const sorted = sortByResolved(loc, items, (x) => x.l);
  expect(sorted.map((x) => resolveText(loc, x.l))).toEqual(["a", "b"]);
  expect(resolveText(loc, items[0]!.l)).toBe("b");
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd web && bun test test/text.test.ts`
Expected: FAIL, `appT` (and others) not exported.

- [ ] **Step 3: Implement in `core/localization.ts`**

Move `stripValueTokens` from `statFormat.ts` into `localization.ts` verbatim (keep its comment), export it, and change `statFormat.ts` to `import { stripValueTokens } from "./localization"`. Then add below `makeLocalization`:

```ts
// --- Text descriptors: locale-independent display text, resolved through the port ---
// Core formatting returns these instead of resolved strings, so core output can be
// cached across locale switches and never bakes in a language.
export type Text =
  | { k: "app"; key: string; params?: Record<string, string | number | Text> }
  | { k: "game"; tag: string }
  | { k: "gameStripped"; tag: string } // stripValueTokens(gameText(tag)): value-embedded format tags
  | { k: "lit"; s: string }
  | { k: "join"; parts: Text[] };

export const appT = (key: string, params?: Record<string, string | number | Text>): Text =>
  params ? { k: "app", key, params } : { k: "app", key };
export const gameT = (tag: string): Text => ({ k: "game", tag });
export const gameStrippedT = (tag: string): Text => ({ k: "gameStripped", tag });
export const litT = (s: string | number): Text => ({ k: "lit", s: String(s) });
export const joinT = (...parts: (Text | string)[]): Text => ({
  k: "join",
  parts: parts.map((p) => (typeof p === "string" ? litT(p) : p)),
});

export function resolveText(loc: Localization, t: Text): string {
  switch (t.k) {
    case "app": {
      if (!t.params) return loc.translate(t.key);
      const params: Record<string, string | number> = {};
      for (const [k, v] of Object.entries(t.params))
        params[k] = typeof v === "object" ? resolveText(loc, v) : v;
      return loc.translate(t.key, params);
    }
    case "game":
      return loc.gameText(t.tag);
    case "gameStripped":
      return stripValueTokens(loc.gameText(t.tag));
    case "lit":
      return t.s;
    case "join":
      return t.parts.map((p) => resolveText(loc, p)).join("");
  }
}

/** Sort by resolved label in the locale's collation order (non-mutating). */
export function sortByResolved<T>(loc: Localization, items: T[], labelOf: (x: T) => Text): T[] {
  return [...items].sort((a, b) => resolveText(loc, labelOf(a)).localeCompare(resolveText(loc, labelOf(b))));
}

// TEMPORARY migration shim: resolve via the module singleton so unconverted adapters keep
// working while core converts underneath them. Deleted with the singleton (see the
// i18n-hexagonal-boundary spec); nothing new may call this.
const RAW_LOC: Localization = makeLocalization({}, {}, "en");
export function resolveTextGlobal(t: Text): string {
  return resolveText(current ?? RAW_LOC, t);
}
```

- [ ] **Step 4: Run tests**

Run: `cd web && bun test test/text.test.ts test/statFormat.test.ts test/i18nCharacterization.test.ts`
Expected: PASS (statFormat behavior unchanged by the stripValueTokens move).

- [ ] **Step 5: Add `enLoc` export to the test helper**

In `web/test/helpers/localizeEn.ts`, build the instance once, export it, and keep `installEnglish` delegating to it:

```ts
export const enLoc = makeLocalization(
  en as Record<string, string>,
  en as Record<string, string>,
  "en",
  gameEn as Record<string, string>,
  gameEn as Record<string, string>,
);

export function installEnglish(): void {
  setLocalization(enLoc);
}
```

- [ ] **Step 6: Full suite, then commit**

Run: `cd web && bun test`
Expected: all pass.

```bash
git add web/src/core/localization.ts web/src/core/statFormat.ts web/test/text.test.ts web/test/helpers/localizeEn.ts
git commit -m "refactor(i18n): add Text descriptors, resolveText, sortByResolved, migration shim

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: Convert `commitAction` (proves the pattern end to end)

**Files:**
- Modify: `web/src/core/commitAction.ts`
- Modify: `web/src/app/main.ts` (bridge at the two call sites)
- Test: `web/test/commit-action.test.ts`

**Interfaces:**
- Produces: `CommitButton { label: Text; enabled: boolean }` (was `label: string`).
- Consumes: `appT` from Task 2.
- Bridge: `main.ts` resolves the label before handing it to the (still string-based) tooltip: `{ label: resolveTextGlobal(btn.label), enabled: btn.enabled }`. Task 8 removes this bridge.

- [ ] **Step 1: Update the test to assert descriptors**

In `web/test/commit-action.test.ts`, replace string-label assertions. Pattern (apply to every case in the file):

```ts
// before
expect(commitButton(model, sel, reach, t)).toEqual({ label: "Add", enabled: true });
// after
import { appT } from "../src/core/localization";
expect(commitButton(model, sel, reach, t)).toEqual({ label: appT("ui.commit.add"), enabled: true });
```

Remove/replace `installEnglish()` if it is only there for commit labels (keep it if other assertions need it).

- [ ] **Step 2: Run to verify failure**

Run: `cd web && bun test test/commit-action.test.ts`
Expected: FAIL (labels are still resolved strings).

- [ ] **Step 3: Convert `commitAction.ts`**

```ts
import { appT, type Text } from "./localization";

export interface CommitButton {
  label: Text;
  enabled: boolean;
}
```

Replace each `translate("ui.commit.remove")` with `appT("ui.commit.remove")` and `translate("ui.commit.add")` with `appT("ui.commit.add")`; delete the `translate` import. The module no longer touches the singleton.

- [ ] **Step 4: Bridge the two `main.ts` call sites**

In `showCommitPopover` (`web/src/app/main.ts:641`), the `commitButton(...)` result feeds `tip.show`/`tip.showConstellation`, which still expect `{label: string}`:

```ts
import { resolveTextGlobal } from "../core/localization";
// ...
const raw = commitButton(model, state.selected, reach, target);
const btn = { label: resolveTextGlobal(raw.label), enabled: raw.enabled };
```

Also update the Task 1 harness: `collectSurfaces` must resolve commit labels so the snapshot stays byte-identical:

```ts
commit: [...].map((b) => ({ label: resolveTextGlobal(b.label), enabled: b.enabled })),
```

(The harness installed `loc` as the singleton at the top, so `resolveTextGlobal` resolves under the intended locale.)

- [ ] **Step 5: Run tests, then commit**

Run: `cd web && bun test test/commit-action.test.ts test/i18nCharacterization.test.ts && bun test`
Expected: all pass, snapshot untouched.

```bash
git add web/src/core/commitAction.ts web/src/app/main.ts web/test/commit-action.test.ts web/test/i18nCharacterization.test.ts
git commit -m "refactor(i18n): commitAction returns Text descriptors

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: Convert `statFormat` row formatting (classify, statRow, bonus rows)

**Files:**
- Modify: `web/src/core/statFormat.ts`
- Modify: `web/src/adapters/tooltipView.ts` (interim `resolveTextGlobal` bridge)
- Test: `web/test/statFormat.test.ts`, `web/test/statHumanizeCoverage.test.ts`, `web/test/i18nCharacterization.test.ts`

**Interfaces:**
- Produces:
  - `StatRow { label: Text; value: Text }` (was strings)
  - `Classified { label: Text; percent: boolean; sign: number }` (internal)
  - `statRow(id, value, racialTarget?): StatRow | null`
  - `formatBonusRows(bonuses, opts?): StatRow[]` and `formatBonusRowsWithIds(...): {id: string; label: Text; value: Text}[]` now return in **stable input order** (label sorting removed from core; callers sort after resolving).
- Consumes: `appT`, `gameT`, `gameStrippedT`, `litT`, `resolveTextGlobal` from Task 2.

- [ ] **Step 1: Add a resolve helper to the tests and update assertions**

At the top of `web/test/statFormat.test.ts`:

```ts
import { enLoc } from "./helpers/localizeEn";
import { resolveText, type Text } from "../src/core/localization";
const res = (t: Text) => resolveText(enLoc, t);
const resRow = (r: { label: Text; value: Text } | null) =>
  r ? { label: res(r.label), value: res(r.value) } : null;
```

Convert assertions mechanically: `expect(statRow(x, v)).toEqual({label: L, value: V})` becomes `expect(resRow(statRow(x, v))).toEqual({label: L, value: V})`; list assertions map with `resRow`. Where a test depended on alphabetical ordering of `formatBonusRows` output, sort the resolved rows in the test (`rows.map(resRow).sort((a,b)=>a.label.localeCompare(b.label))`) so the expected values are unchanged. Leave the `formatPowerStats`/`formatPet` describe blocks untouched for now (converted in Task 5); they still pass because those functions still return strings.

- [ ] **Step 2: Run to verify the converted assertions fail**

Run: `cd web && bun test test/statFormat.test.ts`
Expected: FAIL (`res` receives strings, or types clash once implementation changes; either way red first).

- [ ] **Step 3: Convert the label producers in `statFormat.ts`**

Every change is one of five patterns; the sites are enumerated below.

Pattern table (before -> after):

| before | after |
| --- | --- |
| `translate(key)` | `appT(key)` |
| `translate(key, {a: x})` | `appT(key, {a: x})` (params may now stay `Text`) |
| `gameText(tag)` | `gameT(tag)` |
| `stripValueTokens(gameText(fmtTag))` | `gameStrippedT(fmtTag)` |
| computed English string (humanize, fmtValue, min-max ranges) | `litT(...)` |

Complete converted forms of every changed function:

```ts
function statLabel(key: string): Text {
  const tag = STAT_TAGS[key];
  return tag ? gameT(tag) : appT(key);
}
```

`instantDamageLabel`, `dotDamageLabel`, `resistLabel`, `attrLabel`: return type becomes `Text | undefined` (bodies unchanged apart from flowing `statLabel`'s `Text` through).

`classify(id)`: return `Classified {label: Text; ...}`. Each arm applies the table:
- override arm: `{ label: appT(`stat.override.${id}`), percent: o.percent, sign: o.sign }`
- family arms: `translate("stat.template.duration", { type })` becomes `appT("stat.template.duration", { type })` (with `type: Text` nesting naturally); same for `stat.template.damage`, `stat.template.maxResistance`, `stat.template.reducedDuration`, `stat.template.resistance`, `stat.template.retaliation`; the attr arm returns `{ label: name, ... }` unchanged (already `Text`).
- format-tag arm: `{ label: gameStrippedT(fmtTag), percent: true, sign: 1 }`
- fallback: `{ label: litT(humanize(id)), percent, sign }`

```ts
function fmtValue(value: number, percent: boolean, sign: number): Text {
  const n = sign * value;
  const s = n >= 0 ? `+${n}` : `${n}`;
  return litT(percent ? `${s}%` : s);
}

function raceLabel(targets?: string[]): Text | null {
  if (!targets || targets.length === 0) return null;
  const parts: Text[] = [];
  targets.forEach((t, i) => {
    if (i > 0) parts.push(appT("stat.race.join"));
    parts.push(RACE_SEGMENTS.has(t) ? appT(`stat.race.${t}`) : litT(t));
  });
  return { k: "join", parts };
}
```

`statRow`: `label` starts as `c.label`; the racial overrides become `label = appT("stat.subject.damageToRace", { race })` / `appT("stat.subject.lessDamageFromRace", { race })` with `race: Text`.

`bonusEntries`: the merged min-max row becomes `{ id: minK, row: { label: c.label, value: litT(`+${bonuses[minK]}-${bonuses[maxK]}`) } }`.

`formatBonusRows` / `formatBonusRowsWithIds`: delete the `.sort(...)` calls (core no longer orders by display text); everything else unchanged.

Delete the now-unused `translate`/`gameText`/`stripValueTokens` imports that these functions used; import `appT, gameT, gameStrippedT, litT, type Text` from `./localization`. (`translate`/`gameText` remain imported only if `formatPowerStats`/`formatPet`/`decompose` still use them, which they do until Tasks 5 and 6.)

- [ ] **Step 4: Bridge `tooltipView.ts`**

`bonusRowsHtml` consumes `formatBonusRowsWithIds`; make it resolve and sort at assembly:

```ts
import { resolveTextGlobal } from "../core/localization";

function bonusRowsHtml(bonuses, selectedBenefits, scope, racialTarget?): string {
  return formatBonusRowsWithIds(bonuses, { racialTarget })
    .map((r) => ({ id: r.id, label: resolveTextGlobal(r.label), value: resolveTextGlobal(r.value) }))
    .sort((a, b) => a.label.localeCompare(b.label))
    .map((r) => { /* existing HTML template unchanged */ })
    .join("");
}
```

Update the Task 1 harness `perStar.bonuses` the same way (resolve then sort) so the snapshot stays identical.

- [ ] **Step 5: Run tests, then commit**

Run: `cd web && bun test test/statFormat.test.ts test/statHumanizeCoverage.test.ts test/i18nCharacterization.test.ts test/tooltip-weapon-req.test.ts && bun test`
Expected: all pass; snapshot byte-identical.

```bash
git add web/src/core/statFormat.ts web/src/adapters/tooltipView.ts web/test/statFormat.test.ts web/test/statHumanizeCoverage.test.ts web/test/i18nCharacterization.test.ts
git commit -m "refactor(i18n): statFormat row labels and values become Text descriptors

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: Convert `formatPowerStats` and `formatPet`

**Files:**
- Modify: `web/src/core/statFormat.ts`
- Modify: `web/src/adapters/tooltipView.ts` (`powerHtml`/`petHtml` resolve)
- Test: `web/test/statFormat.test.ts`, `web/test/i18nCharacterization.test.ts`

**Interfaces:**
- Produces: `formatPowerStats(stats): StatRow[]` and `formatPet(pet): { summon: Text; attack: StatRow[] }` returning `Text` rows in the existing (already stable, grimtools) order. Row order here is intentional, NOT alphabetical: adapters must not sort power rows.
- Consumes: Task 2 constructors and Task 4's `StatRow`.

- [ ] **Step 1: Update the power/pet test assertions with the Task 4 `res`/`resRow` helpers**

Same mechanical wrap as Task 4, now for the `formatPowerStats` and `formatPet` describe blocks. `formatPet` summaries: `expect(res(formatPet(p).summon)).toBe("Summons 3 ...")`.

- [ ] **Step 2: Run to verify failure**

Run: `cd web && bun test test/statFormat.test.ts`
Expected: FAIL on the power/pet blocks.

- [ ] **Step 3: Convert the functions**

Apply the Task 4 pattern table throughout `formatPowerStats`; the only structural changes are label composition (`join`) and the tables that pre-resolved labels:

- Simple meta rows: `rows.push({ value: litT(fmtNum(cd)), label: appT("stat.power.secondSkillRecharge") })` (same shape for duration, projectiles, pass-through with `litT(`${fmtNum(pierce)}%`)`, radius, absorption, heals with `%` values, weapon damage).
- `forSecondsSuffix(seconds: number): Text` returns `appT("stat.power.forSeconds", { seconds: fmtNum(seconds) })`.
- DoT rows: `label: appT("stat.power.dotDamageOverSeconds", { name: statLabel(`stat.dot.${seg}`), seconds: fmtNum(stats[durK]!) })`.
- `abilityDebuffs` table stores keys instead of resolved strings: `[["DefensiveAbility", "stat.power.reducedDefensiveAbility"], ["OffensiveAbility", "stat.power.reducedOffensiveAbility"]]`; the row becomes `label: dur !== undefined ? joinT(appT(key), forSecondsSuffix(dur)) : appT(key)`.
- `timedDebuffs` table likewise stores the app key in place of the translated string (same keys as today: `stat.power.slowerTargetMovement`, `stat.power.reducedTargetResistances`, `stat.power.reducedTargetDamage`, `stat.subject.fumble`, `stat.subject.impairedAim`, `stat.subject.slowAttackSpeed`, `stat.subject.slowTotalSpeed`, `stat.subject.reducedElementalResistancesFlat`, `stat.subject.reducedPhysicalResistance`); row label composed with `joinT` as above; value `litT(pct ? `${fmtNum(v)}%` : fmtNum(v))`.
- CC rows: `label: appT("stat.power.ccChanceDuration", { seconds, effect: appT(key) })` and `appT("stat.power.ccDuration", { effect: appT(key) })`; values `litT(...)`.
- Fall-through rest: `formatBonusRows(rest)` rows now carry `Text` values. Strip the leading `+` at the descriptor level (the value here is always a `lit`):

```ts
for (const r of formatBonusRows(rest)) {
  const v = r.value.k === "lit" ? litT(r.value.s.replace(/^\+/, "")) : r.value;
  rows.push({ label: r.label, value: v });
}
```

`formatPet`:

```ts
export function formatPet(pet: PetInfo): { summon: Text; attack: StatRow[] } {
  const plural = (pet.count ?? 1) > 1;
  const num = plural ? `${fmtNum(pet.count!)} ` : "";
  const nameBase: Text = pet.nameTag ? gameT(pet.nameTag) : appT("stat.pet.minion");
  const name: Text = plural ? joinT(nameBase, "s") : nameBase;
  const dur: Text = pet.duration ? forSecondsSuffix(pet.duration) : litT("");
  return { summon: appT("stat.pet.summons", { num, name, dur }), attack: formatPowerStats(pet.attackStats) };
}
```

- [ ] **Step 4: Bridge `tooltipView.ts` power/pet rendering**

In `powerHtml` and `petHtml`, wrap each rendered row: `resolveTextGlobal(r.value)` / `resolveTextGlobal(r.label)`, and `resolveTextGlobal(formatPet(pet).summon)`. Do NOT sort power rows (order is semantic). Update the Task 1 harness `perStar.power`/`perStar.pet` to resolve (no sort).

- [ ] **Step 5: Run tests, then commit**

Run: `cd web && bun test test/statFormat.test.ts test/i18nCharacterization.test.ts && bun test`
Expected: all pass; snapshot byte-identical.

```bash
git add web/src/core/statFormat.ts web/src/adapters/tooltipView.ts web/test/statFormat.test.ts web/test/i18nCharacterization.test.ts
git commit -m "refactor(i18n): power and pet formatting returns Text descriptors

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: Structural subject identity in `decompose`/`condensedRows`/`groupedBonusRows`

**Files:**
- Modify: `web/src/core/statFormat.ts`
- Modify: `web/src/adapters/sidebarView.ts` (interim bridge)
- Test: `web/test/condense.test.ts`, new assertions in it for merge/de-merge, `web/test/i18nCharacterization.test.ts`

**Interfaces:**
- Produces:
  - `decompose` (internal) returns `{ group: StatGroup; subjectKey: string; subject: Text; dim: StatDim } | null`.
  - `CondensedSubject { subject: Text; key: string; parts: CondensedPart[] }` where `key` is `` `${group}:${subjectKey}` `` and `subjectKey` is locale-independent:
    - family arms: `damage:<Seg>`, `dot:<Seg>`, `resist:<Seg>` (base resist AND MaxResist share `resist:<Seg>`), `attr:<Seg>`
    - curated arms: the app catalog key used for the label (for example `stat.subject.fumble`, `stat.power.reducedTargetResistances`)
    - intentional merges: `armor` (defensiveProtection + defensiveProtectionModifier) and `retaliation-fear` (retaliationFearMin + retaliationFearChance)
    - standalone fallback: the raw stat id
  - `condensedRows` returns subjects in stable structural order (insertion order per group; alphabetical sorting removed). `groupedBonusRows` likewise unsorted.
- Consumes: Tasks 2, 4.

- [ ] **Step 1: Write the failing key tests**

Add to `web/test/condense.test.ts`:

```ts
test("subject keys are structural, not display text", () => {
  const groups = condensedRows({ offensiveFireMin: 10, defensiveFire: 8, defensiveFireMaxResist: 3 });
  const keys = groups.flatMap((g) => g.subjects.map((s) => s.key));
  expect(keys).toContain("Offense:damage:Fire");
  expect(keys).toContain("Resistances:resist:Fire");
  // base resist and max resist merge into ONE subject (max is a dim of the resistance subject)
  expect(keys.filter((k) => k === "Resistances:resist:Fire")).toHaveLength(1);
});
test("intentional merges hold under structural keys", () => {
  const armor = condensedRows({ defensiveProtection: 100, defensiveProtectionModifier: 8 });
  expect(armor.flatMap((g) => g.subjects).map((s) => s.key)).toEqual(["Armor & Mitigation:armor"]);
  const fear = condensedRows({ retaliationFearMin: 1, retaliationFearChance: 20 });
  expect(fear.flatMap((g) => g.subjects).map((s) => s.key)).toEqual(["Retaliation:retaliation-fear"]);
});
```

Update existing `condense.test.ts` assertions for subject labels by defining the same two-line helper Task 4 added to `statFormat.test.ts` (`const res = (t: Text) => resolveText(enLoc, t)`) locally in this file, and drop any reliance on alphabetical subject order (sort resolved subjects in the test where needed). Task 7 does the same in `benefitRows.test.ts`.

- [ ] **Step 2: Run to verify failure**

Run: `cd web && bun test test/condense.test.ts`
Expected: FAIL (keys are still `"<group>:<translated label>"`).

- [ ] **Step 3: Convert `decompose` and `condensedRows`**

`decompose` arms return `subjectKey` + `subject: Text` per the table above. The two override merges are explicit:

```ts
if (id === "defensiveProtection" || id === "defensiveProtectionModifier")
  return {
    group,
    subjectKey: "armor",
    subject: appT("stat.override.defensiveProtection"),
    dim: id.endsWith("Modifier") ? "pct" : "flat",
  };
if (id === "retaliationFearMin" || id === "retaliationFearChance")
  return {
    group,
    subjectKey: "retaliation-fear",
    subject: appT("stat.override.retaliationFearMin"),
    dim: id === "retaliationFearChance" ? "pct" : "flat",
  };
```

(Place these BEFORE the generic standalone fallback; the OVERRIDES entries for these ids stay in `classify` untouched.) Curated arms use their app key: for example `subjectKey: "stat.subject.fumble", subject: appT("stat.subject.fumble")`. Family arms: `subjectKey: `resist:${m[1]}`, subject: appT("stat.template.resistance", { type })` (both the base-resist and MaxResist arms use `resist:${m[1]}`). Standalone fallback: `{ group, subjectKey: id, subject: c.label, dim: c.percent ? "pct" : "flat" }`.

`condensedRows`: key subjects by `d.subjectKey` within a group, set `key: `${d.group}:${d.subjectKey}``, keep dim-order sorting of parts, DELETE the `.sort((a, b) => a.subject.localeCompare(...))`. `groupedBonusRows`: delete its label sort.

- [ ] **Step 4: Bridge `sidebarView.ts`**

`renderBenefits`/`availListHtml` render `s.subject` into HTML and sort implicitly by catalog order: wrap subject usage with `resolveTextGlobal(s.subject)` and sort subject lists at assembly with `.sort((a, b) => resolveTextGlobal(a.subject).localeCompare(resolveTextGlobal(b.subject)))`. `makeScope`'s `catIds` map already keys by `s.key` (now structural, still consistent between catalog and active structures). Update the Task 1 harness `condensed`/`condensedPet` to resolve subject labels and re-sort resolved subjects per group so the snapshot stays identical.

- [ ] **Step 5: Run tests, then commit**

Run: `cd web && bun test test/condense.test.ts test/sidebar-benefits.test.ts test/i18nCharacterization.test.ts && bun test`
Expected: all pass; snapshot byte-identical.

```bash
git add web/src/core/statFormat.ts web/src/adapters/sidebarView.ts web/test/condense.test.ts web/test/i18nCharacterization.test.ts
git commit -m "refactor(i18n): structural locale-independent subject keys in condensed rows

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: Convert `benefitRows`

**Files:**
- Modify: `web/src/core/benefitRows.ts`
- Modify: `web/src/adapters/sidebarView.ts` (bridge `benefitListHtml`)
- Test: `web/test/benefitRows.test.ts`, `web/test/i18nCharacterization.test.ts`

**Interfaces:**
- Produces: `BenefitRow { role; subLabel: Text; id; base: Text; now: Text; delta: Text; verdict }`, `BenefitSubject { subject: Text; key: string; ids; verdict; rows }`. Empty cells are `litT("")`; the dash is `litT("—")`. Subjects returned in structural order (adapter sorts by resolved label).
- Consumes: Task 6's `CondensedSubject` shape.

- [ ] **Step 1: Update `benefitRows.test.ts` with the `res` helper**

Wrap label/value assertions in `res(...)`; where the test relied on subject alphabetical order, sort by resolved subject in the test.

- [ ] **Step 2: Run to verify failure**

Run: `cd web && bun test test/benefitRows.test.ts`
Expected: FAIL.

- [ ] **Step 3: Convert `benefitRows.ts`**

- `const DASH = litT("—");` and `const EMPTY = litT("");`
- `rowValue(dim, value: Text): Text` returns `dim === "durFlat" ? appT("ui.benefit.seconds", { value }) : value`.
- `fmtDelta(n): Text` returns `n === 0 ? DASH : litT(r > 0 ? `+${r}` : `${r}`)`.
- `SubjMeta.subject: Text`; `skeleton` stores `Text` in `baseVal`/`nowVal` maps; subject dedupe keys off `s.key` exactly as today (now structural).
- `subLabel`: `appT("ui.benefit.max")` / `appT("ui.benefit.duration")`, else `EMPTY`.
- `maxQualified(s: Text): Text` returns `maxFirst && !(s.k === "lit" && s.s === "—") ? appT("ui.benefit.maxPrefix", { subject: s }) : s` (the dash check replaces the old `s !== DASH` string compare).
- Verdict/delta arithmetic reads the raw maps and is unchanged.
- Delete the subject `.sort(...)` at the bottom (structural order out; adapter sorts).
- Delete the `translate` import; import `appT, litT, type Text` from `./localization`.

- [ ] **Step 4: Bridge `sidebarView.ts` `benefitListHtml`**

Resolve at assembly: `resolveTextGlobal(r.now)`, `resolveTextGlobal(r.base)`, `resolveTextGlobal(r.delta)`, `resolveTextGlobal(r.subLabel)`, `resolveTextGlobal(s.subject)` (also in the `title` attribute), and sort each group's subjects by resolved subject before rendering. Update the Task 1 harness `benefitRowsRegular`/`benefitRowsCompare` to resolve every `Text` field and sort subjects by resolved label per group.

- [ ] **Step 5: Run tests, then commit**

Run: `cd web && bun test test/benefitRows.test.ts test/sidebar-benefits.test.ts test/displayState.test.ts test/i18nCharacterization.test.ts && bun test`
Expected: all pass; snapshot byte-identical.

```bash
git add web/src/core/benefitRows.ts web/src/adapters/sidebarView.ts web/test/benefitRows.test.ts web/test/i18nCharacterization.test.ts
git commit -m "refactor(i18n): benefitRows returns Text descriptors with structural subjects

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 8: Adapters take `loc`; `main.ts` threads it; shims retired from adapters

**Files:**
- Modify: `web/src/adapters/sidebarView.ts`, `web/src/adapters/tooltipView.ts`, `web/src/adapters/buildOrderView.ts`
- Modify: `web/src/app/main.ts`
- Test: `web/test/sidebar-benefits.test.ts`, `web/test/sidebar-affinity.test.ts`, `web/test/tooltip-weapon-req.test.ts`, `web/test/build-order-path.test.ts` (whichever assert through these adapters), `web/test/i18nCharacterization.test.ts`

**Interfaces:**
- Produces (signatures later steps and `main.ts` rely on):
  - `renderBenefits(loc: Localization, el, model, selected, ...)` (loc first; rest unchanged)
  - `renderAffinities(loc: Localization, el, model, have, need, needSource, prev?, selectedBenefits?)`
  - `powersListHtml(loc: Localization, powers)`
  - `buildOrderHtml(loc: Localization, model, manifest, steps, noOrder?)`
  - `tooltipView(el)` handle methods gain loc first: `show(loc, model, starId, ...)`, `showConstellation(loc, model, conId, ...)` (per call, so a language switch never leaves a stale capture)
  - `commitHtml` consumes `CommitButton` with `label: Text` directly (main.ts bridge from Task 3 removed).
- Consumes: `resolveText`, `sortByResolved` from Task 2. After this task, NO adapter calls `resolveTextGlobal` or the global `translate`/`gameText`; only `main.ts` chrome still uses the singleton until Task 9.

- [ ] **Step 1: Update adapter tests to pass `enLoc`**

Each affected test calls the new signatures, for example `renderBenefits(enLoc, el, model, sel)`; delete `installEnglish()` calls that existed only for these adapters. Expected strings unchanged.

- [ ] **Step 2: Run to verify failure**

Run: `cd web && bun test test/sidebar-benefits.test.ts test/sidebar-affinity.test.ts`
Expected: FAIL (signature mismatch).

- [ ] **Step 3: Convert the three adapters**

Mechanical, per file: add `loc: Localization` as the first parameter; replace every `translate(k, p)` with `loc.translate(k, p)`, every `gameText(t)` with `loc.gameText(t)`, every `resolveTextGlobal(x)` with `resolveText(loc, x)`; replace ad-hoc `.sort` on resolved labels with `sortByResolved(loc, items, labelOf)` where the items still carry `Text` (power list sorting in `powersListHtml` uses `sortByResolved(loc, powers, (p) => gameT(p.power.nameTag))` or equivalently keeps resolving `loc.gameText` inline; pick the former). `tooltipView`'s `commitHtml(commit)` renders `resolveText(loc, commit.label)`. Delete `translate`/`gameText`/`resolveTextGlobal` imports from these files.

- [ ] **Step 4: Thread `loc` through `main.ts`**

- `renderBenefitsPanel()`: `renderBenefits(localization, benefitsEl, ...)`.
- `refresh()`: `renderAffinities(localization, affinityEl, ...)`, `powersListHtml(localization, availPowers)`.
- `paintBuildOrder`: `buildOrderHtml(localization, model, data.manifest, steps, noOrder)`.
- Tooltip call sites (`onHover`, `powerRowHover`, `showCommitPopover`): `tip.show(localization, model, ...)` / `tip.showConstellation(localization, model, ...)`.
- Remove the Task 3 bridge: pass `commitButton(...)` straight through.
- `localization` is reassigned by the language picker's `onSelect`; because loc is passed per call, the next `refresh()` renders in the new locale with no other wiring.

Update the Task 1 harness to the new `buildOrderHtml(loc, ...)` signature (pass the harness `loc` explicitly).

- [ ] **Step 5: Run everything, then commit**

Run: `cd web && bun test`
Expected: all pass; snapshot byte-identical.

```bash
git add web/src/adapters/sidebarView.ts web/src/adapters/tooltipView.ts web/src/adapters/buildOrderView.ts web/src/app/main.ts web/test
git commit -m "refactor(i18n): adapters resolve Text through an explicit Localization argument

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 9: Delete the singleton, `buildCatalogs`, and the shim; add the boundary guard

**Files:**
- Modify: `web/src/core/localization.ts` (delete `current`, `setLocalization`, global `translate`, `gameText`, `resolveTextGlobal`, `RAW_LOC`)
- Modify: `web/src/adapters/localizationAdapter.ts` (stop calling `setLocalization`)
- Modify: `web/src/app/main.ts` (chrome uses `localization.translate`; delete `buildCatalogs`)
- Modify: `web/test/helpers/localizeEn.ts` (delete `installEnglish`, keep `enLoc`), `web/test/localization.test.ts` (drop singleton tests), `web/test/i18nCharacterization.test.ts` (harness takes loc explicitly, no `setLocalization`)
- Create: `web/test/i18nBoundary.test.ts`

**Interfaces:**
- Produces: `core/localization.ts` exports only `makeLocalization`, `stripValueTokens`, the `Text` union, constructors, `resolveText`, `sortByResolved`. `loadLocalization` returns the instance without installing anything global.
- Consumes: everything above; this task is only deletions plus the guard.

- [ ] **Step 1: Write the failing boundary guard**

```ts
// ABOUTME: Guard: core must not contain a localization singleton or resolve text globally.
// ABOUTME: Locale-independence of core output is enforced by construction; this keeps it that way.
import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const CORE = join(import.meta.dir, "../src/core");
const FORBIDDEN = /\bsetLocalization\b|\bresolveTextGlobal\b/;

test("no core or adapter file references the deleted singleton API", () => {
  for (const dir of [CORE, join(import.meta.dir, "../src/adapters"), join(import.meta.dir, "../src/app")]) {
    for (const f of readdirSync(dir).filter((f) => f.endsWith(".ts"))) {
      const src = readFileSync(join(dir, f), "utf8");
      expect(FORBIDDEN.test(src), `${f} references the singleton`).toBe(false);
    }
  }
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd web && bun test test/i18nBoundary.test.ts`
Expected: FAIL (localization.ts still defines `setLocalization`, main.ts and the adapter still reference it).

- [ ] **Step 3: Delete**

- `core/localization.ts`: remove `current`, `setLocalization`, the global `translate`/`gameText`, `resolveTextGlobal`, `RAW_LOC`, and their comments.
- `adapters/localizationAdapter.ts`: `loadLocalization` no longer imports/calls `setLocalization`; it just returns the built `Localization`.
- `main.ts`: `applyChrome` and every remaining chrome string use `localization.translate(...)`; the language `onSelect` drops `buildCatalogs()` (delete the function); `benefitCatalog`/`petCatalog` become `const`, built once at boot (they now contain only ids, keys, and `Text`).
- Tests: `localizeEn.ts` keeps only `enLoc`; `localization.test.ts` drops the `setLocalization`/global-translate cases (keep the `makeLocalization` fallback cases); the characterization harness drops `setLocalization(loc)` (everything already takes loc explicitly after Task 8).

- [ ] **Step 4: Run everything**

Run: `cd web && bun test && cd .. && just typecheck`
Expected: all pass (typecheck is what proves no dangling imports); snapshot byte-identical.

- [ ] **Step 5: Commit**

```bash
git add -A web/src web/test
git commit -m "refactor(i18n): delete the localization singleton and buildCatalogs; add boundary guard

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 10: Verification, worth-it evaluation, merge decision

**Files:**
- No source changes. Produces an evaluation summary for Ted.

- [ ] **Step 1: Full gates**

Run: `just check` then `just e2e` (run `just install-e2e` first if needed).
Expected: both green. e2e proves boot, language picker, and rendering still work against the real bundle.

- [ ] **Step 2: Prove the snapshot never moved**

Run: `git log --oneline -- web/test/__snapshots__/i18nCharacterization.test.ts.snap`
Expected: exactly ONE commit (Task 1). More than one means behavior changed; investigate before proceeding.

- [ ] **Step 3: Manual smoke of the one intended behavior change**

Run `just serve`, switch the language picker to zh and ru: benefits panel, tooltips, and build order render translated; switching back to en is instant and correct; no console errors. This exercises the deleted `buildCatalogs` path (catalogs are now locale-independent).

- [ ] **Step 4: Assemble the worth-it evaluation**

Present to Ted, per the spec:
- `git diff --stat main...HEAD` (total churn),
- confirmation the snapshot is byte-identical and all gates are green,
- a side-by-side readability comparison of two or three converted `statFormat` families against `main` (for example the override arm, `formatPowerStats` timed debuffs, `raceLabel`), with an honest judgment: does the descriptor version read as well as the string version?

- [ ] **Step 5: Merge decision**

Ted decides merge vs abandon. On merge, use the superpowers:finishing-a-development-branch skill; also update `docs/i18n.md` (and any doc that describes the singleton or `buildCatalogs`) in the same merge, per the living-docs rule.

---

## Self-Review Notes

- Spec coverage: descriptor type (Task 2), structural keys incl. both intentional merges (Task 6), all module conversions (Tasks 3-7), adapters + sorting move + `main.ts` (Task 8), singleton/buildCatalogs deletion + guard (Task 9), snapshot gate (Task 1, enforced every task), worth-it evaluation (Task 10). The spec's "cross-locale guard test" is realized structurally: after Task 7 core formatting takes no locale at all, so key stability is enforced by types plus the Task 6 key tests and the en/zh snapshot.
- Sorting: alphabetical-by-label ordering moves to adapters in Tasks 4/6/7 bridges and is formalized in Task 8; power rows are explicitly never sorted (semantic order).
- `languagePicker.ts` needs no change: it already receives resolved strings from `main.ts`.
- `urlState.ts` needs no change: `isFilterableStat` never resolved text.
