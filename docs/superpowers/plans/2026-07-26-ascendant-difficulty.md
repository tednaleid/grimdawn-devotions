# Ascendant Difficulty Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Ascendant as a fourth difficulty in the monster explorer, with its resistance offsets derived from the game records rather than aliased to Ultimate in app code.

**Architecture:** `scripts/parse_monsters.py` follows a two-hop engine pointer to the Ascendant adjustment record and emits `difficulty_offsets.ascendant = ultimate + adjustment`. The web layer picks the new key up through the existing `DIFFICULTIES` constant, which already drives both the dropdown and the hash validator. A pure predicate compares the two offset rows so the page can state their equivalence only while the data proves it.

**Tech Stack:** Python 3.10+ stdlib (`uv run`), TypeScript, Bun test, `just` recipes.

Design record: `docs/superpowers/specs/2026-07-26-ascendant-difficulty-design.md`

## Global Constraints

- All commands run through `just` recipes, never the underlying tool directly.
- Python runs via `uv run`; a bare `python` invocation fails with exit 49 on this machine.
- Every user-facing string is a catalog key in `web/src/i18n/app.en.json`, never a literal, and must be added to the `web/test/appCatalog.test.ts` guard list.
- Core modules return data or `Text` descriptors; adapters resolve through the `Localization` port. `loc.gameText` is for game tags, `loc.translate` for catalog keys.
- No DOM in unit tests. Views are pure `*Markup(loc, ...) -> string` functions asserted with `toContain`; `render*(el, ...)` wrappers assign `innerHTML`.
- Every file starts with two `// ABOUTME: ` lines.
- The game's field spelling is `ultimateChallangeAdjustment` (their typo). Use it verbatim.
- Difficulty order is `normal, elite, ultimate, ascendant` — dropdown order, hardest last. `DEFAULT_VIEW.diff` stays `"ultimate"`.
- Record paths: `records/game/gameascendant.dbr`, `records/game/balancingadjustment_ultramode_enemies01.dbr`.

---

### Task 1: Pipeline reads the Ascendant adjustment

**Files:**
- Modify: `scripts/parse_monsters.py:352-356` (constants), `:384-417` (refs and offsets), `:450-484` (summary), `:511` (call site)
- Test: `scripts/test_parse_monsters.py` (append after the existing offset-failure block, around `:236`)

**Interfaces:**
- Consumes: existing `DB`, `RESISTANCE_FIELDS`, `as_float`, `GAMEENGINE_REF`, `SCALER_FALLBACK`, `split_difficulty_array`, `scaler_ref`
- Produces: `ascendant_ref(db) -> str`, `flat_adjustment(rec: dict) -> dict`, `FAILED_ASCENDANT_FIELDS: list[str]`, `ASCENDANT`, `ASCENDANT_RECORD_FALLBACK`, `ULTRAMODE_FALLBACK`; `difficulty_offsets(db)` gains an `"ascendant"` key

- [ ] **Step 1: Write the failing tests**

Append to `scripts/test_parse_monsters.py` after the existing `"a good-arity field keeps its real parsed value"` check. `FakeDB`, `db`, `TEN` and `check` already exist above in that file.

