# Resistance Reduction Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A static `/resistance-reduction/` page in this repo that renders the committed RR catalogue as a mechanics primer, a filterable/sortable/groupable source table, and a live debuff ledger — with all view state in the URL hash and full i18n.

**Architecture:** A second bundle mirroring the app's hexagonal layout under `web/src/rr/` (pure `core/`, I/O+DOM `adapters/`, `app/main.ts` wiring), sharing the existing `Localization` port and base CSS. Pure core is TDD'd first; views port the prototype `.llm/grim-dawn-rr_1.html` onto our data; URL-state and i18n are first-class.

**Tech Stack:** TypeScript, vanilla DOM + `Bun.build` (no framework), `bun test`. Python (`uv`) for the one pipeline enrichment + game-table extension.

## Global Constraints

- **No hardcoded user-facing strings.** UI copy via `loc.translate("rr.*", params?)`; source names/parents via `loc.gameText(tag)`. New keys added to `web/test/appCatalog.test.ts`'s `REQUIRED`. Core returns keys/descriptors; adapters resolve (respects `web/test/i18nBoundary.test.ts`).
- **All view state in the URL hash**, decoded on load and every `hashchange`, encoded (push/replace) on every view change — search, filters, sort, group, ledger selection, `r0`. No view state only in memory/DOM. Malformed hash → default view.
- **Localization port** (`web/src/ports/Localization.ts`): `translate(key, params?)`, `gameText(tag)`, `locale`. Reuse `loadLocalization` from `web/src/adapters/localizationAdapter.ts` (13 `SUPPORTED_LOCALES`).
- **Dataset is atomic and authoritative** (`data/resistance-reduction.json`, `{meta, sources}`); the page aggregates for display and never mutates it. Source fields: `id, name, parent, record_path, category, rr_type, resistances, values_per_rank, max_rank, ultimate_rank, value_at_max, value_at_ultimate, duration_seconds, cooldown_seconds, trigger_chance_percent, trigger, per_resistance_values, notes`. `rr_type ∈ {stacking, reduced-percent, reduced-flat}`; `resistances` is `"All" | "Elemental" | string[]`.
- **Ledger uses base max-rank values** (overcap excluded), matching the prototype.
- Run tests with `just test` (bun) for `web/` and `uv run scripts/<t>.py` for Python. Commit after each task.

### Shared types (defined in Task 2, used throughout)

```ts
// rr/core/model.ts
export type RrType = "stacking" | "reduced-percent" | "reduced-flat";
export interface RrSource {
  id: string; name: string; parent: string; recordPath: string; category: string;
  rrType: RrType; resistances: "All" | "Elemental" | string[];
  valuesPerRank: number[]; maxRank: number; ultimateRank: number | null;
  valueAtMax: number | null; valueAtUltimate: number | null;
  durationSeconds: number | null; cooldownSeconds: number | null;
  triggerChancePercent: number | null; trigger: string;
  perResistanceValues: Record<string, number> | null; notes: string;
}
// rr/core/aggregate.ts
export interface LogicalSource {
  id: string;              // stable short id: `${recordStem}.${rrShort}` (rrShort: s|m|f), deduped
  name: string; parent: string; category: string; rrType: RrType;
  resistances: (string | "All" | "Elemental")[]; // union of the group's tokens, kept distinct
  perResistance: Record<string, number>;          // token -> base value_at_max (for the ledger)
  valueAtMax: number | null; valueAtUltimate: number | null;
  trigger: string; durationSeconds: number | null; verifyNote: boolean; recordPath: string;
}
// rr/core/urlState.ts
export interface ViewState {
  q: string; fType: string; fRR: string; fCat: string; fPar: string; fTrig: string;
  sortKey: string; sortDir: 1 | -1; group: "none" | "mastery" | "constellation" | "item";
  sel: Set<string>; r0: number;
}
export const DEFAULT_VIEW: ViewState = {
  q: "", fType: "", fRR: "", fCat: "", fPar: "", fTrig: "",
  sortKey: "rr", sortDir: 1, group: "none", sel: new Set(), r0: 100,
};
```

