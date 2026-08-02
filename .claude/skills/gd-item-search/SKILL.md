---
name: gd-item-search
description: Answer Grim Dawn item and build questions (gear, augments, components, relics; skills, masteries, damage conversion, resistances) using the item query CLI over the derived item database. Use when asked to find, recommend, or compare Grim Dawn items for a build, or to look up what an item does.
---

# gd-item-search

Answer Grim Dawn build questions with `scripts/gditems.py`, a standalone CLI
over the derived item database (see [docs/item-cli.md](../../../docs/item-cli.md)
for the full flag reference). Run it through the justfile passthrough
(`just items ...`), which this repo prefers, or directly with `uv run
scripts/gditems.py ...` - both are equivalent. Never guess at item names,
skill names, or stat tokens - the vocabulary is real data, and every flag
rejects an unknown token loudly rather than returning a misleadingly empty
result.

If the derived data has not been fetched yet, every subcommand fails fast
with one fixed line on stderr and exit code 2:

```
data/derived not found. Run: just fetch-deposit
```

Run `just fetch-deposit` and retry rather than treating that as a dead end.

## Workflow

1. **Call `vocab` before composing flags.**

   ```
   just items vocab --json
   ```

   (equivalently: `uv run scripts/gditems.py vocab --json`)

   This lists every real domain, gear type, slot, rarity, expansion, stat
   family, conversion type, mastery, skill, and granted-skill name. Compose
   `search` flags from these tokens, not from guesses or grimtools
   terminology - a plausible-looking token that happens to be wrong for this
   data set otherwise fails or silently matches nothing. Conversion types are
   capitalized (`Pierce`, not `pierce`).

   Skill and mastery flags read different vocabulary keys: `--boosts-skill`
   and `--mastery` resolve against `skills` (bonuses a mastery/item confers),
   `--grants-skill` resolves against `granted_skills` (skills an item
   outright grants). Nine display names exist in both keys and point at
   different records in eight of those nine cases, so look a name up in the
   key matching the flag you intend to use, not just any key that contains
   it.

2. **Run `search --json`.**

   ```
   uv run scripts/gditems.py search --domain gear,relic --mastery Nightblade \
     --converts-to Pierce --level 70 --json
   ```

   `--json` gives the same query as the table, structured for reasoning:
   each result carries its score breakdown (`parts`), `domain`, source, tier
   ladder, and grimtools URL. Use `--explain` (table mode) if you need the
   per-criterion arithmetic spelled out for a human.

   Read `domain` whenever a search spans more than one: an augment and a
   component are acquired and slotted differently, and nothing else in the
   row tells them apart. In `parts`, `name` is the record-keyed criterion
   label and `display` is the readable form (`boosts_skill:Chilling Rounds`);
   quote `display` in a report, not `name`.

3. **Read `unmatched_criteria` before concluding nothing matches.**

   A criterion nobody in the pool satisfies at all looks identical to an
   empty result unless you check this field. It names every scored
   criterion (not scope flags like `--domain` or `--level`) that matched
   zero candidates, computed before `--limit` truncates the pool:

   ```json
   "unmatched_criteria": ["stat:damage.pierce"]
   ```

   If a criterion you actually care about shows up here, the query is
   telling you that criterion is impossible to satisfy alongside the rest,
   not that the search came up empty by chance. Report that distinction
   rather than silently dropping the criterion or presenting a partial match
   as if it were complete.

4. **Never describe an `unknown` source as a world drop.**

   `source` renders as `vendor`, `crafted`, or `unknown`. `unknown` means
   *unattributed in this data* - it is not evidence the item drops from
   monsters, and it must never be written up that way. Augments (97.9%),
   relics (96.7%), and components (78.5%) are well attributed (build
   24346246). Gear is not: only 7.8% of gear records carry any source row,
   and affixes carry none at all (0%). Gear is exactly the domain a player
   most wants a farming answer for, so most gear recommendations will
   legitimately have no acquisition story to tell. Say so plainly rather
   than inventing one. Farmability data waits on a separate, not-yet-built
   loot-table graph (see BACKLOG.md).

5. **Use `show` for per-item detail, then publish the recommendations as an
   artifact.**

   ```
   uv run scripts/gditems.py show "Item Name" --json
   ```

   `show` gives full stats, boosts, granted skills, conversions, and set
   membership for one item, resolved unambiguously by record path (search
   results already carry `record`). If a bare name is ambiguous - the same
   display name can belong to several tiers of one family, or to two
   unrelated families entirely - `show` lists every candidate and exits
   non-zero rather than guessing; pick one by its `record` path.

   Publish the final recommendations as an artifact page. For each item
   include: why it was picked (which criteria it satisfies, from `parts`),
   its source label exactly as the CLI reports it (`vendor` / `crafted` /
   `unknown`, never reworded into "world drop" or similar), and its
   grimtools link for the reader to inspect further. Repeat the CLI's own
   honesty line ("Score reflects only the criteria you passed. It ranks
   candidates and does not judge builds.") near the ranking, since the
   score is a relative filter-and-rank tool, not a verdict on whether the
   build is good.

## Reference

Full flag surface, name-resolution rules, tier-ladder semantics, error
messages, and worked examples: [docs/item-cli.md](../../../docs/item-cli.md).