```python
# --- Ascendant: the adjustment record and the fourth offsets key ---
check("ascendant ref resolves through gameengine.dbr and gameascendant.dbr",
      mon.ascendant_ref(db).endswith("balancingadjustment_ultramode_enemies01.dbr"))
check("ascendant ref falls back when the engine names no ascendant record",
      mon.ascendant_ref(FakeDB({})).endswith("balancingadjustment_ultramode_enemies01.dbr"))

check("flat_adjustment reads a scalar field",
      mon.flat_adjustment({"defensiveFire": "7.000000"})["fire"] == 7)
check("flat_adjustment keeps a negative adjustment",
      mon.flat_adjustment({"defensiveFire": "-4.000000"})["fire"] == -4)
check("flat_adjustment treats an absent field as no adjustment",
      mon.flat_adjustment({})["fire"] == 0)
check("flat_adjustment returns all ten keys",
      list(mon.flat_adjustment({}).keys()) == TEN)
before_asc = list(mon.FAILED_ASCENDANT_FIELDS)
bad_adj = mon.flat_adjustment({"defensiveCold": "1.0;2.0"})
check("flat_adjustment records a non-scalar field as failed",
      mon.FAILED_ASCENDANT_FIELDS[len(before_asc):] == ["cold"])
check("a failed ascendant field defaults to 0", bad_adj["cold"] == 0)

# The real ultramode record is all zeros, so a fixture built from it cannot tell
# "ultimate + adjustment" from "copy ultimate", "adjustment only", or "read the
# wrong record". These values are nonzero and differ per type so it can.
twelve_up = ";".join(str(float(n)) for n in [0, 0, 0, 0, 4, 6, 8, 11, 8, 10, 13, 16])
asc_db = FakeDB({
    mon.GAMEENGINE_REF: {"monsterAttributePak": mon.SCALER_FALLBACK,
                         "ascendantRecord": mon.ASCENDANT_RECORD_FALLBACK},
    mon.SCALER_FALLBACK: {f: twelve_up for f in mon.RESISTANCE_FIELDS.values()},
    mon.ASCENDANT_RECORD_FALLBACK: {"ultimateChallangeAdjustment": mon.ULTRAMODE_FALLBACK},
    mon.ULTRAMODE_FALLBACK: {"defensiveFire": "3.000000", "defensiveCold": "-2.000000"},
})
asc = mon.difficulty_offsets(asc_db)
check("offsets cover four difficulties",
      sorted(asc.keys()) == ["ascendant", "elite", "normal", "ultimate"])
check("ascendant covers the four player brackets",
      sorted(asc["ascendant"].keys()) == ["1", "2", "3", "4"])
check("ascendant adds the adjustment to ultimate in every bracket",
      [asc["ascendant"][p]["fire"] for p in "1234"] == [11, 13, 16, 19])
check("ascendant carries a negative adjustment too",
      [asc["ascendant"][p]["cold"] for p in "1234"] == [6, 8, 11, 14])
check("a type absent from the adjustment record matches ultimate exactly",
      [asc["ascendant"][p]["poison"] for p in "1234"] == [8, 10, 13, 16])
check("building ascendant does not mutate ultimate",
      [asc["ultimate"][p]["fire"] for p in "1234"] == [8, 10, 13, 16])
check("ascendant is emitted after ultimate so the JSON reads weakest to hardest",
      list(asc.keys()) == ["normal", "elite", "ultimate", "ascendant"])

real = mon.difficulty_offsets(db)
check("real ascendant offsets equal ultimate today (the ultramode record is all zeros)",
      all(real["ascendant"][p][k] == real["ultimate"][p][k] for p in "1234" for k in TEN))
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `just test-scripts`
Expected: FAIL with `AttributeError: module 'mon' has no attribute 'ascendant_ref'`

- [ ] **Step 3: Add the constants**

Replace `scripts/parse_monsters.py:352-356`:

```python
DIFFICULTIES = ("normal", "elite", "ultimate")
# Ascendant is not a fourth difficulty in the records: it is a toggle layered on
# Ultimate (internally "ultimate challenge", the way Veteran layers on Normal).
# It is a fourth key in our output because that is how the page offers it.
ASCENDANT = "ascendant"
PLAYER_BRACKETS = ("1", "2", "3", "4")

GAMEENGINE_REF = "records/game/gameengine.dbr"
SCALER_FALLBACK = "records/game/balancingadjustment_mp+difficulty_enemies01.dbr"
ASCENDANT_RECORD_FALLBACK = "records/game/gameascendant.dbr"
ULTRAMODE_FALLBACK = "records/game/balancingadjustment_ultramode_enemies01.dbr"
```

- [ ] **Step 4: Add `ascendant_ref` and `flat_adjustment`**

Insert after `scaler_ref` (currently ending at `scripts/parse_monsters.py:388`):

```python
def ascendant_ref(db: DB) -> str:
    """The enemy adjustment Ascendant Mode layers on top of Ultimate.

    Two hops, both through fields the engine declares, so a patch that relocates
    either record is followed rather than silently read from a stale path:
    gameengine.dbr -> ascendantRecord -> gameascendant.dbr
    -> ultimateChallangeAdjustment (the game's own spelling).
    """
    game_ref = (db.get(GAMEENGINE_REF).get("ascendantRecord") or "").strip()
    ref = (db.get(game_ref or ASCENDANT_RECORD_FALLBACK).get("ultimateChallangeAdjustment") or "").strip()
    return ref or ULTRAMODE_FALLBACK


FAILED_ASCENDANT_FIELDS: list[str] = []