---

### Task 1: Pipeline — real parent names (mastery / constellation / item)

Enrich `scripts/parse_rr.py` so `parent` is the mastery, constellation, or item name — not the skill's own name — so the page's parent column, filter, and group-by are meaningful.

**Files:**
- Modify: `scripts/parse_rr.py`
- Modify: `scripts/test_parse_rr.py`
- Modify: `data/resistance-reduction.json` (regenerated)

**Interfaces:**
- Produces: `parent_descriptor` now resolves a real parent; item sources keep the item name (already done).

- [ ] **Step 1: Write the failing test**

Append to `scripts/test_parse_rr.py` (before `print("FAILURES")`):
```python
# --- Task (page-1): real parent names ---
# A class skill's parent is its mastery, not its own name.
nc_all = find(lambda s: s["record_path"].endswith("skills/playerclass04/veilofshadows2.dbr"))
check("night's chill parent differs from name", nc_all and nc_all[0]["parent"] != nc_all[0]["name"])
# A devotion's parent is its constellation, not its own name.
est = find(lambda s: s["record_path"].endswith("skills/devotion/tier2_01c_skill.dbr"))
check("elemental storm parent differs from name", est and est[0]["parent"] != est[0]["name"])
```

- [ ] **Step 2: Run to verify it fails**

Run: `uv run scripts/test_parse_rr.py`
Expected: FAIL — parent currently equals name for skill sources.

- [ ] **Step 3: Implement parent resolution**

