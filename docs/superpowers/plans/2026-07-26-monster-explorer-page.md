# Monster Resistance Explorer Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `/monster-resistances`, a third page beside the planner and the resistance-reduction reference, that ranks the ten damage types by how little enemies resist them and lets a player drill into the 1,635 surveyed monsters.

**Architecture:** Mirrors `web/src/rr/`. Page code lives under `web/src/monsters/{core,adapters,app}`; core is pure and locale-independent (it computes over numbers and takes injected name resolvers), adapters render and resolve text through the `Localization` port, and `app/main.ts` owns the render loop and the URL round-trip. Shared chrome comes from `web/src/core/` and `web/src/adapters/`, exactly as RR imports it.

**Tech Stack:** TypeScript, Bun (bundler + test runner), Biome (format/lint), plain DOM (no framework), Python 3.10+ via `uv` for the one pipeline change.

**Spec:** `docs/superpowers/specs/2026-07-26-monster-explorer-page-design.md`

**Branch:** `monster-resistance-pipeline` (continues the monster initiative; do not create a new branch)

## Global Constraints

- **Follow the RR page's structure.** When in doubt about a pattern, read the `web/src/rr/` equivalent and match it. That page is the worked example for every invariant here.
- **Core is i18n-free.** No module under `web/src/monsters/core/` may import a localization module or contain a user-facing string. Search and sort take injected resolver callbacks (`nameOf`), exactly as `rr/core/filter.ts` does.
- **No user-facing literal in app code.** Adapters resolve every string through the `Localization` port. New keys go in `web/src/i18n/app.en.json` under the `monsters.` prefix and are added to `REQUIRED` in `web/test/appCatalog.test.ts`. Only English is required; the other twelve locales fall back.
- **All view state round-trips through the URL hash.** Keys exactly: `diff`, `players`, `tier`, `role`, `q`, `minlv`, `summons`, `auras`, `sort`. Values at their default are omitted. Decoding never throws on garbage.
- **Every file starts with two `# ABOUTME: ` lines** (`// ABOUTME: ` in TypeScript, `/* ABOUTME: */` in CSS).
- **The ten damage types, in this exact order everywhere:** `physical`, `pierce`, `fire`, `cold`, `lightning`, `poison`, `aether`, `chaos`, `vitality`, `bleeding`.
- **The thirteen histogram buckets, in this exact order:** `<0`, `0`, `1-9`, `10-19`, `20-29`, `30-39`, `40-49`, `50-59`, `60-69`, `70-79`, `80-89`, `90-99`, `100+`. Computed on the effective value.
- **Effective resistance** is `base + offset[difficulty][players]`, plus `aura_resistances` when the aura toggle is on.
- **Defaults:** difficulty `ultimate`, players `1`, table sort `name` ascending, aura toggle off, all facet sets empty (meaning "all").
- **Palette** (from `web/src/styles.css`, mirrored by `web/src/rr/rr.css`): background `#0d1117`, panel `#161b22`, rule `#30363d`, ink `#e6edf3`, muted `#9aa4b2`, ember `#f0c14b`. Font `system-ui` at `14px/1.45`, `ui-monospace` for figures. Dark only; there is no theme switch.
- **Row counts after Task 1:** 1,635 logical monsters, 2,728 raw records unchanged.
- **Python runs via `uv`.** Bare `python`/`python3` fails on this machine (exit 49).
- **Gates:** `just test-scripts` (Python suites), `just check` (format, web tests, lint, typecheck), `just diff-data`. A pre-commit hook runs `just check`, so commits are slow; allow 600000 ms and never use `--no-verify`.

---

### Task 1: Exclude traps from the dataset

A pipeline change, not a page change. Two rows are traps rather than monsters and distort every aggregate the page computes.

**Files:**
- Modify: `scripts/parse_monsters.py` (`exclusion_reason`)
- Modify: `scripts/test_parse_monsters.py`
- Modify: `data/monsters.json` (regenerated)

**Interfaces:**
- Consumes: `exclusion_reason(rel_path, rec, tags) -> str | None`, `role_of`, `VALID_CLASSIFICATIONS` (all existing).
- Produces: a new exclusion reason string `"trap"`. Dataset row count becomes 1,635.

- [ ] **Step 1: Write the failing test**

Append to `scripts/test_parse_monsters.py`, immediately before the final `print("FAILURES:", failures)` line:

```python
# --- Task 1 (explorer): traps are excluded, monsters merely named "trap" are not ---
check("a trap_ prefixed record is excluded",
      mon.exclusion_reason("enemies/trap_mineexplosive_a01.dbr", rec(), TAGS) == "trap")
check("a trap_ prefixed record in a subdir is excluded",
      mon.exclusion_reason("enemies/special/trap_foo_01.dbr", rec(), TAGS) == "trap")
check("a monster merely named with trap inside is kept",
      mon.exclusion_reason("enemies/boss&quest/ghost_ugdenbogtrap_01.dbr", rec(), TAGS) is None)
check("a monster whose name starts with a trap-like word is kept",
      mon.exclusion_reason("enemies/boss&quest/trapdoorspider_01.dbr", rec(), TAGS) is None)
check("rule order: a non-monster record is still reported as such, not as a trap",
      mon.exclusion_reason("enemies/trap_x.dbr", rec(Class="ProxyPool"), TAGS) == "not a monster record")
```

Note the fourth check: `trapdoorspider_01` starts with `trap` but not with `trap_`, so the underscore is load-bearing and the test pins it.

- [ ] **Step 2: Run the test to verify it fails**

Run: `uv run scripts/test_parse_monsters.py`
Expected: FAIL on "a trap_ prefixed record is excluded" (it currently returns `None`).

- [ ] **Step 3: Write the implementation**

In `scripts/parse_monsters.py`, in `exclusion_reason`, insert this rule immediately after the `devotion role` rule and before the `monsterClassification` rule:

```python
    if rel_path.rsplit("/", 1)[-1].startswith("trap_"):
        # Traps are level furniture, not monsters: mine_explosive carries 500 in nine of ten
        # types and would distort every aggregate. Matched on the filename prefix, never as a
        # substring: "trap" appears inside five real monsters (three Ugdenbog ghosts,
        # chthonianfiend_trappedandalone_01, chthonianservitor_mourndaletrap).
        return "trap"
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `uv run scripts/test_parse_monsters.py`
Expected: the five new checks print `ok`.

The suite will still FAIL on the pre-existing row-count assertions, which is correct and expected: they pin 1,637 and the dataset is now 1,635. Fix them in the next step.

- [ ] **Step 5: Update the row-count assertions**

In `scripts/test_parse_monsters.py`, the Task 2 integration block asserts the dataset row count. Change:

```python
check(f"row count unchanged (got {len(m3)})", len(m3) == 1637)
```

to:

```python
check(f"row count is the post-trap-exclusion total (got {len(m3)})", len(m3) == 1635)
```

The raw record count assertion stays at 2,728: excluded records are still read and counted as raw input, so that number must NOT move. If it does, stop and report.

Also update the bleeding-band comment block, which cites the row total. Change the sentence reading `245 logical rows cover 533 raw records` to `245 logical rows cover 533 raw records (of 1,635 rows after the trap exclusion)`.

- [ ] **Step 6: Run the test again**

Run: `uv run scripts/test_parse_monsters.py`
Expected: every check prints `ok`, final line `FAILURES: 0`.

- [ ] **Step 7: Regenerate the dataset and verify the change is exactly two rows**

```bash
just parse-monsters
jq '.monsters | length' data/monsters.json
jq -r '.monsters[] | select(.record_paths[0] | test("/trap_")) | .id' data/monsters.json
jq -r '[.monsters[] | select(.name_tag == "tagBloodswornBoss02")] | length' data/monsters.json
```

Expected: `1635`; the second command prints nothing (no trap rows remain); the third prints `1` (Karroz still present).

The parser summary must now include `- trap: 2` in its exclusion breakdown.

- [ ] **Step 8: Confirm the diff is exactly the two removals**

Run: `just diff-data`
Expected: `MONSTERS: +0 new, -2 removed, 0 changed` and `DIFFICULTY OFFSETS: 0 changed`. A nonzero `new` or `changed` count means the rule caught more than intended: STOP and report rather than accepting it.

- [ ] **Step 9: Commit**

```bash
git add scripts/parse_monsters.py scripts/test_parse_monsters.py data/monsters.json
git commit -m "feat(monsters): exclude traps from the surveyed population"
```

---

### Task 2: Extract the shared hash codec

`putSet` and `readSet` are identical in both pages and encode the URL round-trip tolerance this project maintains as an invariant. One definition, imported by both.

**Files:**
- Create: `web/src/core/hashCodec.ts`
- Modify: `web/src/rr/core/urlState.ts` (delete the two local copies, import instead)
- Create: `web/test/hashCodec.test.ts`

**Interfaces:**
- Produces: `putSet(parts: string[], key: string, set: Set<string>): void` and `readSet(val: string, allowed: Set<string>): Set<string>`, both exported from `web/src/core/hashCodec.ts`.

- [ ] **Step 1: Write the failing test**

Create `web/test/hashCodec.test.ts`:

```typescript
// ABOUTME: Tests for the shared URL-hash set codec used by every faceted page.
// ABOUTME: Pins the tolerance contract: a bad token drops itself, never the whole list.
import { test, expect } from "bun:test";
import { putSet, readSet } from "../src/core/hashCodec";

test("putSet omits an empty set and emits a populated one", () => {
  const parts: string[] = [];
  putSet(parts, "tier", new Set());
  expect(parts).toEqual([]);
  putSet(parts, "tier", new Set(["Hero", "Boss"]));
  expect(parts).toEqual(["tier=Hero,Boss"]);
});

test("putSet percent-encodes values that would break the hash grammar", () => {
  const parts: string[] = [];
  putSet(parts, "role", new Set(["boss&quest"]));
  expect(parts[0]).toBe("role=boss%26quest");
});

test("readSet keeps only allowed values and decodes them", () => {
  const allowed = new Set(["boss&quest", "hero"]);
  expect(readSet("boss%26quest,hero", allowed)).toEqual(new Set(["boss&quest", "hero"]));
  expect(readSet("hero,bogus", allowed)).toEqual(new Set(["hero"]));
});

test("a single undecodable token drops itself, not the whole list", () => {
  // "%%%" throws in decodeURIComponent; "hero" beside it must still survive.
  expect(readSet("%%%,hero", new Set(["hero"]))).toEqual(new Set(["hero"]));
});