def flat_adjustment(rec: dict) -> dict:
    """The ten resistance values on a flat (non-tabular) adjustment record.

    Deliberately not split_difficulty_array: that models a 3x4 difficulty/player
    table, while this record is one adjustment applied on top of whichever
    difficulty is active. Routing it through the 12-cell reader would be a
    category error that happens to look correct while every value is zero.

    An absent field contributes 0. A present field that is not a single number
    is recorded in FAILED_ASCENDANT_FIELDS (mirroring FAILED_OFFSET_FIELDS) so
    print_summary reports it instead of the value silently becoming 0.
    """
    out = {}
    for key, field in RESISTANCE_FIELDS.items():
        raw = rec.get(field)
        if raw is None:
            out[key] = 0
            continue
        v = as_float(raw)
        if v is None:
            FAILED_ASCENDANT_FIELDS.append(key)
            out[key] = 0
            continue
        out[key] = int(v) if v == int(v) else round(v, 4)
    return out
```

- [ ] **Step 5: Emit the fourth key**

In `difficulty_offsets`, replace the final `return out` (currently `scripts/parse_monsters.py:417`) with:

```python
    # Ascendant = Ultimate plus a flat adjustment. The adjustment does not vary by
    # player bracket, so Ultimate's bracket spread carries through unchanged.
    # Additive rather than replacing: the field is named an "adjustment" and sits
    # parallel to challengeAdjustment (Veteran), which stacks on Normal. Every
    # value is 0 today, so no test on real data can distinguish the two readings.
    adj = flat_adjustment(db.get(ascendant_ref(db)))
    out[ASCENDANT] = {
        p: {key: out["ultimate"][p][key] + adj[key] for key in RESISTANCE_FIELDS}
        for p in PLAYER_BRACKETS
    }
    return out
```

- [ ] **Step 6: Report ascendant parse failures in the summary**

Change the signature at `scripts/parse_monsters.py:450` to:

```python
def print_summary(monsters, exclusions, failed_offset_fields, failed_ascendant_fields):
```

and append after the existing `failed_offset_fields` warning:

```python
    if failed_ascendant_fields:
        p(f"  WARNING: ascendant adjustment fields failed to parse and defaulted to 0: "
          f"{sorted(set(failed_ascendant_fields))}")
```

Update the call site at `scripts/parse_monsters.py:515`:

```python
    print_summary(monsters, EXCLUSIONS, FAILED_OFFSET_FIELDS, FAILED_ASCENDANT_FIELDS)
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `just test-scripts`
Expected: PASS, all six suites, including the new ascendant checks

- [ ] **Step 8: Mutation-test the additive semantics**

The nonzero fixture exists to catch a specific wrong implementation. Prove it does. Temporarily change the Step 5 body to `out[ASCENDANT] = {p: dict(out["ultimate"][p]) for p in PLAYER_BRACKETS}` and run `just test-scripts`.
Expected: FAIL on `"ascendant adds the adjustment to ultimate in every bracket"`.
Then restore Step 5's code and re-run to confirm PASS.

- [ ] **Step 9: Commit**

```bash
git add scripts/parse_monsters.py scripts/test_parse_monsters.py
git commit -m "feat(monsters): derive Ascendant offsets from the game's adjustment record"
```

---

### Task 2: Regenerate the committed dataset

**Files:**
- Modify: `data/monsters.json` (generated), `scripts/diff_data.py:171-178` (docstring)

**Interfaces:**
- Consumes: Task 1's `difficulty_offsets`
- Produces: `data/monsters.json` with a `difficulty_offsets.ascendant` block, consumed by Task 3

- [ ] **Step 1: Regenerate**

The installed game is a later build than `data/steam-build-versions.json` knows, so the version must be passed explicitly or the recipe aborts.

Run: `GD_VERSION=1.3.0.0 just parse-monsters --steam-buildid 24346246`
Expected: `Wrote data/monsters.json  (1635 monsters)` and no WARNING lines in the summary.

- [ ] **Step 2: Verify the diff is exactly the new block**

Run: `just diff-data`
Expected: `MONSTERS: +0 new, -0 removed, 0 changed` and `DIFFICULTY OFFSETS: 40 changed`, every line of the form `ascendant/<bracket>: <key> none -> <value>` (`_fmt` renders an absent side as `none`). Forty is 4 brackets x 10 types. Any line naming `normal`, `elite` or `ultimate` means Task 1 mutated an existing difficulty — stop and fix rather than committing.

- [ ] **Step 3: Confirm the values match Ultimate**

