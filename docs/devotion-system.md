# The Grim Dawn Devotion System

A reference for humans and agents working on this planner. It describes what the
devotion system is, the rules that govern a legal build, the non-obvious
consequences of those rules for how a build is constructed, and the data
structures this project uses to model it.

For the reachability algorithm that decides which selections are legal within the
budget, see [reachability-engine.md](reachability-engine.md) and
[reachability-performance.md](reachability-performance.md). This document is about
the domain, not the engine.

## What it is

Grim Dawn's devotion system is a second skill tree. A character earns up to **55
devotion points** and spends them on a star map of **constellations**. The map in
our data has **109 constellations** and **559 stars** total.

Every count, cap, and named example in this document is specific to game version
**1.2.1.x** (the version stamped into `data/devotions.json`). After a game patch,
`just parse` rebuilds the dataset and these figures must be re-checked; the Fangs of
Asterkarn expansion (v1.3) is expected to change the map.

- A **constellation** is a named cluster of **stars** (1 to 8 of them) joined by
  links. Completing stars grants the bonuses on those stars, and completing the
  whole constellation grants its **celestial power** (a granted skill or proc) and
  its **affinity bonus**.
- A **star** costs **one devotion point**. Selecting a star grants that star's
  stat bonuses (and, on the last star of a constellation, the celestial power).
- **Affinity** is the gating currency. There are five affinity colors. Each
  constellation **requires** some affinity to be started and **grants** some
  affinity when fully completed. You spend points to build affinity, which unlocks
  more constellations.

The planner's job is to let a user claim stars in any order and tell them which
selections are legal (reachable) within their point budget.

## The five affinities

Order used throughout the code is `[ascendant, chaos, eldritch, order, primordial]`.

| Affinity   | In-game color | Engine cap |
|------------|---------------|-----------|
| ascendant  | purple        | 20 |
| chaos      | red           | 8  |
| eldritch   | green         | 20 |
| order      | yellow        | 10 |
| primordial | blue          | 20 |

The "engine cap" is the highest requirement any constellation imposes in that
color. Affinity beyond it gates nothing, so the engine clamps there (`CAP_MAX` in
`web/src/core/reachability.ts`). Chaos is the scarcest: nothing requires more than
8, and chaos sources are comparatively few.

## The Crossroads

There are exactly **five Crossroads**, one per color. Each is a single-star
constellation with **no requirement** that grants **+1 affinity** of its color:

```
crossroads_ascendant  -> +1 ascendant
crossroads_chaos      -> +1 chaos
crossroads_eldritch   -> +1 eldritch
crossroads_order      -> +1 order
crossroads_primordial -> +1 primordial
```

They are the only affinity you can buy with no prerequisite, so every build is
bootstrapped through them. Two facts about them drive most of the non-obvious
behavior below:

1. **There is only one of each.** You cannot stack a color from Crossroads alone;
   the most ascendant you can ever get from Crossroads is +1.
2. **They cost a point while held, and are refundable.** A Crossroads is one of
   your 55 points for as long as it is selected. You can remove it later (a
   refund), and the points come back.

## The core rules

1. **Budget.** At most 55 points (stars) selected at once.
2. **Predecessor order.** A star can only be selected if its predecessors in the
   same constellation are already selected. The predecessor graph is usually a
   chain but can branch (for example `affliction:5` branches off `affliction:2`).
3. **Activation requires affinity.** To place the **first** star of a
   constellation, your current affinity must meet that constellation's
   requirement. The requirement is checked against affinity you already have from
   **other** sources.
4. **Affinity is granted on completion.** A constellation contributes its affinity
   bonus only when **all** of its stars are selected. A partially filled
   constellation grants no affinity. (In the data, `affinity_bonus` is a property
   of the constellation, not of individual stars.)
5. **Removal cannot strand a dependent.** You may remove (refund) any star, but not
   if doing so would drop a still-selected constellation below its affinity
   requirement. The game keeps every selected constellation valid at all times.

A selection is **valid** when every constellation with at least one selected star
has its requirement met by the affinity of the currently completed constellations.

## Non-obvious consequences

These all fall out of "affinity is granted only on completion" plus "you must
already meet the requirement to activate." They are the parts that trip people (and
engines) up.

### Activation comes before self-sustain

A constellation cannot use its own grant to meet its own requirement, because the
grant does not exist until the constellation is complete, and you cannot start it
until the requirement is already met. So there is always a moment where the
requirement must be covered by **something else**. After completion, the
constellation's own grant joins the pool and may keep it satisfied on its own.

### Two flavors of self-sustaining