In `scripts/parse_rr.py`, replace `_parent_descriptor` so it resolves:
- **Class skill/modifier** (`/playerclassNN/`): the mastery name. Build a `class_mastery(db, tags, game_en)` map: for each `records/skills/playerclassNN/_classtree_classNN.dbr`, resolve the mastery display-name tag (the class's `skillDisplayName`/mastery tag — locate it by reading the class tree / the mastery skill record it points to) to a localizable key via `register`. Parent = that key.
- **Devotion** (`/devotion/`): the constellation name. Resolve from `data/devotions.json` (load once): match the source's `record_path` to the constellation whose stars reference it, using its `name_tag`. If unresolved, fall back to the skill's own name (with a note).
- **Item**: unchanged (set by `attribute_items`).

Investigation note (test-gated): the exact mastery-name tag location is confirmed against the records during this task; the two assertions above plus a spot check of the resolved English values are the oracle. Fall back to the skill name (never crash) when a parent cannot be resolved, and count such fallbacks in the summary.

- [ ] **Step 4: Run to verify it passes**

Run: `uv run scripts/test_parse_rr.py`
Expected: both new checks pass, `FAILURES: 0`.

- [ ] **Step 5: Regenerate and commit**

Run: `just parse-rr`
```bash
git add scripts/parse_rr.py scripts/test_parse_rr.py data/resistance-reduction.json
git commit -m "feat(rr): pipeline emits real mastery/constellation/item parent names"
```

---

### Task 2: RR core model + catalogue loader

**Files:**
- Create: `web/src/rr/core/model.ts`
- Create: `web/test/rr/model.test.ts`

**Interfaces:**
- Produces: the `RrType`, `RrSource` types (see Shared types); `parseCatalogue(doc: unknown): { meta: Record<string, unknown>; sources: RrSource[] }` — maps the snake_case JSON to camelCase `RrSource`, tolerating a missing/short doc (throws only on a non-object).

- [ ] **Step 1: Write the failing test**

`web/test/rr/model.test.ts`:
```ts
import { test, expect } from "bun:test";
import { parseCatalogue } from "../../src/rr/core/model";
import doc from "../../../data/resistance-reduction.json";

test("parses the committed catalogue", () => {
  const { sources } = parseCatalogue(doc);
  expect(sources.length).toBeGreaterThan(400);
  const viper = sources.find((s) => s.recordPath.endsWith("skills/devotion/tier1_13d.dbr"));
  expect(viper?.rrType).toBe("reduced-percent");
  expect(viper?.valueAtMax).toBe(20);
});
```

- [ ] **Step 2: Run to verify it fails** — `just test rr/model` → FAIL (module missing).

- [ ] **Step 3: Implement `model.ts`**

Define the types (Shared types block) and `parseCatalogue` mapping each snake_case field to camelCase (`record_path`→`recordPath`, `rr_type`→`rrType`, `value_at_max`→`valueAtMax`, etc.), coercing `resistances` through as-is.

- [ ] **Step 4: Run to verify it passes** — `just test rr/model` → PASS.

- [ ] **Step 5: Commit**
```bash
git add web/src/rr/core/model.ts web/test/rr/model.test.ts
git commit -m "feat(rr): catalogue model + loader"
```

---

### Task 3: Aggregation (atomic rows → logical sources)

**Files:**
- Create: `web/src/rr/core/aggregate.ts`
- Create: `web/test/rr/aggregate.test.ts`

**Interfaces:**
- Consumes: `RrSource[]` (Task 2).
- Produces: `aggregate(sources: RrSource[]): LogicalSource[]` — groups by `(recordPath, rrType)`; `resistances` is the union of the group's tokens (dedup, keep `"All"`/`"Elemental"` markers distinct); `perResistance[token] = valueAtMax` from each atomic row; `id` = `${stem(recordPath)}.${ {stacking:'s',reduced-percent:'m',reduced-flat:'f'}[rrType] }`, de-duplicated by appending `-2`, `-3` on collision (stable by sorted recordPath); `verifyNote = notes.includes("verify")`.

- [ ] **Step 1: Write the failing test**
```ts
import { test, expect } from "bun:test";
import { parseCatalogue } from "../../src/rr/core/model";
import { aggregate } from "../../src/rr/core/aggregate";
import doc from "../../../data/resistance-reduction.json";

const logical = aggregate(parseCatalogue(doc).sources);

test("collapses per-resistance rows into one logical source", () => {
  const nc = logical.filter((s) => s.recordPath.endsWith("veilofshadows2.dbr"));
  expect(nc.length).toBe(1);
  expect(new Set(nc[0]!.resistances)).toEqual(new Set(["Cold", "Pierce", "Poison & Acid", "Vitality"]));
});
test("ids are unique and stable", () => {
  const ids = logical.map((s) => s.id);
  expect(new Set(ids).size).toBe(ids.length);
});
test("aggregates to ~304 logical sources", () => {
  expect(logical.length).toBeGreaterThan(280);
  expect(logical.length).toBeLessThan(340);
});
```

- [ ] **Step 2: Run → FAIL.** **Step 3: Implement `aggregate.ts`** per the Interfaces. **Step 4: Run → PASS.**

- [ ] **Step 5: Commit**
```bash
git add web/src/rr/core/aggregate.ts web/test/rr/aggregate.test.ts
git commit -m "feat(rr): aggregate atomic rows into logical sources"
```

---

### Task 4: Ledger resolution math

**Files:**
- Create: `web/src/rr/core/ledger.ts`
- Create: `web/test/rr/ledger.test.ts`

**Interfaces:**
- Consumes: selected `LogicalSource[]`, `r0: number`.
- Produces: `RESISTANCES: string[]` (the 10 damage types, Poison & Acid as one); `ELEMENTAL = ["Fire","Cold","Lightning"]`; `resolveLedger(selected: LogicalSource[], r0: number): LedgerLine[]` where `LedgerLine = { resistance: string; final: number; sumStack: number; maxMult: number; maxFlat: number; bestMult: LogicalSource|null; bestFlat: LogicalSource|null; stackSources: LogicalSource[] }`.
- Expansion: a source hits resistance `r` if `r` is in its `resistances`, or `resistances === "Elemental"` and `r ∈ ELEMENTAL`, or `resistances === "All"`. Per-resistance value = `perResistance[matchedToken] ?? valueAtMax`.
- Math (verbatim from the prototype): `base = r0 - sumStack; sgn = sign(base); afterMult = base*(1 - sgn*maxMult/100); final = afterMult - maxFlat`. `sumStack = Σ|value|` over stacking hits; `maxMult`/`maxFlat` = single highest.

- [ ] **Step 1: Write the failing test** (worked example, one line per affected resistance):
```ts
import { test, expect } from "bun:test";
import { resolveLedger } from "../../src/rr/core/ledger";

const src = (o: any) => ({ resistances: o.res, rrType: o.t, perResistance: o.pr ?? {}, valueAtMax: o.v, id: o.id, } as any);

test("stack sums, then single-highest mult, then flat; sign-aware", () => {
  const sel = [
    src({ id: "a", t: "stacking", res: "Elemental", v: -25 }),   // Fire/Cold/Lightning -25 each
    src({ id: "b", t: "reduced-percent", res: ["Fire"], v: 20 }),
    src({ id: "c", t: "reduced-flat", res: "All", v: 15 }),
  ];
  const fire = resolveLedger(sel, 100).find((l) => l.resistance === "Fire")!;
  // base = 100 - 25 = 75; *(1 - 0.20) = 60; - 15 = 45
  expect(fire.final).toBe(45);
  const cold = resolveLedger(sel, 100).find((l) => l.resistance === "Cold")!;
  // no mult on Cold: (100-25) - 15 = 60
  expect(cold.final).toBe(60);
});
test("mult cannot cross zero on its own", () => {
  const sel = [src({ id: "a", t: "reduced-percent", res: "All", v: 50 })];
  expect(resolveLedger(sel, 10).find((l) => l.resistance === "Fire")!.final).toBe(5); // 10*0.5
});
```

- [ ] **Step 2: Run → FAIL.** **Step 3: Implement `ledger.ts`.** **Step 4: Run → PASS.**

- [ ] **Step 5: Commit**
```bash
git add web/src/rr/core/ledger.ts web/test/rr/ledger.test.ts
git commit -m "feat(rr): pure ledger resolution (stack -> mult -> flat, sign-aware)"
```

---

### Task 5: Filter / sort / group

**Files:**
- Create: `web/src/rr/core/filter.ts`
- Create: `web/test/rr/filter.test.ts`

**Interfaces:**
- Consumes: `LogicalSource[]`, a `ViewState`, and a `nameOf(source): string` resolver (so search/sort match resolved text; injected to keep core i18n-free).
- Produces: `applyView(sources, view, nameOf): LogicalSource[]` (filtered + sorted) and `groupView(sorted, view, parentOf): { key: string; items: LogicalSource[] }[]` (group === "none" → one unnamed group). Filters: `q` (substring over name+parent+category+resistances), `fType` (damage type incl. Elemental/All expansion), `fRR`, `fCat`, `fPar`, `fTrig`. Sort keys: `name, cat, rr, typesLabel, value, trigger` with `sortDir`.

- [ ] **Step 1: Write failing tests** for: RR-type filter narrows to one type; damage-type "Fire" includes an Elemental source; sort by `value` orders by `|valueAtMax|`; group by `category` yields category buckets. **Step 2:** FAIL. **Step 3:** implement. **Step 4:** PASS.

- [ ] **Step 5: Commit**
```bash
git add web/src/rr/core/filter.ts web/test/rr/filter.test.ts
git commit -m "feat(rr): pure filter/sort/group over view state"
```

---

### Task 6: URL-state (hash encode/decode of the full view)

**Files:**
- Create: `web/src/rr/core/urlState.ts`
- Create: `web/test/rr/urlState.test.ts`

**Interfaces:**
- Produces: `encodeHash(view: ViewState): string` and `decodeHash(hash: string, knownIds: Set<string>): ViewState`. Encoding is `key=value` pairs joined by `&` (no leading `#`): `q,type,rr,cat,par,trig` (URI-encoded, omitted when empty), `sort=<key>:<dir>`, `group`, `r0`, `sel=<comma id list>` (filtered to `knownIds` on decode so stale links degrade). `decodeHash` returns `DEFAULT_VIEW` merged with whatever parsed; unknown/garbage tolerated.

- [ ] **Step 1: Write the failing round-trip test**
```ts
import { test, expect } from "bun:test";
import { encodeHash, decodeHash, DEFAULT_VIEW } from "../../src/rr/core/urlState";

test("encode∘decode is identity over a representative view", () => {
  const known = new Set(["veilofshadows2.s", "tier2_01c_skill.f"]);
  const v = { ...DEFAULT_VIEW, q: "night", fRR: "stacking", sortKey: "value", sortDir: -1 as const,
              group: "mastery" as const, r0: 80, sel: new Set(["veilofshadows2.s"]) };
  const back = decodeHash(encodeHash(v), known);
  expect(back).toEqual(v);
});
test("stale sel ids are dropped; garbage hash → defaults", () => {
  expect(decodeHash("sel=doesnotexist", new Set()).sel.size).toBe(0);
  expect(decodeHash("%%%bad", new Set())).toEqual(DEFAULT_VIEW);
});
```

- [ ] **Step 2: Run → FAIL.** **Step 3: Implement `urlState.ts`.** **Step 4: Run → PASS.**

- [ ] **Step 5: Commit**
```bash
git add web/src/rr/core/urlState.ts web/test/rr/urlState.test.ts
git commit -m "feat(rr): hash encode/decode for the full view state"
```

---

### Task 7: HTML shell + bundle entry + boot

Stand up the page skeleton and wiring so it builds and loads (empty views).

**Files:**
- Create: `web/resistance-reduction.html`
- Create: `web/src/rr/app/main.ts`
- Create: `web/src/rr/adapters/catalogueSource.ts`
- Modify: `web/scripts/bundle.ts`
- Modify: `justfile` (build copies RR data)

**Interfaces:**
- `catalogueSource.ts`: `loadCatalogue(base="."): Promise<RrSource[]>` — fetch `${base}/data/resistance-reduction.json`, `parseCatalogue`.
- `main.ts`: `boot()` — load catalogue + `loadLocalization`, `aggregate`, then `render()` that reads `decodeHash(location.hash.slice(1), knownIds)` and paints (stub views for now), plus the `hashchange`/`pushState` plumbing (mirror `web/src/app/main.ts`'s `applyHash`/`refresh` history discipline).

- [ ] **Step 1: Create `web/resistance-reduction.html`**

Parallel to `web/index.html`: `<head>` links `./styles.css` and (dev) `./rr-main.js`; body has `<header>` (title + language-picker mount + a link back to the planner), `<div id="rr-primer">`, `<main><div id="rr-table">…</div><aside id="rr-ledger">…</aside></main>`. Use the same boot-fail script pattern as `index.html`.

- [ ] **Step 2: Extend `bundle.ts` for the second entry**

Add `src/rr/app/main.ts` to a second `Bun.build` (or the same `entrypoints` array) → `dist/resistance-reduction/rr-main-<hash>.js`; write `dist/resistance-reduction/index.html` with its asset ref rewritten (mirror the existing `index.html` rewrite + the post-rewrite assertions). Reuse the hashed `styles.css`.

- [ ] **Step 3: Boot + build**

Implement `catalogueSource.ts` and a minimal `main.ts` that loads data + localization, aggregates, and logs the count (views are stubbed). In `justfile` `build`, after copying `devotions.json`, also `cp data/resistance-reduction.json dist/resistance-reduction/data/` and `cp data/i18n/game.*.json dist/resistance-reduction/data/i18n/`.

- [ ] **Step 4: Verify build + load**

Run: `just build` then `just serve`; open `http://localhost:5173/resistance-reduction/`.
Expected: page loads, console logs the aggregated source count, no errors. (A manual check; the e2e smoke in Task 12 automates it.)

- [ ] **Step 5: Commit**
```bash
git add web/resistance-reduction.html web/src/rr/app/main.ts web/src/rr/adapters/catalogueSource.ts web/scripts/bundle.ts justfile
git commit -m "feat(rr): page shell, second bundle entry, catalogue boot"
```

---

### Task 8: Table view + controls wired to URL state

**Files:**
- Create: `web/src/rr/adapters/tableView.ts`
- Modify: `web/src/rr/app/main.ts`

**Interfaces:**
- `tableView.ts`: `renderTable(el, loc, groups, view, handlers)` — renders the controls (search + 5 filter `<select>`s + group-by select), the sortable table (columns per the spec: source+parent, category, RR badge, damage types, value base/overcap, trigger, duration, select checkbox), and group sections. Source names/parents via `loc.gameText(source.name/parent)`; column headers and control labels via `loc.translate("rr.*")`. A small marker on `verifyNote` rows.
- `handlers`: `{ onView(next: ViewState): void }` — every control/sort/checkbox change computes the next `ViewState` and calls back; `main.ts` encodes it to the hash (`pushState`, or `replaceState` for search-typing bursts) and re-renders.

**Port reference:** the prototype `.llm/grim-dawn-rr_1.html` `render()`/`sortBy()`/`filteredRows()`/`fillFilters()` are the exact behavior to port; adapt them to `LogicalSource`, `loc`, and `ViewState`-driven (not module-global) state.

- [ ] **Step 1: Write a DOM smoke test** (`web/test/rr/tableView.test.ts`, using bun's DOM or a jsdom-free string assertion): rendering a small `groups` array produces a row per source with the resolved name and RR badge, and a checked checkbox for a selected id. **Step 2:** FAIL. **Step 3:** implement `tableView.ts` + wire `main.ts` so control changes round-trip through the hash. **Step 4:** test PASS; manual: filtering/sorting updates the URL and Back restores it.

- [ ] **Step 5: Commit**
```bash
git add web/src/rr/adapters/tableView.ts web/src/rr/app/main.ts web/test/rr/tableView.test.ts
git commit -m "feat(rr): source table with filters/sort/group wired to the hash"
```

---

### Task 9: Ledger view

**Files:**
- Create: `web/src/rr/adapters/ledgerView.ts`
- Modify: `web/src/rr/app/main.ts`

**Interfaces:**
- `ledgerView.ts`: `renderLedger(el, loc, lines, r0, handlers)` — the `r0` number input, one line per affected resistance (final value, stack/mult/flat breakdown with the winning/losing sources, the chain string, the comparison bar), all copy via `loc.translate("rr.*")`. `handlers.onR0(next)` updates the view (hash). Consumes `resolveLedger(selectedLogicalSources, view.r0)`.

**Port reference:** the prototype `calc()` and the ledger markup are the exact behavior to port.

- [ ] **Step 1: Write a test** that `renderLedger` shows the expected final per resistance for a selected set (reuses the Task 4 worked example, asserting the rendered final text). **Step 2:** FAIL. **Step 3:** implement + wire selection/`r0` from the hash. **Step 4:** PASS; manual: ticking rows and changing `r0` update the ledger and the URL.

- [ ] **Step 5: Commit**
```bash
git add web/src/rr/adapters/ledgerView.ts web/src/rr/app/main.ts web/test/rr/ledgerView.test.ts
git commit -m "feat(rr): live debuff ledger wired to selection + r0"
```

---

### Task 10: Primer + i18n catalog keys

**Files:**
- Create: `web/src/rr/adapters/primerView.ts`
- Modify: `web/src/i18n/app.en.json` (+ the 12 other `app.<locale>.json` get the same keys, English values acceptable as fallback)
- Modify: `web/test/appCatalog.test.ts`

**Interfaces:**
- `primerView.ts`: `renderPrimer(el, loc)` — the three-RR-type explanation + formula, all via `loc.translate("rr.primer.*")`.

- [ ] **Step 1: Add the `rr.*` keys to the guard**

In `web/test/appCatalog.test.ts`, extend `REQUIRED` with every `rr.*` key the three views use (primer text, formula, column headers, filter labels, ledger labels, RR-type badge labels, trigger labels). **Step 2:** run `just test appCatalog` → FAIL (keys absent).

- [ ] **Step 3: Author the keys** in `app.en.json` (and add the same keys to the other 12 catalogs; English text is the accepted fallback until translated — the guard only requires presence in `en` and placeholder parity). Implement `primerView.ts` and mount it in `main.ts`.

- [ ] **Step 4: Run** `just test appCatalog` and `just test rr` → PASS; **`bun test web/test/i18nBoundary.test.ts`** still passes (no raw strings in core).

- [ ] **Step 5: Commit**
```bash
git add web/src/rr/adapters/primerView.ts web/src/i18n/app.*.json web/test/appCatalog.test.ts web/src/rr/app/main.ts
git commit -m "feat(rr): mechanics primer + rr.* i18n keys (guarded)"
```

---

### Task 11: Game tag tables cover RR source names (all languages)

**Files:**
- Modify: `scripts/build_game_tables.py`
- Modify: `justfile` (`i18n-tables` passes the RR dataset)
- Modify: `data/i18n/game.*.json` (regenerated)

**Interfaces:**
- `collect_referenced_tags(devotions, stat_tags, stat_format_tags, rr=None)` also adds every `name`/`parent` tag in `rr["sources"]`.

- [ ] **Step 1: Write the failing test** (`scripts/test_build_game_tables.py`, extend it): after building `game.en.json` with the RR dataset passed, an RR skill tag (e.g. `tagClass04SkillName07B`) resolves. **Step 2:** FAIL. **Step 3:** add a `--rr` arg to `build_game_tables.py`, thread it into `collect_referenced_tags`; update the `i18n-tables` recipe to pass `--rr {{out_rr}}`. **Step 4:** rebuild for the already-extracted languages (`just i18n-tables` uses `extracted/text_*`), confirm `tagClass04SkillName07B` now present in `game.en.json` and the test passes.

- [ ] **Step 5: Commit**
```bash
git add scripts/build_game_tables.py scripts/test_build_game_tables.py justfile data/i18n/game.*.json
git commit -m "feat(rr): game tag tables include RR source names across 13 languages"
```

---

### Task 12: e2e smoke + build finalize

**Files:**
- Create: `web/e2e/rr-smoke.ts` (or extend `web/e2e/smoke.ts`)
- Modify: `justfile` (`e2e` runs the RR smoke too)

**Interfaces:**
- Drives headless Chromium to the built `/resistance-reduction/` page (mirroring `web/e2e/smoke.ts`'s CDP setup): asserts the table renders rows, applies a filter and a ledger tick via the URL hash, reloads, and asserts the view is restored (hash round-trip) and the ledger shows a computed final.

- [ ] **Step 1: Write the smoke** mirroring `smoke.ts`'s bootstrap. **Step 2: Build + run** `just e2e` → the RR smoke passes (table present, hash restores selection, ledger computes). Fix wiring until green. **Step 3: Full gate** `just check` passes.

- [ ] **Step 4: Commit**
```bash
git add web/e2e/rr-smoke.ts justfile
git commit -m "test(rr): headless smoke — table, filter, ledger, hash round-trip"
```

---

## Self-Review

**Spec coverage:** separate bundle + files (Tasks 2-10, 7 for wiring); faithful primer/table/ledger (Tasks 8-10); aggregation (Task 3); ledger math (Task 4); full-view hash state + history (Tasks 6, 8-9); i18n `rr.*` + game tables (Tasks 10-11); parent enrichment (Task 1); build/serve/test wiring (Tasks 7, 11, 12). Group-by is inside Tasks 5/8 (the spec's optional-polish lever — can be deferred by shipping Task 8 with `group:"none"` only and adding the selector later).

**Placeholder scan:** the two "investigation notes" (Task 1 mastery-tag location; Task 8/9 "port reference" to the prototype) are test-gated with named oracles and a concrete source file to port, not vague TODOs. View tasks cite the exact prototype functions to port rather than restating hundreds of lines.

**Type consistency:** `ViewState`/`LogicalSource`/`RrSource`/`RrType` are defined once in the Shared-types block and Tasks 2-3-6, and referenced identically across filter (5), urlState (6), table (8), ledger (9). `rrType` values (`stacking`/`reduced-percent`/`reduced-flat`) match the dataset and the ledger. `resolveLedger`/`applyView`/`encodeHash`/`decodeHash` signatures are fixed in their producing tasks and consumed unchanged.