Run: `just diff-data | grep ascendant | head -12`
Expected: the ascendant fire values are `8, 10, 13, 16` across brackets 1-4, identical to Ultimate's, because the ultramode record is all zeros today.

- [ ] **Step 4: Correct the diff_offsets docstring**

`scripts/diff_data.py:173-174` claims a fixed shape with no add/remove to report. That is now wrong: a new difficulty key appears as `- -> value` cells. Replace those two sentences with:

```python
    Difficulty x player bracket x resistance key. A new difficulty key (Ascendant
    arrived this way) shows up as cells changing from absent to a value, so the
    union below covers both sides rather than iterating one.
```

- [ ] **Step 5: Commit**

```bash
git add data/monsters.json scripts/diff_data.py
git commit -m "data(monsters): add the ascendant difficulty offset block"
```

---

### Task 3: Web core learns the fourth difficulty

**Files:**
- Modify: `web/src/monsters/core/facets.ts:27`, `web/src/monsters/core/model.ts` (append)
- Test: `web/test/monsters/urlState.test.ts`, `web/test/monsters/model.test.ts`

**Interfaces:**
- Consumes: Task 2's `difficulty_offsets.ascendant`
- Produces: `DIFFICULTIES` including `"ascendant"`; `sameOffsets(a: Resistances, b: Resistances): boolean` exported from `core/model.ts`, used by Task 4

- [ ] **Step 1: Write the failing tests**

Append to `web/test/monsters/urlState.test.ts`:

```ts
test("ascendant round-trips through the hash", () => {
  const v = { ...DEFAULT_VIEW, diff: "ascendant" as const };
  expect(encodeHash(v)).toContain("diff=ascendant");
  expect(decodeHash("diff=ascendant", new Set()).diff).toBe("ascendant");
});

test("a difficulty that is not in the list is still rejected", () => {
  // Pins that adding ascendant widened the allowed set by exactly one value
  // rather than dropping the check.
  expect(decodeHash("diff=ascendent", new Set()).diff).toBe(DEFAULT_VIEW.diff);
  expect(decodeHash("diff=nightmare", new Set()).diff).toBe(DEFAULT_VIEW.diff);
});
```

Append to `web/test/monsters/model.test.ts`:

```ts
test("offsetFor reads the ascendant block", () => {
  const doc = {
    meta: {},
    monsters: [],
    offsets: { ascendant: { "1": { fire: 12, cold: 3 } } },
  };
  expect(offsetFor(doc, "ascendant", "1").fire).toBe(12);
  expect(offsetFor(doc, "ascendant", "1").cold).toBe(3);
});

test("sameOffsets is true only when every type matches", () => {
  const base = Object.fromEntries(DAMAGE_TYPES.map((t) => [t, 5])) as Resistances;
  expect(sameOffsets(base, { ...base })).toBe(true);
  // One differing type, and the last one in the list, so an implementation that
  // compares only the first few or only a total still fails.
  expect(sameOffsets(base, { ...base, bleeding: 6 })).toBe(false);
  // Equal sums, different rows: a total-based comparison would wrongly pass.
  expect(sameOffsets(base, { ...base, fire: 4, cold: 6 })).toBe(false);
});
```

Add `sameOffsets` to the existing import from `../../src/monsters/core/model` in `model.test.ts`, and `DAMAGE_TYPES` from `../../src/monsters/core/facets` if not already imported.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `just check`
Expected: FAIL — `sameOffsets` is not exported, and `diff=ascendant` decodes to `ultimate`

- [ ] **Step 3: Widen DIFFICULTIES**

`web/src/monsters/core/facets.ts:27`:

```ts
// Ordered weakest to hardest, which is the dropdown order. Ascendant is a toggle
// layered on Ultimate in-game rather than a difficulty of its own; it is a fourth
// entry here because that is how the page offers it and how the data keys it.
export const DIFFICULTIES = ["normal", "elite", "ultimate", "ascendant"] as const;
```

`urlState.ts` builds `DIFF_VALUES` from this constant and `main.ts` builds the `<select>` from it, so both follow with no edit.

- [ ] **Step 4: Add `sameOffsets`**

Append to `web/src/monsters/core/model.ts`:

```ts
/** Whether two offset rows impose identical values across all ten types.
 *
 *  Lets the page state that two difficulties are equivalent only while the data
 *  says so. Nothing asserts that equivalence in app code: if a patch makes the
 *  rows diverge this returns false and the claim stops being rendered.
 */
export function sameOffsets(a: Resistances, b: Resistances): boolean {
  return DAMAGE_TYPES.every((t) => a[t] === b[t]);
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `just check`
Expected: PASS, 0 fail

- [ ] **Step 6: Commit**

```bash
git add web/src/monsters/core/facets.ts web/src/monsters/core/model.ts web/test/monsters/urlState.test.ts web/test/monsters/model.test.ts
git commit -m "feat(monsters): accept ascendant as a difficulty in core and the hash"
```

---

### Task 4: The derived equivalence note

**Files:**
- Create: `web/src/monsters/adapters/controlsView.ts`
- Modify: `web/src/monsters/app/main.ts:85-113`, `web/src/i18n/app.en.json`, `web/test/appCatalog.test.ts`, `web/src/monsters/monsters.css`
- Test: `web/test/monsters/controlsView.test.ts` (create)

**Interfaces:**
- Consumes: Task 3's `sameOffsets`, `offsetFor`
- Produces: `diffNoteMarkup(loc, diff, ascendant, ultimate): string`

- [ ] **Step 1: Write the failing test**

Create `web/test/monsters/controlsView.test.ts`:

```ts
// ABOUTME: Markup tests for the difficulty note, which must be derived from the data, never asserted.
// ABOUTME: Pins that the note disappears the moment the two offset rows diverge.
import { test, expect } from "bun:test";
import { diffNoteMarkup } from "../../src/monsters/adapters/controlsView";
import { DAMAGE_TYPES } from "../../src/monsters/core/facets";
import type { Localization } from "../../src/ports/Localization";
import type { Resistances } from "../../src/monsters/core/model";

const loc: Localization = { translate: (k) => k, gameText: (t) => t, locale: "en" };
const row = (over: Partial<Resistances> = {}) =>
  ({ ...Object.fromEntries(DAMAGE_TYPES.map((t) => [t, 8])), ...over }) as Resistances;

test("the note renders on ascendant when the two rows match", () => {
  expect(diffNoteMarkup(loc, "ascendant", row(), row())).toContain(
    "monsters.note.ascendantSameAsUltimate",
  );
});

test("the note is withheld when the rows differ", () => {
  // The whole point: a patch that gives ascendant its own offsets must silence
  // the claim without anyone editing app code.
  expect(diffNoteMarkup(loc, "ascendant", row({ fire: 9 }), row())).toBe("");
});