- **Individually self-sustaining (net-positive).** A constellation whose grant in a
  color is at least its own requirement in that color. Example: **Anvil** requires
  1 ascendant and grants 5. Activate it with the ascendant Crossroads, complete it,
  and it now supplies 5 ascendant, far more than the 1 it needed. The Crossroads can
  then be refunded. Anvil is pure scaffolding: spend one point to unlock it, and it
  pays you back affinity you can build the rest of the tree on. **Akeron's Scorpion**
  (eldritch 1 -> 5), **Crane** (order 1 -> 5), and similar tier-1 constellations are
  the workhorses of bootstrapping.
- **Group self-sustaining.** A constellation whose grant is **less** than its own
  requirement, so it can never stand alone, but whose requirement is met by the
  combined grants of a larger set it belongs to. Example: **Affliction** requires
  ascendant 4 and eldritch 4 (and chaos 3) but grants only ascendant 1 and
  eldritch 1. **Autumn Boar** grants ascendant 3; **Behemoth** grants eldritch 3.
  Once those are complete, the pooled ascendant (Autumn Boar's 3 plus Affliction's
  own 1) reaches the 4 Affliction needs, and eldritch reaches 4 the same way through
  Behemoth; the remaining chaos comes from Behemoth and other constellations in the
  build. The catch is that Autumn Boar **also** requires ascendant 4, so neither
  Affliction nor Autumn Boar can be the first to go down, and the single ascendant
  Crossroads supplies only 1. The group cannot bootstrap itself from Crossroads
  alone; it needs temporary outside affinity to break in.

Self-sustaining sets are almost always large and build-specific. Because every
member's requirement has to be covered in all five colors, small fully self-covering
sets are rare: across the current map there is exactly one self-sustaining **pair**
(Shieldmaiden and Ulo the Keeper of the Waters, which each require order 4 and
primordial 6 and together grant exactly that) and four self-sustaining **triples**.
Everything else that sustains itself does so only as part of a larger build, the way
the Affliction lock needs roughly nine constellations around it.

Twenty-one constellations grant **no affinity at all** (for example the big tier-3
capstones like Abomination and Azrakaa). These can never be self-sustaining or part
of a self-sustaining group. Their requirement must be met permanently by other
constellations in the final build.

### The affinity ladder

Affinity you have already built **persists** as you keep constructing, so a
Crossroads is a one-time cost at the bottom of the ladder, not a recurring tax. The
first source of a color is the expensive step: to field **Eel** (3 stars, requires
1 primordial, grants 5 primordial) you must temporarily hold the primordial
Crossroads to activate it. But once Eel is complete and supplying 5 primordial,
every later constellation that needs up to 5 primordial activates for just the cost
of its own stars, with no Crossroads at all. **Gallows** (4 stars, requires 1
primordial) costs only its 4 points once Eel is down, and you never need the
primordial Crossroads again for any primordial demand Eel already covers.

This is the broader meaning of "individually self-sustaining" above: such a
constellation does not merely pay back the one point it borrowed, it raises the
whole ladder for its color, and the rest of the build climbs it for free. A color
only forces another Crossroads when a constellation needs more of it than any
single completed source supplies, which is where the group locks below come in.

### Temporary scaffolding and the refund

The way to activate a group like Affliction's is to **temporarily** add an affinity
source, use it to activate the group, let the group's own grants take over, then
**refund** the temporary source. A concrete legal path for Affliction's trio:

1. Add the eldritch Crossroads, then **Quill** (requires eldritch 1, grants
   ascendant 3 and eldritch 3). That is enough ascendant and eldritch to start
   breaking into the locked group.
2. With Quill's affinity in hand, activate and complete the locked constellations
   (Autumn Boar, Affliction, Behemoth, and the rest of the build that supplies their
   remaining chaos and primordial needs). Once complete, the build's own pooled
   grants cover the ascendant 4 and eldritch 4 the lock required.
3. **Remove Quill** and the eldritch Crossroads. The build now meets its own
   requirements without them, so the refund is legal, and the points return for
   other stars.

Quill was never part of the final build. It was borrowed and returned. The full
legal sequence for the real build is a 25-move walk, but the shape is the point:
borrow affinity, break the lock, return the affinity, all while staying valid and
under 55 points at every step. This pattern, scaffolding that is paid for
transiently and refunded, is the crux of what makes a build reachable, and it is
exactly what a naive model misses.

### Affinity is never the blocker, budget is

If you ignore the point budget, the reachable affinity envelope (the transitive
closure of everything Crossroads-bootstrappable scaffolding can grant) reaches the
maximum cap in **every** color. In other words, with enough spare points you can
always reach any affinity you need through refundable scaffolding. So the only thing
that can make a self-covering build unreachable is **budget**: whether the temporary
scaffolding fits inside 55 points at the tightest moment of construction. A build
near the 55-point ceiling can be impossible purely because there is no room to hold
the scaffolding it needs to activate its hardest constellation.

### The construction peak, not the final total, is the cost

Because every intermediate state must stay under budget, the points that gate a
build are the **most you hold at any single instant** during a legal construction,
not the size of the finished selection. Transient scaffolding you will later refund
still counts while you hold it, so the peak can sit above the final total, and it is
the peak that has to fit the budget.