test("an empty value decodes to an empty set", () => {
  expect(readSet("", new Set(["hero"]))).toEqual(new Set());
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd web && bun test test/hashCodec.test.ts`
Expected: FAIL, cannot resolve `../src/core/hashCodec`.

- [ ] **Step 3: Create the shared module**

Create `web/src/core/hashCodec.ts`:

```typescript
// ABOUTME: Shared URL-hash codec helpers for multi-select facets, used by every faceted page.
// ABOUTME: Pure and locale-independent; the tolerance rules here are a project-wide invariant.

/** Append `key=a,b,c` to `parts` when the set is non-empty; a set at its empty default is omitted. */
export function putSet(parts: string[], key: string, set: Set<string>): void {
  if (set.size) parts.push(`${key}=${[...set].map(encodeURIComponent).join(",")}`);
}

/** Decode a comma-joined hash value, keeping only members of `allowed`.
 *
 *  A token that fails to decode is skipped individually rather than discarding the whole
 *  list, so one malformed value in a shared link cannot wipe out the user's other filters.
 */
export function readSet(val: string, allowed: Set<string>): Set<string> {
  const out = new Set<string>();
  for (const raw of val.split(",")) {
    let t: string;
    try {
      t = decodeURIComponent(raw);
    } catch {
      continue;
    }
    if (allowed.has(t)) out.add(t);
  }
  return out;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd web && bun test test/hashCodec.test.ts`
Expected: 5 pass, 0 fail.

- [ ] **Step 5: Point the RR page at the shared module**

In `web/src/rr/core/urlState.ts`, delete the local `putSet` and `readSet` function definitions (they sit between the `DMG_VALUES` const and `encodeHash`) and add this import beneath the existing `./facets` import:

```typescript
import { putSet, readSet } from "../../core/hashCodec";
```

Change nothing else in that file. The call sites already match the shared signatures.

- [ ] **Step 6: Verify the RR page is unchanged in behaviour**

Run: `cd web && bun test test/rr/`
Expected: every RR suite passes, unchanged. These tests are the proof the extraction was behaviour-preserving, so a failure here means the move was not clean.

- [ ] **Step 7: Commit**

```bash
git add web/src/core/hashCodec.ts web/src/rr/core/urlState.ts web/test/hashCodec.test.ts
git commit -m "refactor(web): share the URL-hash set codec between faceted pages"
```

---

### Task 3: Monster model and facets

Types, constants, the JSON parse, and the two value transforms (difficulty offset, aura inclusion).

**Files:**
- Create: `web/src/monsters/core/facets.ts`
- Create: `web/src/monsters/core/model.ts`
- Create: `web/test/monsters/model.test.ts`

**Interfaces:**
- Produces, from `facets.ts`: the readonly tuples `DAMAGE_TYPES` and `DIFFICULTIES`, their derived types `DamageType` and `Difficulty`, plus `TIERS: string[]` and `PLAYER_COUNTS: string[]`. `facets.ts` imports nothing from `model.ts`; the dependency runs one way only.
- Produces, from `model.ts`: `Resistances = Record<DamageType, number>`, `Monster`, `MonsterDoc`, a re-export of the `DamageType` and `Difficulty` types; `parseMonsters(doc: unknown): MonsterDoc`; `offsetFor(doc, difficulty, players): Resistances`; `effective(m, offsets, includeAuras): Resistances`.

- [ ] **Step 1: Write the failing test**

Create `web/test/monsters/model.test.ts`:

```typescript
// ABOUTME: Tests for the monster model: parsing, difficulty offsets, and aura inclusion.
// ABOUTME: These pin the effective-resistance formula the whole page depends on.
import { test, expect } from "bun:test";
import { parseMonsters, offsetFor, effective, type Monster } from "../../src/monsters/core/model";
import { DAMAGE_TYPES } from "../../src/monsters/core/facets";

const ZERO = Object.fromEntries(DAMAGE_TYPES.map((t) => [t, 0]));

function mon(over: Partial<Monster> = {}): Monster {
  return {
    id: "enemies.x",
    nameTag: "tagX",
    classification: "Hero",
    role: "hero",
    raceTag: null,
    minLevel: 1,
    maxLevel: 100,
    isSummon: false,
    variantCount: 1,
    variantsDisagree: false,
    resistances: { ...ZERO },
    passive: {},
    aura: {},
    ...over,
  } as Monster;
}

const DOC = {
  meta: { game_version: "1.3.0.0" },
  monsters: [
    {
      id: "enemies.a",
      name_tag: "tagA",
      classification: "Hero",
      role: "hero",
      race_tag: "tagRace005",
      min_level: 1,
      max_level: 100,
      is_summon: false,
      variant_count: 2,
      variants_disagree: true,
      resistances: { ...ZERO, fire: 30, bleeding: 80 },
      passive_resistances: { bleeding: 80 },
      aura_resistances: { cold: 20 },
    },
  ],
  difficulty_offsets: {
    ultimate: { "1": { ...ZERO, fire: 8, cold: 5 }, "4": { ...ZERO, fire: 15, cold: 12 } },
    normal: { "1": { ...ZERO } },
  },
};

test("parseMonsters maps snake_case to camelCase and defaults the sparse objects", () => {
  const doc = parseMonsters(DOC);
  expect(doc.monsters).toHaveLength(1);
  const m = doc.monsters[0]!;
  expect(m.nameTag).toBe("tagA");
  expect(m.raceTag).toBe("tagRace005");
  expect(m.variantsDisagree).toBe(true);
  expect(m.passive).toEqual({ bleeding: 80 });
  expect(m.aura).toEqual({ cold: 20 });
  expect(doc.meta.game_version).toBe("1.3.0.0");
});

test("a monster with no provenance gets empty objects, not undefined", () => {
  const doc = parseMonsters({ ...DOC, monsters: [{ ...DOC.monsters[0], passive_resistances: undefined, aura_resistances: undefined }] });
  expect(doc.monsters[0]!.passive).toEqual({});
  expect(doc.monsters[0]!.aura).toEqual({});
});

test("parseMonsters throws on a non-object, and on a doc with no monsters array", () => {
  expect(() => parseMonsters(null)).toThrow();
  expect(() => parseMonsters({ meta: {} })).toThrow();
});

test("offsetFor selects the difficulty and player bracket", () => {
  const doc = parseMonsters(DOC);
  expect(offsetFor(doc, "ultimate", "1").fire).toBe(8);
  expect(offsetFor(doc, "ultimate", "4").fire).toBe(15);
  expect(offsetFor(doc, "normal", "1").fire).toBe(0);
});

test("offsetFor falls back to all-zero for a difficulty or bracket the data lacks", () => {
  const doc = parseMonsters(DOC);
  expect(offsetFor(doc, "elite", "1")).toEqual(ZERO as Record<string, number>);
  expect(offsetFor(doc, "normal", "3")).toEqual(ZERO as Record<string, number>);
});

test("effective adds the offset to the base for every type", () => {
  const off = { ...ZERO, fire: 8, cold: 5 } as Record<string, number>;
  const e = effective(mon({ resistances: { ...ZERO, fire: 30 } as Monster["resistances"] }), off, false);
  expect(e.fire).toBe(38);
  expect(e.cold).toBe(5);
});

test("effective excludes auras by default and includes them when asked", () => {
  const m = mon({ resistances: { ...ZERO, cold: 10 } as Monster["resistances"], aura: { cold: 20 } });
  expect(effective(m, ZERO as Record<string, number>, false).cold).toBe(10);
  expect(effective(m, ZERO as Record<string, number>, true).cold).toBe(30);
});

test("including auras stacks with the difficulty offset", () => {
  const m = mon({ resistances: { ...ZERO, cold: 10 } as Monster["resistances"], aura: { cold: 20 } });
  expect(effective(m, { ...ZERO, cold: 5 } as Record<string, number>, true).cold).toBe(35);
});

test("effective always returns all ten keys in the canonical order", () => {
  expect(Object.keys(effective(mon(), ZERO as Record<string, number>, false))).toEqual(DAMAGE_TYPES);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd web && bun test test/monsters/model.test.ts`
Expected: FAIL, cannot resolve `../../src/monsters/core/model`.

- [ ] **Step 3: Create the facets module**

Create `web/src/monsters/core/facets.ts`:

```typescript
// ABOUTME: Single source of truth for the monster page's ordered facet lists and damage types.
// ABOUTME: The DamageType and Difficulty types derive from these lists, so there is one definition.
//
// This module owns both the constants and the types derived from them, and imports nothing from
// ./model. model.ts imports from here. Defining the type in model.ts and the array here would
// make the two files import each other, which survives only because type imports are erased.

/** The ten damage types, in the order every table column, ranking row and offset array uses. */
export const DAMAGE_TYPES = [
  "physical",
  "pierce",
  "fire",
  "cold",
  "lightning",
  "poison",
  "aether",
  "chaos",
  "vitality",
  "bleeding",
] as const;

export type DamageType = (typeof DAMAGE_TYPES)[number];

/** The six monster classifications, ordered weakest to strongest rather than alphabetically. */
export const TIERS = ["Common", "Champion", "Hero", "Boss", "SuperBoss", "Quest"];

export const DIFFICULTIES = ["normal", "elite", "ultimate"] as const;

export type Difficulty = (typeof DIFFICULTIES)[number];

export const PLAYER_COUNTS = ["1", "2", "3", "4"];
```

Because `DAMAGE_TYPES` is `as const`, it is a readonly tuple. Where a mutable `string[]` is
needed (for example spreading into a `Set`), spread it: `[...DAMAGE_TYPES]`.

- [ ] **Step 4: Create the model module**

Create `web/src/monsters/core/model.ts`:

```typescript
// ABOUTME: The Monster type, the monsters.json parse, and the effective-resistance transforms.
// ABOUTME: Pure and locale-independent: names stay as tags here and resolve in the adapters.
import { DAMAGE_TYPES, type DamageType, type Difficulty } from "./facets";

export type { DamageType, Difficulty };

export type Resistances = Record<DamageType, number>;

/** One logical monster as emitted by scripts/parse_monsters.py, in camelCase. */
export interface Monster {
  id: string;
  nameTag: string;
  classification: string;
  role: string;
  raceTag: string | null;
  minLevel: number;
  maxLevel: number;
  isSummon: boolean;
  variantCount: number;
  variantsDisagree: boolean;
  /** Inline plus resident passives, as shipped. Always carries all ten keys. */
  resistances: Resistances;
  /** Sparse: only the types a passive skill contributed to. */
  passive: Partial<Resistances>;
  /** Sparse: aura grants, deliberately NOT included in `resistances`. */
  aura: Partial<Resistances>;
}

export interface MonsterDoc {
  meta: Record<string, unknown>;
  monsters: Monster[];
  offsets: Record<string, Record<string, Partial<Resistances>>>;
}

interface RawMonster {
  id: string;
  name_tag: string;
  classification: string;
  role: string;
  race_tag: string | null;
  min_level: number;
  max_level: number;
  is_summon: boolean;
  variant_count: number;
  variants_disagree: boolean;
  resistances: Resistances;
  passive_resistances?: Partial<Resistances>;
  aura_resistances?: Partial<Resistances>;
}

function mapMonster(r: RawMonster): Monster {
  return {
    id: r.id,
    nameTag: r.name_tag,
    classification: r.classification,
    role: r.role,
    raceTag: r.race_tag ?? null,
    minLevel: r.min_level ?? 0,
    maxLevel: r.max_level ?? 0,
    isSummon: r.is_summon ?? false,
    variantCount: r.variant_count ?? 1,
    variantsDisagree: r.variants_disagree ?? false,
    resistances: r.resistances,
    // Sparse by contract: absent means "nothing granted", which is an empty object here
    // so every consumer can index it without a null check.
    passive: r.passive_resistances ?? {},
    aura: r.aura_resistances ?? {},
  };
}

/** Parse the `{meta, monsters, difficulty_offsets}` doc.
 *
 *  Throws when the document is not an object or carries no monsters array. A dataset that
 *  parses but is structurally wrong should fail loudly at load rather than render blank cells.
 */
export function parseMonsters(doc: unknown): MonsterDoc {
  if (typeof doc !== "object" || doc === null) {
    throw new Error("monsters doc must be an object");
  }
  const d = doc as {
    meta?: Record<string, unknown>;
    monsters?: RawMonster[];
    difficulty_offsets?: Record<string, Record<string, Partial<Resistances>>>;
  };
  if (!Array.isArray(d.monsters)) {
    throw new Error("monsters doc must carry a monsters array");
  }
  return {
    meta: d.meta ?? {},
    monsters: d.monsters.map(mapMonster),
    offsets: d.difficulty_offsets ?? {},
  };
}

const ZERO_OFFSETS: Resistances = Object.fromEntries(DAMAGE_TYPES.map((t) => [t, 0])) as Resistances;

/** The flat global offset for a difficulty and player count, all-zero when the data lacks it.
 *
 *  A missing bracket is not an error: Normal at three players is simply absent in some
 *  datasets, and reporting the base value is more useful than refusing to render.
 */
export function offsetFor(doc: MonsterDoc, difficulty: Difficulty, players: string): Resistances {
  const raw = doc.offsets[difficulty]?.[players];
  if (!raw) return { ...ZERO_OFFSETS };
  return Object.fromEntries(DAMAGE_TYPES.map((t) => [t, raw[t] ?? 0])) as Resistances;
}

/** What a player actually faces: base plus offset, plus aura grants when included.
 *
 *  Always returns all ten keys in canonical order so callers can index without checking.
 */
export function effective(m: Monster, offsets: Resistances, includeAuras: boolean): Resistances {
  return Object.fromEntries(
    DAMAGE_TYPES.map((t) => [t, m.resistances[t] + offsets[t] + (includeAuras ? (m.aura[t] ?? 0) : 0)]),
  ) as Resistances;
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd web && bun test test/monsters/model.test.ts`
Expected: 9 pass, 0 fail.

- [ ] **Step 6: Commit**

```bash
git add web/src/monsters/core/facets.ts web/src/monsters/core/model.ts web/test/monsters/model.test.ts
git commit -m "feat(monsters): monster model, facets, and effective-resistance transforms"
```

---

### Task 4: Distribution statistics

Mean, median, and the thirteen-bucket histogram, with a shared peak across all ten types.

**Files:**
- Create: `web/src/monsters/core/stats.ts`
- Create: `web/test/monsters/stats.test.ts`

**Interfaces:**
- Consumes: `DAMAGE_TYPES` from `./facets`; `Monster`, `Resistances`, `effective` from `./model`.
- Produces: `BUCKETS: Bucket[]` where `Bucket = { lo: number; hi: number; key: string }`; `TypeStats = { type: DamageType; mean: number; median: number; counts: number[] }`; `rankTypes(rows, offsets, includeAuras): { stats: TypeStats[]; peak: number } | null`.

- [ ] **Step 1: Write the failing test**

Create `web/test/monsters/stats.test.ts`:

```typescript
// ABOUTME: Tests for the ranking statistics: mean, median, bucket edges, and the shared peak.
// ABOUTME: The empty-set case is pinned here because a NaN mean would render as a broken chart.
import { test, expect } from "bun:test";
import { BUCKETS, rankTypes } from "../../src/monsters/core/stats";
import { DAMAGE_TYPES } from "../../src/monsters/core/facets";
import type { Monster, Resistances } from "../../src/monsters/core/model";

const ZERO = Object.fromEntries(DAMAGE_TYPES.map((t) => [t, 0])) as Resistances;

function mon(res: Partial<Resistances>, over: Partial<Monster> = {}): Monster {
  return {
    id: "enemies.x",
    nameTag: "tagX",
    classification: "Hero",
    role: "hero",
    raceTag: null,
    minLevel: 1,
    maxLevel: 100,
    isSummon: false,
    variantCount: 1,
    variantsDisagree: false,
    resistances: { ...ZERO, ...res },
    passive: {},
    aura: {},
    ...over,
  };
}

test("there are thirteen buckets in the specified order", () => {
  expect(BUCKETS.map((b) => b.key)).toEqual([
    "<0", "0", "1-9", "10-19", "20-29", "30-39", "40-49",
    "50-59", "60-69", "70-79", "80-89", "90-99", "100+",
  ]);
});

test("bucket edges are contiguous and cover every real value exactly once", () => {
  const probes = [-50, -1, 0, 1, 9, 10, 55, 99, 100, 500];
  for (const v of probes) {
    const hits = BUCKETS.filter((b) => v >= b.lo && v < b.hi);
    expect(hits).toHaveLength(1);
  }
});

test("rankTypes orders by mean ascending, weakest first", () => {
  const rows = [mon({ fire: 90, cold: 10 }), mon({ fire: 70, cold: 0 })];
  const r = rankTypes(rows, ZERO, false)!;
  expect(r.stats[0]!.type).toBe("physical"); // all zero, so it ties at the bottom
  const fire = r.stats.find((s) => s.type === "fire")!;
  const cold = r.stats.find((s) => s.type === "cold")!;
  expect(fire.mean).toBe(80);
  expect(cold.mean).toBe(5);
  expect(r.stats.indexOf(cold)).toBeLessThan(r.stats.indexOf(fire));
});

test("median is the middle value for odd counts and the midpoint for even", () => {
  const odd = rankTypes([mon({ fire: 10 }), mon({ fire: 20 }), mon({ fire: 90 })], ZERO, false)!;
  expect(odd.stats.find((s) => s.type === "fire")!.median).toBe(20);
  const even = rankTypes([mon({ fire: 10 }), mon({ fire: 20 })], ZERO, false)!;
  expect(even.stats.find((s) => s.type === "fire")!.median).toBe(15);
});

test("counts land in the right buckets, including negative and 100+", () => {
  const rows = [mon({ fire: -20 }), mon({ fire: 0 }), mon({ fire: 5 }), mon({ fire: 95 }), mon({ fire: 250 })];
  const fire = rankTypes(rows, ZERO, false)!.stats.find((s) => s.type === "fire")!;
  const byKey = Object.fromEntries(BUCKETS.map((b, i) => [b.key, fire.counts[i]]));
  expect(byKey["<0"]).toBe(1);
  expect(byKey["0"]).toBe(1);
  expect(byKey["1-9"]).toBe(1);
  expect(byKey["90-99"]).toBe(1);
  expect(byKey["100+"]).toBe(1);
});

test("every type's counts sum to the row count", () => {
  const rows = [mon({ fire: 10 }), mon({ cold: -5 }), mon({ vitality: 300 })];
  const r = rankTypes(rows, ZERO, false)!;
  for (const s of r.stats) {
    expect(s.counts.reduce((a, b) => a + b, 0)).toBe(rows.length);
  }
});

test("peak is the tallest bucket across all ten types, not per type", () => {
  // Nine types sit entirely in the "0" bucket (3 rows); fire spreads across three buckets.
  const rows = [mon({ fire: 10 }), mon({ fire: 20 }), mon({ fire: 30 })];
  const r = rankTypes(rows, ZERO, false)!;
  expect(r.peak).toBe(3);
});

test("the difficulty offset shifts values into different buckets", () => {
  const rows = [mon({ fire: 0 })];
  const shifted = rankTypes(rows, { ...ZERO, fire: 8 } as Resistances, false)!;
  const fire = shifted.stats.find((s) => s.type === "fire")!;
  const byKey = Object.fromEntries(BUCKETS.map((b, i) => [b.key, fire.counts[i]]));
  expect(byKey["0"]).toBe(0);
  expect(byKey["1-9"]).toBe(1);
});

test("including auras changes the mean", () => {
  const rows = [mon({ cold: 10 }, { aura: { cold: 20 } })];
  expect(rankTypes(rows, ZERO, false)!.stats.find((s) => s.type === "cold")!.mean).toBe(10);
  expect(rankTypes(rows, ZERO, true)!.stats.find((s) => s.type === "cold")!.mean).toBe(30);
});

test("an empty row set returns null rather than NaN statistics", () => {
  expect(rankTypes([], ZERO, false)).toBeNull();
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd web && bun test test/monsters/stats.test.ts`
Expected: FAIL, cannot resolve `../../src/monsters/core/stats`.

- [ ] **Step 3: Write the implementation**

Create `web/src/monsters/core/stats.ts`:

```typescript
// ABOUTME: Ranking statistics for the monster page: mean, median, and the shared-scale histogram.
// ABOUTME: Pure; returns null for an empty population so the view can show an honest empty state.
import { DAMAGE_TYPES } from "./facets";
import { effective, type DamageType, type Monster, type Resistances } from "./model";

export interface Bucket {
  /** Inclusive lower edge. */
  lo: number;
  /** Exclusive upper edge. */
  hi: number;
  key: string;
}

/** Thirteen contiguous buckets over the effective value.
 *
 *  `<0` is kept separate from `0` because a negative resistance means the monster takes
 *  extra damage, which is the opposite conclusion from merely having none.
 */
export const BUCKETS: Bucket[] = [
  { lo: -Infinity, hi: 0, key: "<0" },
  { lo: 0, hi: 1, key: "0" },
  { lo: 1, hi: 10, key: "1-9" },
  { lo: 10, hi: 20, key: "10-19" },
  { lo: 20, hi: 30, key: "20-29" },
  { lo: 30, hi: 40, key: "30-39" },
  { lo: 40, hi: 50, key: "40-49" },
  { lo: 50, hi: 60, key: "50-59" },
  { lo: 60, hi: 70, key: "60-69" },
  { lo: 70, hi: 80, key: "70-79" },
  { lo: 80, hi: 90, key: "80-89" },
  { lo: 90, hi: 100, key: "90-99" },
  { lo: 100, hi: Infinity, key: "100+" },
];

export interface TypeStats {
  type: DamageType;
  mean: number;
  median: number;
  /** One count per entry of BUCKETS, same order. */
  counts: number[];
}

function bucketIndex(v: number): number {
  for (let i = 0; i < BUCKETS.length; i++) {
    const b = BUCKETS[i]!;
    if (v >= b.lo && v < b.hi) return i;
  }
  // Unreachable: the edges are contiguous from -Infinity to Infinity.
  return BUCKETS.length - 1;
}

/** Per-type statistics over a population, sorted by mean ascending, plus the shared bar scale.
 *
 *  `peak` is the tallest bucket across ALL types, not per type: the ten histograms share one
 *  vertical scale so their shapes compare directly, which is the point of showing them together.
 *
 *  Returns null for an empty population, because a mean over zero rows is not a number and a
 *  zero-filled chart would read as "no resistance" rather than "no data".
 */
export function rankTypes(
  rows: Monster[],
  offsets: Resistances,
  includeAuras: boolean,
): { stats: TypeStats[]; peak: number } | null {
  if (!rows.length) return null;

  // One pass over the rows building every type's values at once, rather than ten passes.
  const values: number[][] = DAMAGE_TYPES.map(() => []);
  for (const m of rows) {
    const e = effective(m, offsets, includeAuras);
    for (let i = 0; i < DAMAGE_TYPES.length; i++) values[i]!.push(e[DAMAGE_TYPES[i]!]);
  }

  let peak = 0;
  const stats: TypeStats[] = DAMAGE_TYPES.map((type, i) => {
    const vals = values[i]!;
    const counts = BUCKETS.map(() => 0);
    let sum = 0;
    for (const v of vals) {
      sum += v;
      counts[bucketIndex(v)]!++;
    }
    for (const n of counts) if (n > peak) peak = n;
    const sorted = [...vals].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    const median = sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
    return { type, mean: sum / vals.length, median, counts };
  });

  // Ties break on the canonical type order so the ranking is deterministic run to run.
  stats.sort((a, b) => a.mean - b.mean || DAMAGE_TYPES.indexOf(a.type) - DAMAGE_TYPES.indexOf(b.type));
  return { stats, peak };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd web && bun test test/monsters/stats.test.ts`
Expected: 10 pass, 0 fail.

- [ ] **Step 5: Commit**

```bash
git add web/src/monsters/core/stats.ts web/test/monsters/stats.test.ts
git commit -m "feat(monsters): distribution statistics for the type ranking"
```

---

### Task 5: View state and filtering

`ViewState`, the hash codec, and the pure filter/sort.

**Files:**
- Create: `web/src/monsters/core/urlState.ts`
- Create: `web/src/monsters/core/filter.ts`
- Create: `web/test/monsters/urlState.test.ts`
- Create: `web/test/monsters/filter.test.ts`

**Interfaces:**
- Consumes: `putSet`/`readSet` from `../../core/hashCodec`; `DAMAGE_TYPES`, `TIERS`, `DIFFICULTIES`, `PLAYER_COUNTS` from `./facets`; `Monster`, `Difficulty`, `Resistances`, `effective` from `./model`.
- Produces: `ViewState`, `DEFAULT_VIEW`, `encodeHash(view): string`, `decodeHash(hash, knownRoles): ViewState`, and `applyView(rows, view, offsets, nameOf): Monster[]`.

- [ ] **Step 1: Write the failing tests**

Create `web/test/monsters/urlState.test.ts`:

```typescript
// ABOUTME: Round-trip and tolerance tests for the monster page's view-state hash codec.
// ABOUTME: Every control must survive a copied link, and a stale link must never throw.
import { test, expect } from "bun:test";
import { encodeHash, decodeHash, DEFAULT_VIEW, type ViewState } from "../../src/monsters/core/urlState";

const ROLES = new Set(["hero", "nemesis", "boss&quest"]);

test("encode then decode is identity over a fully populated view", () => {
  const v: ViewState = {
    ...DEFAULT_VIEW,
    diff: "elite",
    players: "3",
    tiers: new Set(["Hero", "Boss"]),
    roles: new Set(["nemesis"]),
    q: "kaisan",
    minLevel: 75,
    hideSummons: true,
    includeAuras: true,
    sortKey: "fire",
    sortDir: -1,
  };
  expect(decodeHash(encodeHash(v), ROLES)).toEqual(v);
});

test("the default view encodes to an empty hash", () => {
  expect(encodeHash(DEFAULT_VIEW)).toBe("");
});

test("only non-default values appear in the hash", () => {
  const h = encodeHash({ ...DEFAULT_VIEW, q: "fire" });
  expect(h).toBe("q=fire");
});

test("a garbage hash decodes to the default view", () => {
  expect(decodeHash("%%%bad", ROLES)).toEqual(DEFAULT_VIEW);
  expect(decodeHash("", ROLES)).toEqual(DEFAULT_VIEW);
  expect(decodeHash("#", ROLES)).toEqual(DEFAULT_VIEW);
});

test("unknown keys are ignored without disturbing known ones", () => {
  const back = decodeHash("q=alkamos&bogus=1&legacyKey=x", ROLES);
  expect(back.q).toBe("alkamos");
  expect(back).toEqual({ ...DEFAULT_VIEW, q: "alkamos" });
});

test("an unknown tier or role token is dropped, valid ones survive", () => {
  const back = decodeHash("tier=Hero,Nonsense&role=nemesis,notarole", ROLES);
  expect(back.tiers).toEqual(new Set(["Hero"]));
  expect(back.roles).toEqual(new Set(["nemesis"]));
});

test("a role needing escaping round-trips", () => {
  const v: ViewState = { ...DEFAULT_VIEW, roles: new Set(["boss&quest"]) };
  const h = encodeHash(v);
  expect(h).toContain("role=boss%26quest");
  expect(decodeHash(h, ROLES).roles).toEqual(new Set(["boss&quest"]));
});

test("an out-of-range difficulty or player count falls back to the default", () => {
  expect(decodeHash("diff=nightmare", ROLES).diff).toBe(DEFAULT_VIEW.diff);
  expect(decodeHash("players=9", ROLES).players).toBe(DEFAULT_VIEW.players);
});

test("a non-numeric or negative minlv falls back to the default", () => {
  expect(decodeHash("minlv=abc", ROLES).minLevel).toBe(0);
  expect(decodeHash("minlv=-5", ROLES).minLevel).toBe(0);
  expect(decodeHash("minlv=90", ROLES).minLevel).toBe(90);
});

test("the boolean toggles read as present-means-on", () => {
  expect(decodeHash("summons=0&auras=0", ROLES).hideSummons).toBe(false);
  const on = decodeHash("summons=1&auras=1", ROLES);
  expect(on.hideSummons).toBe(true);
  expect(on.includeAuras).toBe(true);
});

test("sort decodes key and direction, and tolerates a missing direction", () => {
  expect(decodeHash("sort=fire:-1", ROLES).sortKey).toBe("fire");
  expect(decodeHash("sort=fire:-1", ROLES).sortDir).toBe(-1);
  expect(decodeHash("sort=fire", ROLES).sortDir).toBe(1);
});
```

Create `web/test/monsters/filter.test.ts`:

```typescript
// ABOUTME: Tests for the pure monster filter and sort.
// ABOUTME: Search and sort go through an injected resolver, so core never sees a locale.
import { test, expect } from "bun:test";
import { applyView } from "../../src/monsters/core/filter";
import { DEFAULT_VIEW, type ViewState } from "../../src/monsters/core/urlState";
import { DAMAGE_TYPES } from "../../src/monsters/core/facets";
import type { Monster, Resistances } from "../../src/monsters/core/model";

const ZERO = Object.fromEntries(DAMAGE_TYPES.map((t) => [t, 0])) as Resistances;

function mon(id: string, over: Partial<Monster> = {}): Monster {
  return {
    id,
    nameTag: `tag_${id}`,
    classification: "Common",
    role: "base",
    raceTag: null,
    minLevel: 1,
    maxLevel: 50,
    isSummon: false,
    variantCount: 1,
    variantsDisagree: false,
    resistances: { ...ZERO },
    passive: {},
    aura: {},
    ...over,
  };
}

const NAMES: Record<string, string> = { a: "Alkamos", b: "Kaisan", c: "Fabius" };
const nameOf = (m: Monster) => NAMES[m.id] ?? m.id;

const ROWS = [
  mon("a", { classification: "Quest", role: "boss&quest", maxLevel: 100, resistances: { ...ZERO, fire: 30 } }),
  mon("b", { classification: "Hero", role: "nemesis", maxLevel: 90, isSummon: true, resistances: { ...ZERO, fire: 10 } }),
  mon("c", { classification: "Common", role: "base", maxLevel: 20, resistances: { ...ZERO, fire: 50 } }),
];

function view(over: Partial<ViewState> = {}): ViewState {
  return { ...DEFAULT_VIEW, ...over };
}

test("an empty view returns every row", () => {
  expect(applyView(ROWS, view(), ZERO, nameOf)).toHaveLength(3);
});

test("the tier facet filters, and an empty set means all", () => {
  expect(applyView(ROWS, view({ tiers: new Set(["Hero"]) }), ZERO, nameOf).map((m) => m.id)).toEqual(["b"]);
  expect(applyView(ROWS, view({ tiers: new Set() }), ZERO, nameOf)).toHaveLength(3);
});

test("the role facet filters", () => {
  expect(applyView(ROWS, view({ roles: new Set(["nemesis", "base"]) }), ZERO, nameOf).map((m) => m.id).sort()).toEqual(["b", "c"]);
});

test("search matches the resolved name case-insensitively, not the id or tag", () => {
  expect(applyView(ROWS, view({ q: "kais" }), ZERO, nameOf).map((m) => m.id)).toEqual(["b"]);
  expect(applyView(ROWS, view({ q: "KAIS" }), ZERO, nameOf).map((m) => m.id)).toEqual(["b"]);
  // "tag_a" is the raw tag; searching it must not match, because the user never sees it.
  expect(applyView(ROWS, view({ q: "tag_a" }), ZERO, nameOf)).toHaveLength(0);
});

test("minLevel filters on maxLevel", () => {
  expect(applyView(ROWS, view({ minLevel: 90 }), ZERO, nameOf).map((m) => m.id).sort()).toEqual(["a", "b"]);
});

test("hideSummons drops summoned rows", () => {
  expect(applyView(ROWS, view({ hideSummons: true }), ZERO, nameOf).map((m) => m.id).sort()).toEqual(["a", "c"]);
});

test("filters combine conjunctively", () => {
  const v = view({ tiers: new Set(["Hero", "Quest"]), minLevel: 95 });
  expect(applyView(ROWS, v, ZERO, nameOf).map((m) => m.id)).toEqual(["a"]);
});

test("default sort is by resolved name ascending", () => {
  expect(applyView(ROWS, view(), ZERO, nameOf).map((m) => m.id)).toEqual(["a", "c", "b"]);
});

test("sorting by a damage type uses the effective value and respects direction", () => {
  const desc = applyView(ROWS, view({ sortKey: "fire", sortDir: -1 }), ZERO, nameOf);
  expect(desc.map((m) => m.id)).toEqual(["c", "a", "b"]);
  const asc = applyView(ROWS, view({ sortKey: "fire", sortDir: 1 }), ZERO, nameOf);
  expect(asc.map((m) => m.id)).toEqual(["b", "a", "c"]);
});

test("sorting by a damage type accounts for the difficulty offset", () => {
  const off = { ...ZERO, fire: 100 } as Resistances;
  const rows = applyView(ROWS, view({ sortKey: "fire", sortDir: -1 }), off, nameOf);
  // The offset is flat, so it shifts every row equally and the order is unchanged.
  expect(rows.map((m) => m.id)).toEqual(["c", "a", "b"]);
});

test("sorting by level and by tier works", () => {
  expect(applyView(ROWS, view({ sortKey: "level", sortDir: -1 }), ZERO, nameOf).map((m) => m.id)).toEqual(["a", "b", "c"]);
  expect(applyView(ROWS, view({ sortKey: "tier", sortDir: 1 }), ZERO, nameOf)[0]!.classification).toBe("Common");
});

test("ties break on id so the order is deterministic", () => {
  const tied = [mon("z"), mon("y")];
  const namesTied = (m: Monster) => "same";
  expect(applyView(tied, view(), ZERO, namesTied).map((m) => m.id)).toEqual(["y", "z"]);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd web && bun test test/monsters/urlState.test.ts test/monsters/filter.test.ts`
Expected: FAIL, cannot resolve `../../src/monsters/core/urlState`.

- [ ] **Step 3: Write the view state module**

Create `web/src/monsters/core/urlState.ts`:

```typescript
// ABOUTME: The monster page ViewState (every view-changing control) and its hash codec.
// ABOUTME: ViewState is the single source of view state; main.ts round-trips it through the URL.
import { putSet, readSet } from "../../core/hashCodec";
import { DAMAGE_TYPES, DIFFICULTIES, PLAYER_COUNTS, TIERS } from "./facets";
import type { Difficulty } from "./model";

export interface ViewState {
  diff: Difficulty;
  players: string;
  tiers: Set<string>;
  roles: Set<string>;
  q: string;
  minLevel: number;
  hideSummons: boolean;
  includeAuras: boolean;
  sortKey: string;
  sortDir: 1 | -1;
}

/** Ultimate at one player is the difficulty most planning happens against; name-ascending
 *  opens the table on a stable alphabetical reference rather than an arbitrary type. */
export const DEFAULT_VIEW: ViewState = {
  diff: "ultimate",
  players: "1",
  tiers: new Set(),
  roles: new Set(),
  q: "",
  minLevel: 0,
  hideSummons: false,
  includeAuras: false,
  sortKey: "name",
  sortDir: 1,
};

const TIER_VALUES = new Set(TIERS);
const DIFF_VALUES = new Set<string>(DIFFICULTIES);
const PLAYER_VALUES = new Set(PLAYER_COUNTS);
const SORT_VALUES = new Set<string>(["name", "tier", "role", "level", ...DAMAGE_TYPES]);

/** Encode the view into a `key=value&...` hash body (no leading '#'). Defaults are omitted,
 *  so a link to the default view is just the bare page URL. */
export function encodeHash(view: ViewState): string {
  const parts: string[] = [];
  if (view.diff !== DEFAULT_VIEW.diff) parts.push(`diff=${view.diff}`);
  if (view.players !== DEFAULT_VIEW.players) parts.push(`players=${view.players}`);
  putSet(parts, "tier", view.tiers);
  putSet(parts, "role", view.roles);
  if (view.q) parts.push(`q=${encodeURIComponent(view.q)}`);
  if (view.minLevel) parts.push(`minlv=${view.minLevel}`);
  if (view.hideSummons) parts.push("summons=1");
  if (view.includeAuras) parts.push("auras=1");
  if (view.sortKey !== DEFAULT_VIEW.sortKey || view.sortDir !== DEFAULT_VIEW.sortDir) {
    parts.push(`sort=${view.sortKey}:${view.sortDir}`);
  }
  return parts.join("&");
}

/** Decode a hash body onto DEFAULT_VIEW, tolerating garbage.
 *
 *  `knownRoles` comes from the loaded dataset rather than a constant, because roles are derived
 *  from record paths and a game patch can introduce one. An unknown role token is dropped.
 */
export function decodeHash(hash: string, knownRoles: Set<string>): ViewState {
  const v: ViewState = { ...DEFAULT_VIEW, tiers: new Set(), roles: new Set() };
  const body = hash.startsWith("#") ? hash.slice(1) : hash;
  for (const pair of body.split("&")) {
    const eq = pair.indexOf("=");
    if (eq < 0) continue;
    const key = pair.slice(0, eq);
    const rawVal = pair.slice(eq + 1);
    // Set-valued keys read the raw value: readSet drops bad tokens individually, where the
    // outer decode below would discard the whole list on one malformed member.
    if (key === "tier") {
      v.tiers = readSet(rawVal, TIER_VALUES);
      continue;
    }
    if (key === "role") {
      v.roles = readSet(rawVal, knownRoles);
      continue;
    }
    let val: string;
    try {
      val = decodeURIComponent(rawVal);
    } catch {
      continue;
    }
    switch (key) {
      case "diff":
        if (DIFF_VALUES.has(val)) v.diff = val as Difficulty;
        break;
      case "players":
        if (PLAYER_VALUES.has(val)) v.players = val;
        break;
      case "q":
        v.q = val;
        break;
      case "minlv": {
        const n = Number(val);
        if (Number.isFinite(n) && n > 0) v.minLevel = Math.floor(n);
        break;
      }
      case "summons":
        v.hideSummons = val === "1";
        break;
      case "auras":
        v.includeAuras = val === "1";
        break;
      case "sort": {
        const [k, d] = val.split(":");
        if (k && SORT_VALUES.has(k)) v.sortKey = k;
        v.sortDir = d === "-1" ? -1 : 1;
        break;
      }
      default:
        break;
    }
  }
  return v;
}
```

- [ ] **Step 4: Write the filter module**

Create `web/src/monsters/core/filter.ts`:

```typescript
// ABOUTME: Pure filter and sort over monsters, driven by a ViewState.
// ABOUTME: i18n-free: the caller injects nameOf so search and name-sort see resolved display text.
import { effective, type DamageType, type Monster, type Resistances } from "./model";
import { TIERS } from "./facets";
import type { ViewState } from "./urlState";

type NameOf = (m: Monster) => string;

const TIER_RANK: Record<string, number> = Object.fromEntries(TIERS.map((t, i) => [t, i]));

function matches(m: Monster, view: ViewState, nameOf: NameOf): boolean {
  if (view.tiers.size && !view.tiers.has(m.classification)) return false;
  if (view.roles.size && !view.roles.has(m.role)) return false;
  if (view.hideSummons && m.isSummon) return false;
  if (view.minLevel && m.maxLevel < view.minLevel) return false;
  // Search the resolved display name only: the raw tag is never shown, so matching it
  // would surface rows the user cannot see a reason for.
  if (view.q && !nameOf(m).toLowerCase().includes(view.q.toLowerCase())) return false;
  return true;
}

function sortValue(m: Monster, key: string, eff: Resistances, nameOf: NameOf): string | number {
  switch (key) {
    case "name":
      return nameOf(m);
    case "tier":
      return TIER_RANK[m.classification] ?? TIERS.length;
    case "role":
      return m.role;
    case "level":
      return m.maxLevel;
    default:
      return eff[key as DamageType] ?? 0;
  }
}

/** Filter then sort for the current view. Stable, pure, and deterministic.
 *
 *  `offsets` is passed in so sorting by a damage type ranks on the same effective value the
 *  table displays, rather than on the base value behind it.
 */
export function applyView(
  rows: Monster[],
  view: ViewState,
  offsets: Resistances,
  nameOf: NameOf,
): Monster[] {
  const filtered = rows.filter((m) => matches(m, view, nameOf));
  const effCache = new Map<string, Resistances>();
  const effOf = (m: Monster): Resistances => {
    let e = effCache.get(m.id);
    if (!e) {
      e = effective(m, offsets, view.includeAuras);
      effCache.set(m.id, e);
    }
    return e;
  };
  return filtered.sort((a, b) => {
    const va = sortValue(a, view.sortKey, effOf(a), nameOf);
    const vb = sortValue(b, view.sortKey, effOf(b), nameOf);
    let cmp: number;
    if (typeof va === "number" && typeof vb === "number") cmp = va - vb;
    else cmp = String(va).localeCompare(String(vb));
    // Break ties on id so the order never depends on input order.
    if (cmp === 0) return a.id.localeCompare(b.id);
    return cmp * view.sortDir;
  });
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd web && bun test test/monsters/`
Expected: all three suites pass (model, stats, urlState, filter), 0 fail.

- [ ] **Step 6: Commit**

```bash
git add web/src/monsters/core/urlState.ts web/src/monsters/core/filter.ts \
  web/test/monsters/urlState.test.ts web/test/monsters/filter.test.ts
git commit -m "feat(monsters): view state codec and pure filtering"
```

---

### Task 6: Page shell, styles, data source, and build wiring

Everything needed for `/monster-resistances` to exist, load its data, and be styled. After this task the page boots and shows its loading state; the views come next.

**Files:**
- Create: `web/monster-resistances.html`
- Create: `web/src/monsters/monsters.css`
- Create: `web/src/monsters/adapters/dataSource.ts`
- Create: `web/src/monsters/app/main.ts` (boot skeleton, completed in Task 9)
- Modify: `web/scripts/bundle.ts`
- Modify: `justfile`

**Interfaces:**
- Consumes: `parseMonsters`, `MonsterDoc` from `../core/model`; `withVersion` from `../../adapters/assetVersion`.
- Produces: `loadMonsters(base?: string): Promise<MonsterDoc>`.

- [ ] **Step 1: Create the data source**

Create `web/src/monsters/adapters/dataSource.ts`:

```typescript
// ABOUTME: Fetches the committed monsters dataset and parses it into Monster rows.
// ABOUTME: The only I/O for monster data; base points at the dir holding data/ ("..").
import { parseMonsters, type MonsterDoc } from "../core/model";
import { withVersion } from "../../adapters/assetVersion";

/** Load and parse data/monsters.json relative to `base` (default the parent dir). */
export async function loadMonsters(base = ".."): Promise<MonsterDoc> {
  const res = await fetch(withVersion(`${base}/data/monsters.json`));
  if (!res.ok) throw new Error(`monsters dataset fetch failed: ${res.status}`);
  return parseMonsters(await res.json());
}
```

- [ ] **Step 2: Create the HTML shell**

Create `web/monster-resistances.html`. This mirrors `web/resistance-reduction.html`, including its boot-fail recovery, with the session key and element ids renamed:

```html
<!-- ABOUTME: HTML shell for the Grim Dawn monster resistance explorer page. -->
<!-- ABOUTME: Declares the layout (header, ranking, controls, table) and loads mon-main.js. -->
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Grim Dawn Monster Resistances</title>
  <link rel="stylesheet" href="../styles.css" />
  <link rel="stylesheet" href="./monsters.css" />
  <script>
    // Mirror the planner's boot-fail recovery: a cached shell can outlive the hashed entry it names.
    function bootFailed() {
      try {
        if (!sessionStorage.getItem("monBootReloaded")) {
          sessionStorage.setItem("monBootReloaded", "1");
          location.reload();
          return;
        }
      } catch (e) {}
      var el = document.getElementById("boot-loading");
      if (el)
        el.innerHTML =
          '<p>Couldn\'t load the page.</p><button type="button" onclick="location.reload()">Reload</button>';
    }
  </script>
</head>
<body class="monsters-page">
  <header>
    <h1 id="mon-title">Monster Resistances</h1>
  </header>
  <main id="mon-main">
    <section id="mon-rank" aria-labelledby="mon-rank-heading">
      <h2 id="mon-rank-heading"></h2>
      <div id="mon-rank-body">
        <div id="boot-loading" role="status"><div class="boot-spinner" aria-hidden="true"></div><p>Loading…</p></div>
      </div>
    </section>
    <!-- No heading here on purpose: each control carries its own visible label, and an
         empty <h2> referenced by aria-labelledby would announce nothing to a screen reader. -->
    <section id="mon-controls">
      <div id="mon-controls-body"></div>
    </section>
    <section id="mon-table-section" aria-labelledby="mon-table-heading">
      <h2 id="mon-table-heading"></h2>
      <div id="mon-table"></div>
    </section>
  </main>
  <script type="module" src="./mon-main.js" onerror="bootFailed()"></script>
</body>
</html>
```

- [ ] **Step 3: Create the stylesheet**

Create `web/src/monsters/monsters.css`. Every rule is scoped under `.monsters-page`, matching how `rr.css` scopes under `.rr-page`:

```css
/* ABOUTME: Scoped styles for the monster resistance explorer page. */
/* ABOUTME: Palette mirrors web/src/styles.css; the ten damage hues are this page's own semantics. */
.monsters-page {
  /* Shared with the planner and the RR page (web/src/styles.css): cool dark ground, gold accent. */
  --mon-bg: #0d1117;
  --mon-panel: #161b22;
  --mon-panel2: #1c2330;
  --mon-line: #30363d;
  --mon-ink: #e6edf3;
  --mon-mut: #9aa4b2;
  --mon-ember: #f0c14b;
  --mon-warn: #ff6b6b;

  /* The ten damage-type hues, this page's own semantics, tuned against the #0d1117 ground.
     Each has a -dim partner used as a cell background, the same idiom rr.css uses. */
  --t-physical: #b8bcc4;
  --t-pierce: #8fa3b8;
  --t-fire: #e8703a;
  --t-cold: #4db8e8;
  --t-lightning: #e8c341;
  --t-poison: #7fb03a;
  --t-aether: #4ec9c9;
  --t-chaos: #c0504d;
  --t-vitality: #b06fd0;
  --t-bleeding: #e05561;

  --t-physical-dim: #24262a;
  --t-pierce-dim: #1e2530;
  --t-fire-dim: #33201a;
  --t-cold-dim: #14283a;
  --t-lightning-dim: #322c14;
  --t-poison-dim: #1f2e14;
  --t-aether-dim: #14302f;
  --t-chaos-dim: #331e1e;
  --t-vitality-dim: #291b33;
  --t-bleeding-dim: #331a1e;

  --mon-mono: ui-monospace, "Cascadia Mono", "SF Mono", Menlo, Consolas, monospace;
  margin: 0;
  background: var(--mon-bg);
  color: var(--mon-ink);
  font:
    14px / 1.45 system-ui,
    "Segoe UI",
    Roboto,
    sans-serif;
}
.monsters-page * {
  box-sizing: border-box;
}
.monsters-page a {
  color: var(--mon-ember);
}
.monsters-page .visually-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
}
.monsters-page main {
  max-width: 1500px;
  margin: 0 auto;
  padding: 16px 20px 60px;
}
.monsters-page section {
  margin-bottom: 28px;
}
.monsters-page h2 {
  font-size: 1.05rem;
  margin: 0 0 4px;
}
.monsters-page .mon-sub {
  color: var(--mon-mut);
  font-size: 0.85rem;
  margin: 0 0 12px;
  max-width: 70ch;
}
.monsters-page .mon-num {
  font-family: var(--mon-mono);
  font-variant-numeric: tabular-nums;
}

/* ---- ranking ---- */
.monsters-page .rank-grid {
  display: grid;
  grid-template-columns: 1.6rem 6.5rem 1fr 4.4rem 4.4rem;
  gap: 10px;
  align-items: center;
}
.monsters-page .rank-head {
  padding: 0 8px 6px;
  border-bottom: 1px solid var(--mon-line);
  color: var(--mon-mut);
  font-size: 0.66rem;
  letter-spacing: 0.09em;
  text-transform: uppercase;
}
.monsters-page .rank-head .buckets {
  display: flex;
  gap: 2px;
}
.monsters-page .rank-head .buckets span {
  flex: 1;
  min-width: 0;
  text-align: center;
  font-size: 0.58rem;
}
.monsters-page .rank-row {
  padding: 8px;
  border-bottom: 1px solid var(--mon-line);
}
.monsters-page .rank-row:last-child {
  border-bottom: none;
}
.monsters-page .rank-row:hover {
  background: var(--mon-panel);
}
.monsters-page .rank-pos {
  color: var(--mon-mut);
  font-size: 0.78rem;
  text-align: right;
  font-variant-numeric: tabular-nums;
}
.monsters-page .rank-name {
  font-weight: 600;
}
.monsters-page .rank-mean {
  text-align: right;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}
.monsters-page .rank-median {
  text-align: right;
  color: var(--mon-mut);
  font-variant-numeric: tabular-nums;
}
.monsters-page .rank-hist {
  display: flex;
  align-items: flex-end;
  gap: 2px;
  height: 4.1rem;
}
.monsters-page .hcol {
  flex: 1;
  min-width: 0;
  height: 100%;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
}
.monsters-page .hcount {
  font-size: 0.6rem;
  line-height: 1.1;
  height: 0.85rem;
  overflow: hidden;
  text-align: center;
  color: var(--mon-mut);
  font-variant-numeric: tabular-nums;
}
.monsters-page .hbar {
  min-height: 2px;
  border-radius: 2px 2px 0 0;
}
.monsters-page .hbar.empty {
  background: var(--mon-panel2) !important;
}

/* ---- controls ---- */
.monsters-page .ctl-row {
  display: flex;
  flex-wrap: wrap;
  gap: 18px;
  align-items: flex-start;
  margin-bottom: 14px;
}
.monsters-page .ctl {
  display: flex;
  flex-direction: column;
  gap: 5px;
}
.monsters-page .ctl-label {
  font-size: 0.66rem;
  letter-spacing: 0.09em;
  text-transform: uppercase;
  color: var(--mon-mut);
}
.monsters-page select,
.monsters-page input[type="search"] {
  background: var(--mon-panel);
  color: var(--mon-ink);
  border: 1px solid var(--mon-line);
  border-radius: 4px;
  padding: 4px 8px;
  font: inherit;
}
.monsters-page input[type="search"] {
  min-width: 14rem;
}
.monsters-page .chips {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
}
.monsters-page .chip {
  background: var(--mon-panel);
  color: var(--mon-mut);
  border: 1px solid var(--mon-line);
  border-radius: 999px;
  padding: 3px 11px;
  font: inherit;
  font-size: 0.8rem;
  cursor: pointer;
}
.monsters-page .chip[aria-pressed="true"] {
  background: var(--mon-ember);
  border-color: var(--mon-ember);
  color: #17140f;
  font-weight: 600;
}
.monsters-page select:focus-visible,
.monsters-page input:focus-visible,
.monsters-page button:focus-visible {
  outline: 2px solid var(--mon-ember);
  outline-offset: 1px;
}

/* ---- table ---- */
.monsters-page .table-scroll {
  overflow-x: auto;
  border: 1px solid var(--mon-line);
  border-radius: 4px;
  background: var(--mon-panel);
}
.monsters-page table {
  border-collapse: collapse;
  width: 100%;
  font-size: 0.84rem;
}
.monsters-page thead th {
  position: sticky;
  top: 0;
  z-index: 2;
  background: var(--mon-panel2);
  color: var(--mon-mut);
  font-size: 0.64rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  padding: 7px 8px;
  text-align: right;
  white-space: nowrap;
  border-bottom: 1px solid var(--mon-line);
  cursor: pointer;
  user-select: none;
}
.monsters-page thead th.left,
.monsters-page tbody td.left {
  text-align: left;
}
.monsters-page thead th[aria-sort="ascending"]::after {
  content: " \25B2";
  color: var(--mon-ember);
}
.monsters-page thead th[aria-sort="descending"]::after {
  content: " \25BC";
  color: var(--mon-ember);
}
.monsters-page tbody td {
  padding: 5px 8px;
  border-bottom: 1px solid var(--mon-line);
  text-align: right;
  white-space: nowrap;
}
.monsters-page tbody tr:hover td {
  background: var(--mon-panel2);
}
.monsters-page .m-name {
  font-weight: 600;
  max-width: 26ch;
  overflow: hidden;
  text-overflow: ellipsis;
}
.monsters-page .m-facet {
  font-size: 0.7rem;
  color: var(--mon-mut);
}
.monsters-page .cell {
  font-family: var(--mon-mono);
  font-variant-numeric: tabular-nums;
  min-width: 3.2rem;
}
.monsters-page .cell.over {
  font-weight: 700;
}
.monsters-page .cell.neg {
  color: var(--mon-warn);
  font-weight: 700;
}
.monsters-page .prov {
  display: inline-block;
  width: 5px;
  height: 5px;
  border-radius: 50%;
  margin-left: 3px;
  vertical-align: 2px;
}
.monsters-page .prov.passive {
  background: var(--mon-ember);
}
.monsters-page .prov.aura {
  border: 1px solid var(--mon-ember);
}
.monsters-page .disagree {
  color: var(--mon-warn);
  font-weight: 700;
  cursor: help;
}
.monsters-page .mon-empty {
  padding: 40px 16px;
  text-align: center;
  color: var(--mon-mut);
}
.monsters-page .legend {
  display: flex;
  flex-wrap: wrap;
  gap: 18px;
  margin-top: 10px;
  font-size: 0.76rem;
  color: var(--mon-mut);
  align-items: center;
}
.monsters-page .legend span {
  display: inline-flex;
  align-items: center;
  gap: 5px;
}
```

- [ ] **Step 4: Create the boot skeleton**

Create `web/src/monsters/app/main.ts`. Task 9 replaces the render body; this version proves the page boots and the data loads:

```typescript
// ABOUTME: Entry point for the monster page: loads the dataset + localization, owns the render loop.
// ABOUTME: All view state lives in the URL hash; render reads the decoded ViewState.
import { loadMonsters } from "../adapters/dataSource";

async function boot() {
  // Clear any boot-fail guard now the module has loaded (see bootFailed() in the HTML shell).
  try {
    sessionStorage.removeItem("monBootReloaded");
  } catch {}

  const doc = await loadMonsters("..");
  const host = document.getElementById("mon-rank-body");
  if (host) host.textContent = `${doc.monsters.length} monsters loaded`;
}

boot().catch((err) => {
  console.error(err);
  const fail = (globalThis as { bootFailed?: () => void }).bootFailed;
  if (typeof fail === "function") fail();
});
```

- [ ] **Step 5: Add the third page to the bundler**

In `web/scripts/bundle.ts`, add this block immediately before the final `console.log(...)` line. It mirrors the RR block above it:

```typescript
// Third page: the monster resistance explorer, its own bundle under dist/monster-resistances/,
// sharing the hashed styles.css from the parent dir. Named mon-main to avoid colliding.
const mon = await Bun.build({
  entrypoints: ["src/monsters/app/main.ts"],
  outdir: "dist/monster-resistances",
  target: "browser",
  minify: true,
  sourcemap: "linked",
  naming: "mon-[name]-[hash].[ext]", // dist/monster-resistances/mon-main-<hash>.js
  define: { __ASSET_V__: JSON.stringify(assetVersion) },
});
if (!mon.success) {
  for (const log of mon.logs) console.error(log);
  throw new Error("bundle: monsters Bun.build failed");
}
const monEntry = mon.outputs.find((o) => o.kind === "entry-point");
if (!monEntry) throw new Error("bundle: no monsters entry-point output");
const monJsName = monEntry.path.split(/[\\/]/).pop()!; // mon-main-<hash>.js

const monCssBytes = await Bun.file("src/monsters/monsters.css").bytes();
const monCssName = `mon-${createHash("sha256").update(monCssBytes).digest("hex").slice(0, 8)}.css`;
await Bun.write(`dist/monster-resistances/${monCssName}`, monCssBytes);

let monHtml = await Bun.file("monster-resistances.html").text();
monHtml = monHtml
  .replace('src="./mon-main.js"', `src="./${monJsName}"`)
  .replace('href="../styles.css"', `href="../${cssName}"`)
  .replace('href="./monsters.css"', `href="./${monCssName}"`);
if (monHtml.includes('"./mon-main.js"') || monHtml.includes('"../styles.css"') || monHtml.includes('"./monsters.css"')) {
  throw new Error("bundle: monster-resistances.html still has un-hashed asset refs after rewrite");
}
if (!monHtml.includes(monJsName) || !monHtml.includes(cssName) || !monHtml.includes(monCssName)) {
  throw new Error("bundle: hashed monster asset refs not present after rewrite");
}
await Bun.write("dist/monster-resistances/index.html", monHtml);
```

Then change the final `console.log` line to name the third bundle:

```typescript
console.log(
  `bundled dist: ${jsName}, ${cssName}, ${rrJsName}, ${monJsName} (buildId ${buildId}, assetV ${assetVersion})`,
);
```

- [ ] **Step 6: Add the justfile entries**

In `justfile`, in the `serve` recipe, add a third echo line after the resistance-reduction one:

```
    @echo "  Monster resistances:  http://localhost:5173/monster-resistances/"
```

Then add this recipe immediately after the existing `open-rr` recipe:

```
# Open the monster resistances page in the default browser (run in another shell while `serve` is up)
open-monsters:
    #!/usr/bin/env bash
    url="http://localhost:5173/monster-resistances/"
    if command -v powershell.exe >/dev/null 2>&1; then powershell.exe -NoProfile -Command "Start-Process '$url'"
    elif command -v open >/dev/null 2>&1; then open "$url"
    elif command -v xdg-open >/dev/null 2>&1; then xdg-open "$url"
    else echo "open manually: $url"; fi
```

- [ ] **Step 7: Build and verify the page exists**

```bash
just build
ls web/dist/monster-resistances/
```

Expected: the directory contains `index.html`, one `mon-main-<hash>.js`, and one `mon-<hash>.css`. The build log line names four assets.

- [ ] **Step 8: Verify it loads in a browser**

Run `just serve` in one shell, then in another:

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:5173/monster-resistances/
```

Expected: `200`. Opening the page shows "1635 monsters loaded". If it shows the boot-fail message instead, the data fetch path is wrong: check that `just build` copied `data/monsters.json` into `dist/data/`.

- [ ] **Step 9: Commit**

```bash
git add web/monster-resistances.html web/src/monsters/monsters.css \
  web/src/monsters/adapters/dataSource.ts web/src/monsters/app/main.ts \
  web/scripts/bundle.ts justfile
git commit -m "feat(monsters): page shell, styles, data source, and build wiring"
```

---

### Task 7: The ranking view

The centerpiece: ten rows sorted by mean ascending, each with its distribution inline on a shared scale.

**This page builds markup strings, never DOM nodes.** `web/src/rr/adapters/tableView.ts` is the model: pure `*Markup(loc, ...) -> string` functions carry the logic and are unit-tested against the returned string, and a thin `render*(el, ...)` assigns `innerHTML`. The test runner has **no DOM**, so a test calling `document.createElement` fails with "document is not defined". Do not introduce one.

**Files:**
- Create: `web/src/monsters/adapters/markup.ts`
- Create: `web/src/monsters/adapters/rankView.ts`
- Create: `web/test/monsters/rankView.test.ts`
- Modify: `web/src/i18n/app.en.json`
- Modify: `web/test/appCatalog.test.ts`

**Interfaces:**
- Consumes: `BUCKETS`, `rankTypes` from `../core/stats`; `Monster`, `Resistances` from `../core/model`; `Localization` from `../../ports/Localization`, whose shape is `{ translate(key, params?): string; gameText(tag): string; locale: string }`.
- Produces: `esc(s: string): string` from `markup.ts`; `rankMarkup(loc, rows, offsets, includeAuras): string` and `renderRank(el, loc, rows, offsets, includeAuras): void` from `rankView.ts`.

- [ ] **Step 1: Add the catalogue keys**

In `web/src/i18n/app.en.json`, add these keys (keep the file's existing grouping):

```json
  "monsters.rank.heading": "Damage types ranked by mean resistance",
  "monsters.rank.type": "Type",
  "monsters.rank.mean": "Mean",
  "monsters.rank.median": "Median",
  "monsters.rank.empty": "No monsters match these filters, so there is nothing to average.",
  "monsters.type.physical": "Physical",
  "monsters.type.pierce": "Pierce",
  "monsters.type.fire": "Fire",
  "monsters.type.cold": "Cold",
  "monsters.type.lightning": "Lightning",
  "monsters.type.poison": "Poison & Acid",
  "monsters.type.aether": "Aether",
  "monsters.type.chaos": "Chaos",
  "monsters.type.vitality": "Vitality",
  "monsters.type.bleeding": "Bleeding",
```

In `web/test/appCatalog.test.ts`, append every one of those key names to the `REQUIRED` array.

- [ ] **Step 2: Write the failing test**

Create `web/test/monsters/rankView.test.ts`:

```typescript
// ABOUTME: Markup tests for the ranking view: ordering, bucket bars, shared scale, empty state.
// ABOUTME: The localization stub echoes keys, so assertions never depend on English wording.
import { test, expect } from "bun:test";
import { rankMarkup } from "../../src/monsters/adapters/rankView";
import { DAMAGE_TYPES } from "../../src/monsters/core/facets";
import type { Localization } from "../../src/ports/Localization";
import type { Monster, Resistances } from "../../src/monsters/core/model";

const ZERO = Object.fromEntries(DAMAGE_TYPES.map((t) => [t, 0])) as Resistances;
const loc: Localization = { translate: (k) => k, gameText: (t) => t, locale: "en" };

function mon(res: Partial<Resistances>, over: Partial<Monster> = {}): Monster {
  return {
    id: `enemies.${Object.entries(res).map(([k, v]) => `${k}${v}`).join("_")}`,
    nameTag: "tagX",
    classification: "Hero",
    role: "hero",
    raceTag: null,
    minLevel: 1,
    maxLevel: 100,
    isSummon: false,
    variantCount: 1,
    variantsDisagree: false,
    resistances: { ...ZERO, ...res },
    passive: {},
    aura: {},
    ...over,
  };
}

/** The order type names appear in the markup, which is the ranked order. */
function orderOf(html: string): string[] {
  return [...html.matchAll(/data-type="([a-z]+)"/g)].map((m) => m[1]!);
}

test("renders one row per damage type, ordered by mean ascending", () => {
  const html = rankMarkup(loc, [mon({ fire: 90 }), mon({ cold: 10 })], ZERO, false);
  const order = orderOf(html);
  expect(order).toHaveLength(10);
  expect(order.indexOf("cold")).toBeLessThan(order.indexOf("fire"));
});

test("each row carries one bar per bucket", () => {
  const html = rankMarkup(loc, [mon({ fire: 50 })], ZERO, false);
  const rows = html.split('class="rank-grid rank-row"').slice(1);
  expect(rows).toHaveLength(10);
  expect([...rows[0]!.matchAll(/class="hbar/g)]).toHaveLength(13);
});

test("bar heights use the shared peak, not a per-row peak", () => {
  // Nine types sit wholly in the "0" bucket (2 rows each); fire splits into two buckets of 1.
  const html = rankMarkup(loc, [mon({ fire: 10 }), mon({ fire: 20 })], ZERO, false);
  const fireRow = html.split('data-type="fire"')[1]!.split("</div>")[0]!;
  const heights = [...fireRow.matchAll(/height:([\d.]+)%/g)].map((m) => Number(m[1]));
  // With a shared peak of 2, a bucket holding 1 row is 50% tall, never 100%.
  expect(Math.max(...heights)).toBeCloseTo(50, 0);
});

test("mean and median are rendered per row", () => {
  const html = rankMarkup(loc, [mon({ fire: 10 }), mon({ fire: 30 })], ZERO, false);
  const fireRow = html.split('data-type="fire"')[1]!;
  expect(fireRow).toContain('class="rank-mean">20.0<');
  expect(fireRow).toContain('class="rank-median">20<');
});

test("the difficulty offset shifts the rendered mean", () => {
  const html = rankMarkup(loc, [mon({ fire: 10 })], { ...ZERO, fire: 8 } as Resistances, false);
  expect(html.split('data-type="fire"')[1]!).toContain('class="rank-mean">18.0<');
});

test("including auras changes the rendered mean", () => {
  const m = mon({ cold: 10 }, { aura: { cold: 20 } });
  expect(rankMarkup(loc, [m], ZERO, true).split('data-type="cold"')[1]!).toContain('class="rank-mean">30.0<');
  expect(rankMarkup(loc, [m], ZERO, false).split('data-type="cold"')[1]!).toContain('class="rank-mean">10.0<');
});

test("bucket counts are rendered, and an empty bucket shows no number", () => {
  const html = rankMarkup(loc, [mon({ fire: 5 })], ZERO, false);
  const fireRow = html.split('data-type="fire"')[1]!;
  expect(fireRow).toContain('class="hcount">1<');
  expect(fireRow).toContain('class="hcount"><'); // the empty buckets
});

test("an empty population renders an honest empty state, not a zeroed chart", () => {
  const html = rankMarkup(loc, [], ZERO, false);
  expect(html).toContain("monsters.rank.empty");
  expect(html).not.toContain("rank-row");
});

test("the header labels the mean and median columns", () => {
  const html = rankMarkup(loc, [mon({ fire: 1 })], ZERO, false);
  expect(html).toContain("monsters.rank.mean");
  expect(html).toContain("monsters.rank.median");
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `cd web && bun test test/monsters/rankView.test.ts`
Expected: FAIL, cannot resolve `../../src/monsters/adapters/rankView`.

- [ ] **Step 4: Create the escaping helper**

Create `web/src/monsters/adapters/markup.ts`:

```typescript
// ABOUTME: Markup helpers shared by the monster page's view modules.
// ABOUTME: esc mirrors the private helper in rr/adapters/tableView.ts; views build strings, not DOM.

/** Escape text for interpolation into an HTML attribute or text node. */
export function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}
```

- [ ] **Step 5: Write the ranking view**

Create `web/src/monsters/adapters/rankView.ts`:

```typescript
// ABOUTME: Builds the damage-type ranking markup, each row carrying its distribution inline.
// ABOUTME: All ten histograms share one vertical scale so their shapes compare directly.
import { BUCKETS, rankTypes } from "../core/stats";
import type { Monster, Resistances } from "../core/model";
import type { Localization } from "../../ports/Localization";
import { esc } from "./markup";

/** The ranking as an HTML string: a header row, then one row per damage type. */
export function rankMarkup(
  loc: Localization,
  rows: Monster[],
  offsets: Resistances,
  includeAuras: boolean,
): string {
  const result = rankTypes(rows, offsets, includeAuras);
  if (!result) {
    // No population means no mean: say so rather than drawing a chart of zeroes,
    // which would read as "these enemies have no resistance".
    return `<div class="mon-empty">${esc(loc.translate("monsters.rank.empty"))}</div>`;
  }

  const bucketLabels = BUCKETS.map((b) => `<span>${esc(b.key)}</span>`).join("");
  const head =
    `<div class="rank-grid rank-head">` +
    `<span></span>` +
    `<span>${esc(loc.translate("monsters.rank.type"))}</span>` +
    `<span class="buckets">${bucketLabels}</span>` +
    `<span style="text-align:right">${esc(loc.translate("monsters.rank.mean"))}</span>` +
    `<span style="text-align:right">${esc(loc.translate("monsters.rank.median"))}</span>` +
    `</div>`;

  const body = result.stats
    .map((s, i) => {
      const bars = s.counts
        .map((n, b) => {
          const height = ((n / result.peak) * 100).toFixed(1);
          const title = `${BUCKETS[b]!.key}: ${n}`;
          return (
            `<span class="hcol" title="${esc(title)}">` +
            `<span class="hcount">${n ? n : ""}</span>` +
            `<span class="hbar${n ? "" : " empty"}" style="height:${height}%;background:var(--t-${s.type})"></span>` +
            `</span>`
          );
        })
        .join("");
      return (
        `<div class="rank-grid rank-row" data-type="${s.type}">` +
        `<span class="rank-pos">${i + 1}</span>` +
        `<span class="rank-name">${esc(loc.translate(`monsters.type.${s.type}`))}</span>` +
        `<span class="rank-hist">${bars}</span>` +
        `<span class="rank-mean">${s.mean.toFixed(1)}</span>` +
        `<span class="rank-median">${s.median.toFixed(0)}</span>` +
        `</div>`
      );
    })
    .join("");

  return head + body;
}

/** Mount the ranking into `el`, replacing whatever was there. */
export function renderRank(
  el: HTMLElement,
  loc: Localization,
  rows: Monster[],
  offsets: Resistances,
  includeAuras: boolean,
): void {
  el.innerHTML = rankMarkup(loc, rows, offsets, includeAuras);
}
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `cd web && bun test test/monsters/rankView.test.ts`
Expected: 9 pass, 0 fail.

- [ ] **Step 7: Verify the catalogue guard passes**

Run: `cd web && bun test test/appCatalog.test.ts`
Expected: pass. A failure means a key was added to `REQUIRED` but not to `app.en.json`, or vice versa.

- [ ] **Step 8: Commit**

```bash
git add web/src/monsters/adapters/markup.ts web/src/monsters/adapters/rankView.ts \
  web/test/monsters/rankView.test.ts web/src/i18n/app.en.json web/test/appCatalog.test.ts
git commit -m "feat(monsters): damage-type ranking with inline distributions"
```

---

### Task 8: The table view

Every matching row, sortable, heat-shaded, with provenance markers whose meaning tracks the aura toggle.

Same pattern as Task 7: a pure `tableMarkup` returning a string, plus a thin `renderTable` that mounts it and wires one delegated click handler for sorting.

**Files:**
- Create: `web/src/monsters/adapters/tableView.ts`
- Create: `web/test/monsters/tableView.test.ts`
- Modify: `web/src/i18n/app.en.json`
- Modify: `web/test/appCatalog.test.ts`

**Interfaces:**
- Consumes: `DAMAGE_TYPES` from `../core/facets`; `effective`, `Monster`, `Resistances` from `../core/model`; `ViewState` from `../core/urlState`; `esc` from `./markup`; `Localization` from `../../ports/Localization`.
- Produces: `tableMarkup(loc, rows, view, offsets, nameOf): string` and `renderTable(el, loc, rows, view, offsets, nameOf, onSort): void` where `onSort: (key: string) => void`.

- [ ] **Step 1: Add the catalogue keys**

In `web/src/i18n/app.en.json`, add:

```json
  "monsters.table.heading": "Monsters",
  "monsters.table.count": "{count} shown",
  "monsters.table.empty": "No monsters match these filters.",
  "monsters.table.colName": "Monster",
  "monsters.table.colTier": "Tier",
  "monsters.table.colRole": "Role",
  "monsters.table.colLevel": "Lv",
  "monsters.table.summonSuffix": "(summon)",
  "monsters.table.disagreeTitle": "Collapsed variant records disagree on resistance",
  "monsters.table.passiveTitle": "from a passive skill",
  "monsters.table.auraExcludedTitle": "from an aura, not counted in this total",
  "monsters.table.auraIncludedTitle": "from an aura, included in this total",
  "monsters.legend.passive": "from a passive skill",
  "monsters.legend.auraExcluded": "has an aura grant, not counted",
  "monsters.legend.auraIncluded": "has an aura grant, counted",
  "monsters.legend.disagree": "collapsed variants disagree",
  "monsters.legend.negative": "negative: takes extra damage",
```

Append all of them to `REQUIRED` in `web/test/appCatalog.test.ts`.

Note the three `*Title` keys carry no `{value}` placeholder: the numeric amount is prepended by the view as `+20 `, so the catalogue string stays a plain phrase and the placeholder-parity guard has nothing to match across locales.

- [ ] **Step 2: Write the failing test**

Create `web/test/monsters/tableView.test.ts`:

```typescript
// ABOUTME: Markup tests for the monster table: columns, sort affordances, provenance markers.
// ABOUTME: Pins that the aura marker flips meaning with the toggle, which is easy to get wrong.
import { test, expect } from "bun:test";
import { tableMarkup } from "../../src/monsters/adapters/tableView";
import { DEFAULT_VIEW, type ViewState } from "../../src/monsters/core/urlState";
import { DAMAGE_TYPES } from "../../src/monsters/core/facets";
import type { Localization } from "../../src/ports/Localization";
import type { Monster, Resistances } from "../../src/monsters/core/model";

const ZERO = Object.fromEntries(DAMAGE_TYPES.map((t) => [t, 0])) as Resistances;
const loc: Localization = { translate: (k) => k, gameText: (t) => t, locale: "en" };

function mon(over: Partial<Monster> = {}): Monster {
  return {
    id: "enemies.a",
    nameTag: "tagA",
    classification: "Hero",
    role: "hero",
    raceTag: null,
    minLevel: 1,
    maxLevel: 100,
    isSummon: false,
    variantCount: 1,
    variantsDisagree: false,
    resistances: { ...ZERO },
    passive: {},
    aura: {},
    ...over,
  };
}

const nameOf = (m: Monster) => `Name:${m.id}`;
function view(over: Partial<ViewState> = {}): ViewState {
  return { ...DEFAULT_VIEW, ...over };
}
/** The cell markup for one damage type on the single-row fixtures below. */
function cellFor(html: string, type: string): string {
  return html.split(`data-cell="${type}"`)[1]!.split("</td>")[0]!;
}

test("renders four facet columns plus one per damage type", () => {
  const html = tableMarkup(loc, [mon()], view(), ZERO, nameOf);
  expect([...html.matchAll(/<th /g)]).toHaveLength(4 + 10);
});

test("renders one row per monster with the resolved name", () => {
  const html = tableMarkup(loc, [mon({ id: "enemies.a" }), mon({ id: "enemies.b" })], view(), ZERO, nameOf);
  expect([...html.matchAll(/<tr data-id=/g)]).toHaveLength(2);
  expect(html).toContain("Name:enemies.a");
});

test("cells show the effective value including the offset", () => {
  const html = tableMarkup(loc, [mon({ resistances: { ...ZERO, fire: 30 } })], view(), { ...ZERO, fire: 8 } as Resistances, nameOf);
  expect(cellFor(html, "fire")).toContain(">38");
});

test("a negative cell is marked so it reads as taking extra damage", () => {
  const html = tableMarkup(loc, [mon({ resistances: { ...ZERO, fire: -20 } })], view(), ZERO, nameOf);
  expect(html).toContain('class="cell neg" data-cell="fire"');
});

test("a value at or above 100 is marked as a wall", () => {
  const html = tableMarkup(loc, [mon({ resistances: { ...ZERO, fire: 100 } })], view(), ZERO, nameOf);
  expect(html).toContain('class="cell over" data-cell="fire"');
});

test("a passive marker appears only on the types a passive contributed to", () => {
  const html = tableMarkup(loc, [mon({ passive: { bleeding: 80 } })], view(), ZERO, nameOf);
  expect([...html.matchAll(/class="prov passive"/g)]).toHaveLength(1);
  expect(cellFor(html, "bleeding")).toContain("prov passive");
  expect(cellFor(html, "fire")).not.toContain("prov passive");
});

test("the aura marker says EXCLUDED when the toggle is off", () => {
  const html = tableMarkup(loc, [mon({ aura: { cold: 20 } })], view({ includeAuras: false }), ZERO, nameOf);
  expect(cellFor(html, "cold")).toContain("monsters.table.auraExcludedTitle");
  expect(cellFor(html, "cold")).not.toContain("monsters.table.auraIncludedTitle");
});

test("the aura marker says INCLUDED when the toggle is on", () => {
  const html = tableMarkup(loc, [mon({ aura: { cold: 20 } })], view({ includeAuras: true }), ZERO, nameOf);
  expect(cellFor(html, "cold")).toContain("monsters.table.auraIncludedTitle");
  expect(cellFor(html, "cold")).not.toContain("monsters.table.auraExcludedTitle");
});

test("the aura value is in the cell only when the toggle is on", () => {
  const m = mon({ resistances: { ...ZERO, cold: 10 }, aura: { cold: 20 } });
  expect(cellFor(tableMarkup(loc, [m], view({ includeAuras: false }), ZERO, nameOf), "cold")).toContain(">10");
  expect(cellFor(tableMarkup(loc, [m], view({ includeAuras: true }), ZERO, nameOf), "cold")).toContain(">30");
});

test("the legend text follows the toggle too", () => {
  expect(tableMarkup(loc, [mon()], view({ includeAuras: false }), ZERO, nameOf)).toContain("monsters.legend.auraExcluded");
  expect(tableMarkup(loc, [mon()], view({ includeAuras: true }), ZERO, nameOf)).toContain("monsters.legend.auraIncluded");
});

test("a disagreeing row carries a warning marker", () => {
  const html = tableMarkup(loc, [mon({ variantsDisagree: true })], view(), ZERO, nameOf);
  expect(html).toContain('class="disagree"');
});

test("a summon row is labelled as one", () => {
  const html = tableMarkup(loc, [mon({ isSummon: true })], view(), ZERO, nameOf);
  expect(html).toContain("monsters.table.summonSuffix");
});

test("the sorted column is marked with aria-sort in the right direction", () => {
  const desc = tableMarkup(loc, [mon()], view({ sortKey: "fire", sortDir: -1 }), ZERO, nameOf);
  expect(desc).toContain('data-key="fire" aria-sort="descending"');
  const asc = tableMarkup(loc, [mon()], view({ sortKey: "fire", sortDir: 1 }), ZERO, nameOf);
  expect(asc).toContain('data-key="fire" aria-sort="ascending"');
});

test("only the sorted column carries aria-sort", () => {
  const html = tableMarkup(loc, [mon()], view({ sortKey: "fire", sortDir: 1 }), ZERO, nameOf);
  expect([...html.matchAll(/aria-sort=/g)]).toHaveLength(1);
});

test("a name containing markup characters is escaped", () => {
  const html = tableMarkup(loc, [mon()], view(), ZERO, () => 'Ras<script>"&');
  expect(html).toContain("Ras&lt;script&gt;&quot;&amp;");
  expect(html).not.toContain("<script>");
});

test("an empty row set renders an empty state, not a bare header", () => {
  const html = tableMarkup(loc, [], view(), ZERO, nameOf);
  expect(html).toContain("monsters.table.empty");
  expect(html).not.toContain("<tr data-id=");
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `cd web && bun test test/monsters/tableView.test.ts`
Expected: FAIL, cannot resolve `../../src/monsters/adapters/tableView`.

- [ ] **Step 4: Write the implementation**

Create `web/src/monsters/adapters/tableView.ts`:

```typescript
// ABOUTME: Builds the monster table markup: facet columns, heat-shaded cells, provenance markers.
// ABOUTME: The aura marker's meaning tracks the toggle, so its tooltip is chosen per render.
import { DAMAGE_TYPES } from "../core/facets";
import { effective, type DamageType, type Monster, type Resistances } from "../core/model";
import type { ViewState } from "../core/urlState";
import type { Localization } from "../../ports/Localization";
import { esc } from "./markup";

const FACET_COLUMNS = [
  { key: "name", label: "monsters.table.colName", left: true },
  { key: "tier", label: "monsters.table.colTier", left: true },
  { key: "role", label: "monsters.table.colRole", left: true },
  { key: "level", label: "monsters.table.colLevel", left: false },
];

/** A cell background tinted by how resistant the monster is, saturating at 100. */
function shade(type: DamageType, value: number): string {
  const a = Math.max(0, Math.min(1, value / 100));
  if (a === 0) return "";
  return ` style="background:color-mix(in srgb, var(--t-${type}-dim) ${(a * 100).toFixed(0)}%, transparent)"`;
}

function header(loc: Localization, view: ViewState): string {
  const th = (key: string, label: string, left: boolean) => {
    const sorted = view.sortKey === key ? ` aria-sort="${view.sortDir === 1 ? "ascending" : "descending"}"` : "";
    return `<th ${left ? 'class="left" ' : ""}data-key="${esc(key)}"${sorted}>${esc(label)}</th>`;
  };
  return (
    FACET_COLUMNS.map((c) => th(c.key, loc.translate(c.label), c.left)).join("") +
    DAMAGE_TYPES.map((t) => th(t, loc.translate(`monsters.type.${t}`), false)).join("")
  );
}

function marker(cls: string, amount: number, phrase: string): string {
  // The amount is prepended here rather than living in the catalogue, so the catalogue
  // string stays a plain phrase with no placeholder to keep in sync across locales.
  return `<i class="prov ${cls}" title="+${amount} ${esc(phrase)}"></i>`;
}

function row(loc: Localization, m: Monster, view: ViewState, offsets: Resistances, nameOf: (m: Monster) => string): string {
  const eff = effective(m, offsets, view.includeAuras);
  const warn = m.variantsDisagree
    ? `<b class="disagree" title="${esc(loc.translate("monsters.table.disagreeTitle"))}">&#9888;</b>`
    : "";
  const roleText = m.isSummon
    ? `${m.role} ${loc.translate("monsters.table.summonSuffix")}`
    : m.role;

  const cells = DAMAGE_TYPES.map((t) => {
    const v = eff[t];
    const cls = `cell${v >= 100 ? " over" : ""}${v < 0 ? " neg" : ""}`;
    const passive = m.passive[t];
    const aura = m.aura[t];
    const marks =
      (passive ? marker("passive", passive, loc.translate("monsters.table.passiveTitle")) : "") +
      (aura
        ? marker(
            "aura",
            aura,
            loc.translate(
              // The ring means the opposite thing depending on the toggle: with auras off it
              // flags a value NOT in this number, with them on it explains part of the number.
              view.includeAuras ? "monsters.table.auraIncludedTitle" : "monsters.table.auraExcludedTitle",
            ),
          )
        : "");
    return `<td class="${cls}" data-cell="${t}"${shade(t, v)}>${v}${marks}</td>`;
  }).join("");

  return (
    `<tr data-id="${esc(m.id)}">` +
    `<td class="left m-name">${esc(nameOf(m))}${warn}</td>` +
    `<td class="left m-facet">${esc(m.classification)}</td>` +
    `<td class="left m-facet">${esc(roleText)}</td>` +
    `<td class="mon-num">${m.maxLevel}</td>` +
    cells +
    `</tr>`
  );
}

function legend(loc: Localization, view: ViewState): string {
  const auraKey = view.includeAuras ? "monsters.legend.auraIncluded" : "monsters.legend.auraExcluded";
  return (
    `<div class="legend">` +
    `<span><i class="prov passive"></i>${esc(loc.translate("monsters.legend.passive"))}</span>` +
    `<span><i class="prov aura"></i>${esc(loc.translate(auraKey))}</span>` +
    `<span>${esc(loc.translate("monsters.legend.disagree"))}</span>` +
    `<span>${esc(loc.translate("monsters.legend.negative"))}</span>` +
    `</div>`
  );
}

/** The whole table as an HTML string, including its legend. */
export function tableMarkup(
  loc: Localization,
  rows: Monster[],
  view: ViewState,
  offsets: Resistances,
  nameOf: (m: Monster) => string,
): string {
  const span = FACET_COLUMNS.length + DAMAGE_TYPES.length;
  const body = rows.length
    ? rows.map((m) => row(loc, m, view, offsets, nameOf)).join("")
    : `<tr><td class="mon-empty" colspan="${span}">${esc(loc.translate("monsters.table.empty"))}</td></tr>`;
  return (
    `<div class="table-scroll"><table>` +
    `<thead><tr>${header(loc, view)}</tr></thead>` +
    `<tbody>${body}</tbody>` +
    `</table></div>` +
    legend(loc, view)
  );
}

/** Mount the table into `el` and wire one delegated handler for header sorting. */
export function renderTable(
  el: HTMLElement,
  loc: Localization,
  rows: Monster[],
  view: ViewState,
  offsets: Resistances,
  nameOf: (m: Monster) => string,
  onSort: (key: string) => void,
): void {
  el.innerHTML = tableMarkup(loc, rows, view, offsets, nameOf);
  // Delegated once per render on the container, so re-rendering the body cannot leak listeners.
  const head = el.querySelector("thead");
  head?.addEventListener("click", (ev) => {
    const th = (ev.target as HTMLElement).closest("th");
    const key = th?.getAttribute("data-key");
    if (key) onSort(key);
  });
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd web && bun test test/monsters/tableView.test.ts`
Expected: 16 pass, 0 fail.

- [ ] **Step 6: Commit**

```bash
git add web/src/monsters/adapters/tableView.ts web/test/monsters/tableView.test.ts \
  web/src/i18n/app.en.json web/test/appCatalog.test.ts
git commit -m "feat(monsters): monster table with heat cells and provenance markers"
```

---

### Task 9: Wire the page together

Controls, the render loop, the hash round-trip, the shared app menu, and the full gates.

**Files:**
- Modify: `web/src/monsters/app/main.ts` (replace the Task 6 skeleton)
- Modify: `web/src/i18n/app.en.json`
- Modify: `web/test/appCatalog.test.ts`
- Modify: `docs/superpowers/specs/2026-07-26-monster-explorer-page-design.md` (status line)

**Interfaces:**
- Consumes: `loadMonsters`; `renderRank(el, loc, rows, offsets, includeAuras)`; `renderTable(el, loc, rows, view, offsets, nameOf, onSort)`; `applyView(rows, view, offsets, nameOf)`; `encodeHash`/`decodeHash`/`DEFAULT_VIEW`/`ViewState`; `offsetFor(doc, diff, players)`; `DAMAGE_TYPES`/`TIERS`/`DIFFICULTIES`/`PLAYER_COUNTS`.
- **Monster names resolve through `loc.gameText(m.nameTag)`, not `loc.translate`.** `gameText` reads the extracted game tag tables; `translate` reads the app catalogue. Using the wrong one renders raw tags.

- [ ] **Step 1: Read how the RR page boots**

Before writing any code, read `web/src/rr/app/main.ts` end to end. It is the worked example for the exact call shapes of `loadLocalization`, `storedLocale`, `storeLocale`, and `mountAppMenu`, which are shared modules used by two pages already. Match its usage rather than adapting those modules: changing them would affect the RR page and the planner too.

- [ ] **Step 2: Add the remaining catalogue keys**

In `web/src/i18n/app.en.json`, add:

```json
  "monsters.title": "Monster Resistances",
  "monsters.ctl.difficulty": "Difficulty",
  "monsters.ctl.players": "Players",
  "monsters.ctl.tier": "Tier",
  "monsters.ctl.role": "Role",
  "monsters.ctl.search": "Search",
  "monsters.ctl.searchPlaceholder": "name contains...",
  "monsters.ctl.minLevel": "Min level",
  "monsters.ctl.anyLevel": "any",
  "monsters.ctl.toggles": "Options",
  "monsters.ctl.hideSummons": "hide summons",
  "monsters.ctl.includeAuras": "include auras",
  "monsters.diff.normal": "Normal",
  "monsters.diff.elite": "Elite",
  "monsters.diff.ultimate": "Ultimate",
```

Append all of them to `REQUIRED` in `web/test/appCatalog.test.ts`.

- [ ] **Step 3: Replace the boot skeleton with the full page**

Replace the whole contents of `web/src/monsters/app/main.ts`:

```typescript
// ABOUTME: Entry point for the monster page: loads the dataset + localization, owns the render loop.
// ABOUTME: All view state lives in the URL hash; render reads the decoded ViewState.
import { loadMonsters } from "../adapters/dataSource";
import { renderRank } from "../adapters/rankView";
import { renderTable } from "../adapters/tableView";
import { applyView } from "../core/filter";
import { offsetFor, type Monster } from "../core/model";
import { DAMAGE_TYPES, DIFFICULTIES, PLAYER_COUNTS, TIERS } from "../core/facets";
import { decodeHash, encodeHash, type ViewState } from "../core/urlState";
import {
  loadLocalization,
  SUPPORTED_LOCALES,
  LOCALE_NAMES,
  storedLocale,
  storeLocale,
} from "../../adapters/localizationAdapter";
import { mountAppMenu } from "../../adapters/appMenu";

const MIN_LEVELS = ["0", "50", "75", "90", "100"];

async function boot() {
  // Clear any boot-fail guard now the module has loaded (see bootFailed() in the HTML shell).
  try {
    sessionStorage.removeItem("monBootReloaded");
  } catch {}

  const doc = await loadMonsters("..");
  let localization = await loadLocalization({
    base: "..",
    available: SUPPORTED_LOCALES,
    preferred: storedLocale() ? [storedLocale()!] : [],
  });

  // Roles come from record paths, so the valid set is derived from the data, not a constant.
  const knownRoles = new Set(doc.monsters.map((m) => m.role));
  // Monster names are game data: gameText reads the extracted tag tables, translate would not.
  const nameOf = (m: Monster) => localization.gameText(m.nameTag);

  let view: ViewState = decodeHash(location.hash, knownRoles);

  function pushHash(replace: boolean) {
    const body = encodeHash(view);
    const url = `${location.pathname}${location.search}${body ? `#${body}` : ""}`;
    if (replace) history.replaceState(null, "", url);
    else history.pushState(null, "", url);
  }

  function set(patch: Partial<ViewState>) {
    view = { ...view, ...patch };
    pushHash(false);
    render();
  }

  function toggled(current: Set<string>, v: string): Set<string> {
    const next = new Set(current);
    if (next.has(v)) next.delete(v);
    else next.add(v);
    return next;
  }

  function selectMarkup(id: string, options: string[], value: string, labelOf: (v: string) => string): string {
    const opts = options
      .map((o) => `<option value="${o}"${o === value ? " selected" : ""}>${labelOf(o)}</option>`)
      .join("");
    return `<select id="${id}">${opts}</select>`;
  }

  function chipsMarkup(facet: string, values: string[], selected: Set<string>): string {
    return values
      .map(
        (v) =>
          `<button type="button" class="chip" data-facet="${facet}" data-val="${v}" aria-pressed="${selected.has(v)}">${v}</button>`,
      )
      .join("");
  }

  function controlsMarkup(): string {
    const t = (k: string) => localization.translate(k);
    const lv = (v: string) => (v === "0" ? t("monsters.ctl.anyLevel") : `${v}+`);
    return (
      `<div class="ctl-row">` +
      `<div class="ctl"><span class="ctl-label">${t("monsters.ctl.difficulty")}</span>` +
      selectMarkup("mon-diff", [...DIFFICULTIES], view.diff, (d) => t(`monsters.diff.${d}`)) +
      `</div>` +
      `<div class="ctl"><span class="ctl-label">${t("monsters.ctl.players")}</span>` +
      selectMarkup("mon-players", PLAYER_COUNTS, view.players, (p) => p) +
      `</div>` +
      `<div class="ctl"><span class="ctl-label">${t("monsters.ctl.minLevel")}</span>` +
      selectMarkup("mon-minlv", MIN_LEVELS, String(view.minLevel), lv) +
      `</div>` +
      `<div class="ctl"><span class="ctl-label">${t("monsters.ctl.search")}</span>` +
      `<input type="search" id="mon-q" value="${view.q.replace(/"/g, "&quot;")}" placeholder="${t("monsters.ctl.searchPlaceholder")}"></div>` +
      `</div>` +
      `<div class="ctl-row">` +
      `<div class="ctl"><span class="ctl-label">${t("monsters.ctl.tier")}</span>` +
      `<div class="chips">${chipsMarkup("tier", TIERS, view.tiers)}</div></div>` +
      `<div class="ctl"><span class="ctl-label">${t("monsters.ctl.role")}</span>` +
      `<div class="chips">${chipsMarkup("role", [...knownRoles].sort(), view.roles)}</div></div>` +
      `<div class="ctl"><span class="ctl-label">${t("monsters.ctl.toggles")}</span><div class="chips">` +
      `<button type="button" class="chip" id="mon-summons" aria-pressed="${view.hideSummons}">${t("monsters.ctl.hideSummons")}</button>` +
      `<button type="button" class="chip" id="mon-auras" aria-pressed="${view.includeAuras}">${t("monsters.ctl.includeAuras")}</button>` +
      `</div></div>` +
      `</div>`
    );
  }

  function wireControls(host: HTMLElement) {
    host.querySelector("#mon-diff")?.addEventListener("change", (e) =>
      set({ diff: (e.target as HTMLSelectElement).value as ViewState["diff"] }),
    );
    host.querySelector("#mon-players")?.addEventListener("change", (e) =>
      set({ players: (e.target as HTMLSelectElement).value }),
    );
    host.querySelector("#mon-minlv")?.addEventListener("change", (e) =>
      set({ minLevel: Number((e.target as HTMLSelectElement).value) }),
    );
    host.querySelector("#mon-summons")?.addEventListener("click", () => set({ hideSummons: !view.hideSummons }));
    host.querySelector("#mon-auras")?.addEventListener("click", () => set({ includeAuras: !view.includeAuras }));

    const search = host.querySelector<HTMLInputElement>("#mon-q");
    // Typing must not re-render the controls: that would rebuild the input and drop focus.
    search?.addEventListener("input", () => {
      view = { ...view, q: search.value };
      pushHash(true);
      renderResults();
    });

    host.querySelectorAll<HTMLElement>(".chip[data-facet]").forEach((chip) => {
      chip.addEventListener("click", () => {
        const facet = chip.dataset.facet;
        const val = chip.dataset.val!;
        if (facet === "tier") set({ tiers: toggled(view.tiers, val) });
        else set({ roles: toggled(view.roles, val) });
      });
    });
  }

  function onSort(key: string) {
    // Re-clicking the sorted column flips it; a fresh column starts descending for a
    // resistance ("who resists this most") and ascending for a facet.
    if (view.sortKey === key) set({ sortDir: view.sortDir === 1 ? -1 : 1 });
    else set({ sortKey: key, sortDir: (DAMAGE_TYPES as readonly string[]).includes(key) ? -1 : 1 });
  }

  function renderResults() {
    const offsets = offsetFor(doc, view.diff, view.players);
    const rows = applyView(doc.monsters, view, offsets, nameOf);

    const rankHost = document.getElementById("mon-rank-body");
    if (rankHost) renderRank(rankHost, localization, rows, offsets, view.includeAuras);

    const tableHost = document.getElementById("mon-table");
    if (tableHost) renderTable(tableHost, localization, rows, view, offsets, nameOf, onSort);

    const heading = document.getElementById("mon-table-heading");
    if (heading) {
      heading.textContent = `${localization.translate("monsters.table.heading")} - ${localization.translate("monsters.table.count", { count: rows.length })}`;
    }
  }

  function render() {
    const t = (k: string) => localization.translate(k);
    document.title = t("monsters.title");
    const title = document.getElementById("mon-title");
    if (title) title.textContent = t("monsters.title");
    const rankHeading = document.getElementById("mon-rank-heading");
    if (rankHeading) rankHeading.textContent = t("monsters.rank.heading");

    const controls = document.getElementById("mon-controls-body");
    if (controls) {
      controls.innerHTML = controlsMarkup();
      wireControls(controls);
    }
    renderResults();
  }

  mountAppMenu({
    languages: SUPPORTED_LOCALES.map((l) => ({ code: l, label: LOCALE_NAMES[l] ?? l })),
    onLanguage: async (locale: string) => {
      storeLocale(locale);
      localization = await loadLocalization({ base: "..", available: SUPPORTED_LOCALES, preferred: [locale] });
      render();
    },
  });

  window.addEventListener("hashchange", () => {
    view = decodeHash(location.hash, knownRoles);
    render();
  });

  render();
}

boot().catch((err) => {
  console.error(err);
  const fail = (globalThis as { bootFailed?: () => void }).bootFailed;
  if (typeof fail === "function") fail();
});
```

**If `mountAppMenu` or `loadLocalization` reject this call shape**, use the exact shape `web/src/rr/app/main.ts` uses (you read it in Step 1). Adjust this file, never the shared module.

- [ ] **Step 4: Typecheck and run the whole web suite**

```bash
cd web && bunx tsc --noEmit
cd web && bun test
```

Expected: typecheck clean; every suite passes, including the six new `test/monsters/` files, `test/hashCodec.test.ts`, `test/appCatalog.test.ts`, and all pre-existing tests.

- [ ] **Step 5: Verify the page end to end**

```bash
just build
just serve
```

Then in another shell run `just open-monsters` and check by hand, in this order:

1. The ranking shows ten rows, physical first, vitality last.
2. Switching Difficulty to Normal changes the means and populates the `0` bucket.
3. Selecting the `Hero` tier chip changes both the ranking and the row count.
4. Toggling **include auras** changes at least one mean and flips the aura legend text.
5. Typing in the search box does not steal focus after the first character.
6. Clicking a resistance column header sorts descending first; clicking again flips it.
7. Copy the URL after setting several filters, open it in a new tab, and confirm the page restores exactly that state.
8. Hand-edit the hash to `#diff=bogus&tier=Nonsense&sort=%%%` and confirm the page renders defaults rather than breaking.
9. Search `zzzzz` and confirm the ranking shows its empty state rather than a zeroed chart.
10. Switch language from the app menu and confirm monster names change (they come from the game tables) and the page does not lose its filters.

- [ ] **Step 6: Mark the spec implemented**

In `docs/superpowers/specs/2026-07-26-monster-explorer-page-design.md`, change the header line:

```
Status: approved, not yet implemented
```

to:

```
Status: implemented 2026-07-26
```

- [ ] **Step 7: Run the full gates**

```bash
just test-scripts
just diff-data
just check
```

Expected: all six Python suites pass; `diff-data` reports `MONSTERS: +0 new, -0 removed, 0 changed` (Task 1 already committed its removals) and `DIFFICULTY OFFSETS: 0 changed`; `just check` passes format, tests, lint and typecheck.

- [ ] **Step 8: Commit**

```bash
git add web/src/monsters/app/main.ts web/src/i18n/app.en.json web/test/appCatalog.test.ts \
  docs/superpowers/specs/2026-07-26-monster-explorer-page-design.md
git commit -m "feat(monsters): wire up the resistance explorer page"
```

---

## Done criteria

- `/monster-resistances` builds, serves, and renders the ranking and table from `data/monsters.json`.
- The dataset holds 1,635 rows; the two traps are excluded with a reported reason and the five monsters merely named "trap" survive.
- Every control round-trips through the URL hash, and a malformed hash renders defaults instead of throwing.
- No user-facing literal exists in app code; every new key is in `app.en.json` and in the `appCatalog` guard.
- The aura toggle changes totals, means and the ranking, and the aura marker's tooltip reflects whether the value is counted.
- An empty filter result renders an honest empty state rather than a zeroed chart.
- `just check`, `just test-scripts` and `just diff-data` all pass.

## Not in this plan

- Translations beyond English. The other twelve locales fall back per-key, which the guard permits.
- Health, offensive ability, defensive ability, and attack data. Those remain deferred phases.
- Any change to how resistance is resolved, beyond the trap exclusion in Task 1.
- Bucketing on base rather than effective value. The spec settled this: buckets describe the effective number the page reports.