test("the note never renders on another difficulty", () => {
  expect(diffNoteMarkup(loc, "ultimate", row(), row())).toBe("");
  expect(diffNoteMarkup(loc, "normal", row(), row())).toBe("");
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `just check`
Expected: FAIL — cannot resolve `../../src/monsters/adapters/controlsView`

- [ ] **Step 3: Create the view**

`web/src/monsters/adapters/controlsView.ts`:

```ts
// ABOUTME: Markup for control-strip annotations that depend on the loaded dataset.
// ABOUTME: The difficulty note is computed from the offset rows, so it can never outlive its truth.
import { sameOffsets, type Difficulty, type Resistances } from "../core/model";
import type { Localization } from "../../ports/Localization";
import { esc } from "./markup";

/** A note under the difficulty select, rendered only while the data supports it.
 *
 *  Ascendant is a toggle layered on Ultimate in-game, and today it adds no
 *  resistance offset of its own. Rather than hardcode that, compare the rows: a
 *  reader who selects Ascendant and sees Ultimate's numbers otherwise cannot
 *  tell a genuine match from a page that failed to model Ascendant at all.
 */
export function diffNoteMarkup(
  loc: Localization,
  diff: Difficulty,
  ascendant: Resistances,
  ultimate: Resistances,
): string {
  if (diff !== "ascendant" || !sameOffsets(ascendant, ultimate)) return "";
  return `<span class="ctl-note">${esc(loc.translate("monsters.note.ascendantSameAsUltimate"))}</span>`;
}
```

- [ ] **Step 4: Add the catalog keys**

In `web/src/i18n/app.en.json`, after `"monsters.diff.ultimate": "Ultimate"`:

```json
  "monsters.diff.ascendant": "Ascendant",
  "monsters.note.ascendantSameAsUltimate": "In this dataset Ascendant applies the same resistance offsets as Ultimate.",
```

Add both keys to the list in `web/test/appCatalog.test.ts`, next to the other `monsters.diff.*` entries.

The wording states a fact about the data and nothing else — no claim about defensive ability, loot or spawns, none of which are derived here.

- [ ] **Step 5: Wire it into the controls**

In `web/src/monsters/app/main.ts`, add exactly one import line beside the other adapter imports (`:3-5`):

```ts
import { diffNoteMarkup } from "../adapters/controlsView";
```

Leave the existing `import { offsetFor, type Monster } from "../core/model";` at `:7` unchanged — `sameOffsets` is called inside `controlsView.ts`, not here.

In `controlsMarkup()`, replace the difficulty control block at `:90-92` with:

```ts
      `<div class="ctl"><span class="ctl-label">${esc(t("monsters.ctl.difficulty"))}</span>` +
      selectMarkup("mon-diff", [...DIFFICULTIES], view.diff, (d) => t(`monsters.diff.${d}`)) +
      diffNoteMarkup(
        localization,
        view.diff,
        offsetFor(doc, "ascendant", view.players),
        offsetFor(doc, "ultimate", view.players),
      ) +
      `</div>` +
```

- [ ] **Step 6: Style the note**

Append to the controls section of `web/src/monsters/monsters.css`, after the `.ctl-label` rule:

```css
.monsters-page .ctl-note {
  max-width: 24rem;
  font-size: 0.72rem;
  color: var(--mon-mut);
}
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `just check`
Expected: PASS, 0 fail, including the catalog guard

- [ ] **Step 8: Mutation-test the withholding**

Temporarily drop `|| !sameOffsets(ascendant, ultimate)` from Step 3's guard and run `just check`.
Expected: FAIL on `"the note is withheld when the rows differ"`. Restore and re-run to confirm PASS.

- [ ] **Step 9: Commit**

```bash
git add web/src/monsters/adapters/controlsView.ts web/test/monsters/controlsView.test.ts web/src/monsters/app/main.ts web/src/i18n/app.en.json web/test/appCatalog.test.ts web/src/monsters/monsters.css
git commit -m "feat(monsters): offer ascendant in the difficulty control with a derived note"
```

---

### Task 5: End-to-end coverage

**Files:**
- Modify: `web/e2e/mon-smoke.ts`

**Interfaces:**
- Consumes: everything above, through the built `web/dist`

- [ ] **Step 1: Add the checks**

In `web/e2e/mon-smoke.ts`, after the existing hash-restore check, add:

```ts
// Selecting Ascendant keeps the table populated and records itself in the hash.
await cdp.evaluate(`(() => {
  const s = document.querySelector('#mon-diff');
  s.value = 'ascendant';
  s.dispatchEvent(new Event('change'));
})()`);
const ascRows = await cdp.evaluate<number>("document.querySelectorAll('tbody tr').length");
check(ascRows > 100, `ascendant keeps the table populated (${ascRows})`);
check(
  (await cdp.evaluate<string>("location.hash")).includes("diff=ascendant"),
  "ascendant is recorded in the hash",
);
// The note is data-derived, so it must actually appear while the rows match.
const note = await cdp.evaluate<number>("document.querySelectorAll('.ctl-note').length");
check(note === 1, `the derived difficulty note renders on ascendant (${note})`);
```

- [ ] **Step 2: Run the suite**

Run: `just e2e`
Expected: `MONSTERS E2E PASS - 11/11 checks`, with planner 84/84 and RR 13/13 unchanged

- [ ] **Step 3: Commit**

```bash
git add web/e2e/mon-smoke.ts
git commit -m "test(monsters): cover the ascendant difficulty end to end"
```

---

### Task 6: Documentation

**Files:**
- Modify: `docs/superpowers/specs/2026-07-26-ascendant-difficulty-design.md` (status line)
- Check: `docs/i18n.md`, any doc naming the three difficulties

- [ ] **Step 1: Find stale difficulty claims**

Run: `grep -rn "normal, elite, ultimate\|three difficult" docs/ --include=*.md`
Expected: a list of reference docs to correct. Rewrite each affected sentence in place — these are living docs, so no dated "Update" sections.

- [ ] **Step 2: Mark the spec implemented**

Change the spec's `**Status:** proposed` to `**Status:** implemented 2026-07-26`.

- [ ] **Step 3: Final verification**

Run: `just check && just test-scripts && just diff-data && just e2e`
Expected: all green; `diff-data` reports `MONSTERS: +0 new, -0 removed, 0 changed` against the now-committed baseline and `DIFFICULTY OFFSETS: 0 changed`

- [ ] **Step 4: Commit**

```bash
git add docs/
git commit -m "docs: record the ascendant difficulty design as implemented"
```