The simplest example in the whole system is a single tier-1 constellation. **Eel**
is 3 stars and requires 1 primordial. It looks like a 3-point pickup, but to place
its first star you must already hold 1 primordial, and the only source with no
prerequisite is the primordial Crossroads. So a legal construction is: hold the
Crossroads (1 point), complete Eel's 3 stars (the peak is now Crossroads plus 3
stars = **4 points**), then let Eel's own +5 primordial cover the requirement and
refund the Crossroads back down to 3. Eel is therefore unbuildable at a 3-point
budget and only becomes reachable at 4, even though the finished constellation is
3 points.

The same gap scales to the ceiling: a self-covering build that fits 55 points in its
final form is still unreachable if no construction order keeps the peak at or under
55, because some constellation can only be activated while extra scaffolding is held.
This is why "reachable" is decided on the construction peak, not on the point total
of the finished build.

### A legal selection need not be valid on its own

Because the planner lets you claim stars in any order, a selection can be a legal
work-in-progress without currently being valid. The original shared bug-report link
had Affliction at 5 of 7 stars with the affinity short, which is not a valid state
by itself, yet it is a legal prefix because it extends to a valid build (finish
Affliction's trio, or keep Quill). "Reachable" therefore means "extends to a valid,
constructible build within budget," not "is valid right now."

### What a valid construction path is

A target selection is **reachable at budget P** iff there is a sequence of
single-star adds and removes from the empty map to some valid build that contains
it, where every intermediate state is valid and at or under P points. Refunding is
just removal. This is the definition the reachability engine implements; see
[reachability-engine.md](reachability-engine.md).

## Data structures

### Domain model (`web/src/core/types.ts`, built by `web/src/core/model.ts`)

`buildModel(doc)` turns the raw JSON into a `DevotionModel`:

- `DevotionModel`
  - `stars: Map<StarId, Star>`
  - `constellations: Map<string, Constellation>`
- `Constellation`: `id`, `name`, `tier` (1 to 3), `affinityRequired`,
  `affinityBonus` (both `Partial<Record<Affinity, number>>`), `background`,
  `starIds: StarId[]`.
- `Star`: `id` (the string `"<constellationId>:<index>"`), `constellationId`,
  `index`, `predecessors: StarId[]`, `position`, `bonuses` (stat id to value),
  `petBonuses` (optional, "Bonus to All Pets" stats), `celestialPower`,
  `weaponRequirement`, `racialTarget`.
- A `StarId` is `` `${constellationId}:${index}` `` (for example `affliction:3`).

### Reachability representation (`web/src/core/reachability.ts`)

The engine reduces the model to compact per-constellation data:

- `Vec` is a 5-tuple of affinity in the canonical color order.
- `ReachCon`: `{ id, size, req: Vec, grant: Vec }`, one per constellation.
- `CoverTable`: a precomputed table answering "minimum scaffolding stars to reach at
  least affinity D," used as a bound during the reachability search.

## Exported JSON schema

`data/devotions.json` is a single object `{ "constellations": [...] }`. Each
constellation:

```jsonc
{
  "id": "affliction",
  "name": "Affliction",
  "tier": 2,
  "affinity_required": { "ascendant": 4, "chaos": 3, "eldritch": 4 },
  "affinity_bonus":    { "ascendant": 1, "eldritch": 1 },
  "background": { "image": "...", "x": 0, "y": 0 },
  "stars": [
    {
      "index": 0,
      "predecessors": [],            // indices within this constellation
      "position": { "x": 0, "y": 0 },
      "bonuses": { "offensivePhysicalMin": 40, "...": 0 },  // stat id -> value
      "celestial_power": {           // null unless this is the power star
        "name": "Fetid Pool",
        "description": "...",
        "proc": { "chance": 15, "trigger": "Attack" }, // null for always-on auras
        "level": 1,
        "stats": { "...": 0 },
        "pet": {                     // null unless the power summons a pet
          "name": "...", "count": 1, "duration": 12,
          "attack_stats": { "...": 0 }
        }
      },
      "weapon_requirement": { "weapons": ["Axe", "Axe2h"] }, // null if none
      "racial_target": ["Undead", "Human"],  // races a racialBonus* applies to
      "pet_bonuses": { "defensivePoison": 20 } // "Bonus to All Pets" stats
    }
  ]
}
```

Notes:

- `affinity_required` and `affinity_bonus` are **constellation-level**. Affinity is
  not granted per star; that is why a half-filled constellation supplies none.
- `predecessors` are star indices local to the constellation, mapped to global
  `StarId`s by `buildModel`.
- The five Crossroads all share the display name "Crossroads"; they are
  distinguished by `id` (`crossroads_<color>`).
- Most star fields are optional or nullable. A typical star has only `index`,
  `predecessors`, `position`, and `bonuses`.
