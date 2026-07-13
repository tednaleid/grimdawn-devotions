# Applies-To Gear-Type Filtering Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the item browser's gear-type facet answer "what can go ON this slot" for augments and components, using the already-released `applies_to` edges, plus an ae9 acceptance guard.

**Architecture:** Spec: `docs/superpowers/specs/2026-07-12-applies-to-filtering-design.md`. No data-layer changes: `relations.parquet` already carries `applies_to` edges (augment/component record -> gear-type token, pre-expanded by the game, e.g. "all armor" = 7 concrete slot edges). The prototype `itemdb.html` loads those edges, makes `gear_type` set-valued for augments/components (the existing `values()` set-facet machinery handles arrays), and renders an "Applies to ..." card line. A new gated acceptance query (ae9) pins coverage and three card oracles.

**Tech Stack:** DuckDB SQL (acceptance query), vanilla JS in `itemdb.html` (DuckDB-WASM prototype), Bun+CDP smoke test (scratchpad, not in repo).

## Global Constraints

- No emojis, emdashes, or hyperbole anywhere; new code files start with two `ABOUTME:` comment lines.
- `itemdb.html` is the throwaway English-only prototype: exempt from the web/ i18n invariant; all its logic stays in the one file.
- Generated parquet never enters git; this work changes no parquet, so no new dataset release.
- Use `just` recipes, never raw tool invocations (`just q`, `just q-ae-all`).
- Never `--no-verify`; the pre-commit hook runs the full web suite (~40s), that is normal.
- Commit style: conventional commits as on this branch (`feat(...)`, `test(...)`, `docs(...)`).
- Pinned facts at build 19149150 (verified this session): 446 of 447 augment+component records have `applies_to` edges; the one gap is `records/items/enchants/a00_blank.dbr` (dev template blank). Spiritguard Powder (`records/items/enchants/c13a_enchant.dbr`) -> chest, feet, hands, head, legs, shoulders, waist. Ancient Armor Plate -> chest, legs. Rune of Amatok's Breath -> medal. Named entities with `gear_type='legs'`: 201; named augments/components applying to legs: 51 (so the merged legs facet count is 252).

---

### Task 1: ae9 acceptance query and justfile gate

**Files:**
- Create: `scripts/derived_queries/ae9_applies_to.sql`
- Modify: `justfile` (lines 314, 349-355: the `_q-derived` comment, new recipe after `q-ae8-faction-sources`, `q-ae-all` dependency list)
- Modify: `docs/item-schema.md:27` and `docs/item-schema.md:103`
- Modify: `docs/deposit.md:51`

**Interfaces:**
- Consumes: the derived views `entities`, `relations`, `labels` registered by `just q` / `_q-derived` (already exist).
- Produces: `just q-ae9-applies-to` recipe; `just q-ae-all` runs nine recipes. Later tasks rely on nothing from this task.

- [ ] **Step 1: Write the gated acceptance query**

Create `scripts/derived_queries/ae9_applies_to.sql`. Same gated-CTE convention as `ae8_faction_sources.sql`: the final SELECT returns rows only when every pinned check holds, and the recipe fails on zero rows.

```sql
-- ABOUTME: AE9 acceptance: applies_to edges cover every augment/component except the pinned
-- ABOUTME: template blank, with three card oracles (Spiritguard, Ancient Armor Plate, Amatok).
-- Empty result = failure. Pins at build 19149150: 446 of 447 augment/component records carry
-- applies_to edges (the gap is the dev template blank a00_blank.dbr), and three card oracles:
-- Spiritguard Powder = the seven armor slots ("all armor"), Ancient Armor Plate = chest+legs,
-- Rune of Amatok's Breath = medal only. A game patch that shifts any of these should fail
-- this recipe so the pins are re-checked against grimtools/in-game text.
WITH ap AS (
    SELECT e.record, l.text AS name, r.dst
    FROM entities e
    JOIN relations r ON r.src = e.record AND r.kind = 'applies_to'
    LEFT JOIN labels l ON l.locale = 'en' AND l.tag = e.name_tag
    WHERE e.domain IN ('augment', 'component')
),
sets AS (
    SELECT name, list(DISTINCT dst ORDER BY dst) AS slots FROM ap GROUP BY name
),
uncovered AS (
    SELECT record FROM entities
    WHERE domain IN ('augment', 'component')
      AND record NOT IN (SELECT record FROM ap)
),
checks AS (
    SELECT
      (SELECT slots FROM sets WHERE name = 'Spiritguard Powder')
        = ['chest', 'feet', 'hands', 'head', 'legs', 'shoulders', 'waist']
      AND (SELECT slots FROM sets WHERE name = 'Ancient Armor Plate') = ['chest', 'legs']
      AND (SELECT slots FROM sets WHERE name = 'Rune of Amatok''s Breath') = ['medal']
      AND (SELECT count(*) FROM uncovered) = 1
      AND (SELECT record FROM uncovered) = 'records/items/enchants/a00_blank.dbr'
      AS ok
)
SELECT s.name, s.slots
FROM sets s CROSS JOIN checks c
WHERE c.ok
  AND s.name IN ('Spiritguard Powder', 'Ancient Armor Plate', 'Rune of Amatok''s Breath')
ORDER BY s.name;
```

- [ ] **Step 2: Wire the justfile recipe and gate**

In `justfile`, after the `q-ae8-faction-sources` recipe (line 351), add:

```just
# AE9: applies-to edges cover all augments/components (446/447, blank pinned) + three card oracles
[group("deposit")]
q-ae9-applies-to: (_q-derived "ae9_applies_to.sql")
```

Extend `q-ae-all` (line 355) with the new dependency at the end:

```just
q-ae-all: q-ae1-cold-daggers q-ae2-augments-ring-amulet q-ae3-blueprint-links q-ae4-requirement-oracles q-ae5-legendary-2h-axes q-ae6-expansion-badges q-ae7-search-de q-ae8-faction-sources q-ae9-applies-to
```

Update the two count comments: line 314 `# One derived acceptance query (all eight below fail on zero rows...` -> `all nine below`; line 353 `# All eight derived acceptance queries...` -> `# All nine derived acceptance queries...`.

- [ ] **Step 3: Run the new recipe and the full gate**

Run: `just q-ae9-applies-to`
Expected: 3 rows (Ancient Armor Plate, Rune of Amatok's Breath, Spiritguard Powder with their slot lists), exit 0.

Run: `just q-ae-all`
Expected: all nine recipes pass.

- [ ] **Step 4: Update the doc counts**

- `docs/item-schema.md:27`: "`scripts/derived_queries/` holds eight" -> "holds nine".
- `docs/item-schema.md:103`: "the eight acceptance recipes (AE1-AE8)" -> "the nine acceptance recipes (AE1-AE9)".
- `docs/deposit.md:51`: "all eight acceptance queries" -> "all nine acceptance queries".

- [ ] **Step 5: Commit**

```bash
git add scripts/derived_queries/ae9_applies_to.sql justfile docs/item-schema.md docs/deposit.md
git commit -F - <<'EOF'
test(derived): ae9 acceptance pins applies_to coverage and card oracles

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
EOF
```

- [ ] **Step 6: Prove the gate catches drift (break test)**

Edit `scripts/derived_queries/ae9_applies_to.sql`: change `= ['medal']` to `= ['ring']`.

Run: `just q-ae9-applies-to`
Expected: 0 rows and a nonzero exit (the `_q-derived` helper fails on empty results).

Restore: `git checkout -- scripts/derived_queries/ae9_applies_to.sql`, then `just q-ae9-applies-to` passes again.

---

### Task 2: Merged set-valued gear-type facet in itemdb.html

**Files:**
- Modify: `itemdb.html` (registration block ~line 80, new applies-to block after the sources block ~line 126, FIELDS comment ~line 131, card meta line ~line 220)
- Test: `C:/Users/conta/AppData/Local/Temp/claude/C--Users-conta-Documents-grimdawn-devotions/40c4ebeb-5ff0-4b03-9c33-00b9abf14bae/scratchpad/itemdb-smoke.ts` (session scratchpad, not in repo; if missing, verify the same assertions manually via `just item-browser`)

**Interfaces:**
- Consumes: `relations.parquet` `applies_to` rows (src = augment/component record, dst = gear-type token).
- Produces: `it.applies_to` (sorted string array on augment/component items, `[]` when no edges) and set-valued `it.gear_type` for those domains. Task 3 reads `it.applies_to` for the card line.

- [ ] **Step 1: Extend the smoke test with failing assertions**

In `itemdb-smoke.ts`, after the `sourcesOk` block (before the `failed =` line), add:

```ts
  // --- applies-to: merged gear-type facet ---------------------------------------
  const gtButtons = await evaluate(
    `[...document.querySelectorAll('#groups .group')[1].querySelectorAll('button.f')].map(b => b.textContent).join(' ')`,
  );
  console.log(`gear-type buttons: ${gtButtons}`);
  await evaluate(`[...document.querySelectorAll('#groups .group')[0].querySelectorAll('button.f')].find(b => b.textContent.startsWith('augment')).click()`);
  await evaluate(`[...document.querySelectorAll('#groups .group')[1].querySelectorAll('button.f')].find(b => b.textContent.startsWith('medal')).click()`);
  await evaluate(`(() => { const s = document.getElementById('search'); s.value = 'breath'; s.dispatchEvent(new Event('input')); })()`);
  const breathCount = await evaluate("document.getElementById('count')?.textContent");
  const breathName = await evaluate("document.querySelector('#grid .card .name')?.textContent");
  console.log(`augment+medal+breath -> ${breathCount}; first: ${breathName}`);
  await evaluate(`(() => { const s = document.getElementById('search'); s.value = ''; s.dispatchEvent(new Event('input')); })()`);
  await evaluate(`[...document.querySelectorAll('button.f.on')].forEach(b => b.click())`);
  const appliesOk =
    gtButtons.includes("legs252") && !gtButtons.includes("augment") && !gtButtons.includes("component") &&
    String(breathCount).startsWith("1 match") && String(breathName).includes("Amatok's Breath");
  console.log(`applies-to facet: ${appliesOk ? "ok" : "WRONG"}`);
```

And extend the pass condition:

```ts
  failed = !(cards > 0 && String(firstCard).includes("Guillotine") && facetsOk && sourcesOk &&
    appliesOk && consoleErrors.length === 0);
```

- [ ] **Step 2: Run the smoke test to verify it fails**

Run: `bun run "C:/Users/conta/AppData/Local/Temp/claude/C--Users-conta-Documents-grimdawn-devotions/40c4ebeb-5ff0-4b03-9c33-00b9abf14bae/scratchpad/itemdb-smoke.ts"`
Expected: `applies-to facet: WRONG` (gear-type buttons still show `augment340`/`component107`, no `legs252`), `SMOKE FAIL`, exit 1.

- [ ] **Step 3: Implement the merge in itemdb.html**

Add the registration (in the `Promise.all` block, before labels):

```js
  reg("relations.parquet", "data/derived/relations.parquet"),
```

After the sources block (after the `for (const it of items) { ... it.source ... }` loop, ~line 126), add:

```js
// Applies-to: augments/components go ON other gear; their gear_type facet value set
// becomes those target types (same vocabulary as gear's own gear_type), so clicking
// "legs" matches legs armor AND everything applicable to legs.
const appliesByRecord = new Map();
for (const r of rows(await conn.query(`
    SELECT src, dst FROM 'relations.parquet' WHERE kind = 'applies_to' ORDER BY src, dst`))) {
  let list = appliesByRecord.get(r.src);
  if (!list) appliesByRecord.set(r.src, (list = []));
  list.push(r.dst);
}
for (const it of items) {
  if (it.domain === "augment" || it.domain === "component") {
    it.applies_to = appliesByRecord.get(it.record) ?? [];
    it.gear_type = it.applies_to;
  }
}
```

Update the filter-state comment (~line 132) from "`source` is set-valued (an item can be both vendor-sold and crafted); the other fields are scalars." to "`source` and `gear_type` are set-valued (an item can be both vendor-sold and crafted; an augment/component's gear types are the slots it applies to). Scalar fields wrap into one-element sets."

Update the card meta line (~line 220) so augments/components show their domain (arrays must not render):

```js
    <div class="meta">${esc(Array.isArray(it.gear_type) ? it.domain : (it.gear_type || it.domain))} · ilvl ${it.item_level ?? "?"}${it.attacks_per_sec ? ` · ${it.attacks_per_sec.toFixed(2)}/s` : ""}</div>
```

- [ ] **Step 4: Run the smoke test to verify it passes**

Run: `bun run "C:/Users/conta/AppData/Local/Temp/claude/C--Users-conta-Documents-grimdawn-devotions/40c4ebeb-5ff0-4b03-9c33-00b9abf14bae/scratchpad/itemdb-smoke.ts"`
Expected: `applies-to facet: ok`, `SMOKE PASS`, exit 0. All earlier assertions (facetsOk, sourcesOk) still ok: the domain facet still offers augment/component, and the source assertions do not touch gear type.

- [ ] **Step 5: Commit**

```bash
git add itemdb.html
git commit -F - <<'EOF'
feat(itemdb): gear-type facet merges applies-to targets for augments/components

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
EOF
```

---

### Task 3: Applies-to card line with group collapsing

**Files:**
- Modify: `itemdb.html` (CSS after the `.srcline` rule ~line 35, new `APPLY_GROUPS`/`appliesLine` after `sourceLine` ~line 203, card template ~line 220)
- Test: `C:/Users/conta/AppData/Local/Temp/claude/C--Users-conta-Documents-grimdawn-devotions/40c4ebeb-5ff0-4b03-9c33-00b9abf14bae/scratchpad/itemdb-smoke.ts` (same fallback as Task 2)

**Interfaces:**
- Consumes: `it.applies_to` from Task 2 (sorted string array or undefined for gear).
- Produces: nothing later tasks use; `appliesLine(slots)` returns `"Applies to ..."` or `null`.

- [ ] **Step 1: Extend the smoke test with failing assertions**

After the `appliesOk` block, add:

```ts
  // --- applies-to card lines -----------------------------------------------------
  await evaluate(`(() => { const s = document.getElementById('search'); s.value = 'spiritguard powder'; s.dispatchEvent(new Event('input')); })()`);
  const spiritLine = await evaluate("document.querySelector('#grid .card .apline')?.textContent");
  await evaluate(`(() => { const s = document.getElementById('search'); s.value = 'ancient armor plate'; s.dispatchEvent(new Event('input')); })()`);
  const plateLine = await evaluate("document.querySelector('#grid .card .apline')?.textContent");
  await evaluate(`(() => { const s = document.getElementById('search'); s.value = 'the guillotine'; s.dispatchEvent(new Event('input')); })()`);
  const gearApline = await evaluate("document.querySelector('#grid .card .apline') !== null");
  await evaluate(`(() => { const s = document.getElementById('search'); s.value = ''; s.dispatchEvent(new Event('input')); })()`);
  console.log(`Spiritguard: ${spiritLine} | Plate: ${plateLine} | gear has apline: ${gearApline}`);
  const aplinesOk =
    String(spiritLine) === "Applies to all armor" &&
    String(plateLine) === "Applies to chest, legs" && gearApline === false;
  console.log(`applies-to card lines: ${aplinesOk ? "ok" : "WRONG"}`);
```

And extend the pass condition to `... && appliesOk && aplinesOk && consoleErrors.length === 0`.

- [ ] **Step 2: Run the smoke test to verify it fails**

Run: `bun run "C:/Users/conta/AppData/Local/Temp/claude/C--Users-conta-Documents-grimdawn-devotions/40c4ebeb-5ff0-4b03-9c33-00b9abf14bae/scratchpad/itemdb-smoke.ts"`
Expected: `applies-to card lines: WRONG` (no `.apline` elements exist yet), `SMOKE FAIL`, exit 1.

- [ ] **Step 3: Implement the card line**

CSS, after the `.card .srcline` rule (~line 35):

```css
  .card .apline { color: #8fa8c8; font-size: 12px; margin: -4px 0 6px; }
```

After the `sourceLine` function (~line 203), add:

```js
// Applies-to display: collapse exact slot groups to an in-game style phrase, largest
// group first; leftovers list raw (the same tokens as the facet buttons).
const APPLY_GROUPS = [
  ["all weapons", ["axe1h", "axe2h", "dagger", "mace1h", "mace2h", "ranged1h", "ranged2h", "scepter", "spear2h", "sword1h", "sword2h"]],
  ["all armor", ["chest", "feet", "hands", "head", "legs", "shoulders", "waist"]],
  ["1h melee", ["axe1h", "dagger", "mace1h", "scepter", "sword1h"]],
  ["2h weapons", ["axe2h", "mace2h", "ranged2h", "spear2h", "sword2h"]],
  ["all jewelry", ["amulet", "medal", "ring"]],
];
function appliesLine(slots) {
  if (!slots || !slots.length) return null;
  const rest = new Set(slots);
  const parts = [];
  for (const [phrase, members] of APPLY_GROUPS) {
    if (members.every((m) => rest.has(m))) {
      parts.push(phrase);
      for (const m of members) rest.delete(m);
    }
  }
  parts.push(...[...rest].sort());
  return `Applies to ${parts.join(", ")}`;
}
```

In `card(it)`, compute the line and render it directly after the meta div (before the requirements line):

```js
  const apline = appliesLine(it.applies_to);
```

```js
    ${apline ? `<div class="apline">${esc(apline)}</div>` : ""}
```

- [ ] **Step 4: Run the smoke test to verify it passes**

Run: `bun run "C:/Users/conta/AppData/Local/Temp/claude/C--Users-conta-Documents-grimdawn-devotions/40c4ebeb-5ff0-4b03-9c33-00b9abf14bae/scratchpad/itemdb-smoke.ts"`
Expected: `applies-to card lines: ok`, `SMOKE PASS`, exit 0.

Spot-check the collapsing beyond the pins while the page is up (or via `just item-browser`): Ravager's Breath should read "Applies to 1h melee, offhand, ranged1h"; Potent Ravager's Breath "Applies to 2h weapons".

- [ ] **Step 5: Commit**

```bash
git add itemdb.html
git commit -F - <<'EOF'
feat(itemdb): applies-to card line with slot-group collapsing

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
EOF
```
