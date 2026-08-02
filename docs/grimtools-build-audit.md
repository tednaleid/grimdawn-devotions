# Auditing a grimtools build

How to read a character out of a shared `grimtools.com/calc/<id>` link and audit
it against this project's own data. The goal is a report where every claim is
traceable to data rather than recollection.

Two scripts do the mechanical work; everything below explains why they are shaped
the way they are, and what still needs a human eye:

```
bun scripts/gt_scrape.ts https://www.grimtools.com/calc/<id> build.json
uv run scripts/gt_audit.py build.json
```

`gt_scrape.ts` loads the page and writes one JSON blob: gear, skills, devotions,
the buff catalogue, and the full character sheet in three named buff states with
resistance overcap for each. `gt_audit.py` turns that into findings - the RR
ledger, the monster cross-check, circuit breakers, and a planner link. Its
parsing rules are pure and pinned by `scripts/test_gt_audit.py`, because every
one of them exists to fix a mistake a hand-written regex made first.

## Getting the build out of grimtools

The build is **not** server-rendered and there is **no API call to intercept**:
the whole character is encoded in the URL slug and decoded client side, so the
page has to actually run. Confirmed by watching the network, where nothing
fetches build data.

Drive headless Chromium over CDP. `web/e2e/smoke.ts` already carries that
machinery, including the reason for a raw CDP client rather than Playwright's
transports (they do not connect under Bun on Windows). Reduce it to "load a URL,
evaluate expressions, print JSON" and everything below is a one-line probe.

### The three functions that do the work

GrimTools exposes debug helpers as globals that return **fully rendered tooltip
text**, exactly what a user sees on hover. No DOM scraping, no clicking through
panels:

| Call | Returns |
| --- | --- |
| `dumpItems()` | `[{slot, details}]`; details is the whole tooltip: base item, set bonuses, granted skills, components, augments |
| `dumpSkills()` | `[{id, name, level, childSkillIds, parentSkillIds, details}]` for mastery skills |
| `dumpDevotion()` | `[{id, name, details, isSkill}]` for every star; `isSkill: true` marks a celestial power |

Also useful: `getCombinedClassName()` returns the class name ("Sentinel");
`getText(tag)` resolves any game tag; `buildInfo.data` holds the raw structure
(`bio`, `equipment` as item ids, `skills`, `itemSkills`, `potions`); and
`buildInfo.masteries` gives the two-digit playerclass numbers.

### The character sheet is larger than it looks

Every stat carries a `stat="..."` attribute. `querySelectorAll("[stat]")` finds
**167** of them while the summary panel shows about 19; the rest sit in hidden
tabs. Hidden nodes have no `innerText`, so read **`textContent`** and the whole
sheet arrives in one pass: damage modifiers, crit, speeds, block, dodge,
retaliation, and every control resistance.

## Two traps that produce confidently wrong advice

Neither is discoverable by reasoning. Both require checking the page.

### Shared builds have buffs switched off

**The most important thing in this document.** GrimTools shares a build with most
buffs off. A build showing `Buffs (5/15)` had **Blood of Dreeg** among the ten
that were off, and that buff carried +120% Poison & Acid and +19% Physical
Resistance.

The panel therefore read **Poison 36%** and **Physical 18%**, which look like
glaring holes and are not: with the buff on they are **83%** and **37%**.

Read the buff panel before believing any defensive number. Three things about it
are easy to get wrong, and each fails silently:

- **`.buff-row` does not exist until the panel is opened.** Querying first returns
  an empty list that looks exactly like "there is nothing to toggle".
- **Toggling a buff replaces the row element.** A held reference goes stale, so
  clicking it again does nothing. Re-query by name for every toggle.
- **The row's class does not update in place either.** Confirm a toggle actually
  landed by reading `.buff-popup-header`, which counts them: `Buffs (2/16)`.

```js
document.querySelector(".buff-toggle.text-image-button").click();  // rows appear only now
[...document.querySelectorAll(".buff-row")].map((r) => ({
  name: r.querySelector(".buff-name")?.textContent.trim(),
  source: r.querySelector(".buff-source")?.textContent.trim(),
  state: /buff-locked/.test(r.className) ? "always-on"
       : /buff-off/.test(r.className) ? "OFF" : "ON",
}));
```

The panel groups buffs as **Permanent**, **Toggled**, **Activated** and
**Triggered**, which is a better spine for a report than on/off: an Activated
mastery buff is one the player keeps up, a Triggered proc is conditional, and a
potion is neither. Report numbers in named states ("as shared", "sustained",
"all procs") rather than one ambiguous column, and say which group each state
turned on.

### Difficulty is a viewer setting, and it moves every resistance

Grimtools has a difficulty selector, and the shared link carries whatever the
author left it on. Elite subtracts 25 from every player resistance and Ultimate
subtracts 50, applied before the cap, so **the same character reads +79 poison
cushion on Normal and +29 on Ultimate**. Measured on one build by flipping the
selector:

| | Normal | Elite | Ultimate |
| --- | --- | --- | --- |
| Poison | +79 | +54 | +29 |
| Pierce | +71 | +46 | +21 |
| Fire | +125 | +100 | +75 |

Judge cushions at Ultimate, because that is where the character is played.
`gt_scrape.ts` forces the selector to Ultimate before reading anything and warns
if it could not. Read the current setting from `.difficulty-selector`, whose text
begins with the active label.

**A cushion of about +30 is the useful target** - enough to absorb the resistance
reduction enemies apply, past which it stops paying for itself. That number turns
a wall of raw overcap figures into an actual verdict: +126 elemental is budget to
reclaim, +21 pierce is not. Getting this wrong in the generous direction produces
the worst kind of advice, telling someone to strip a resistance that was already
at its limit.

### The resistance panel hides overcap

The panel shows the **capped** value, so every resistance reading exactly `80%`
may be sitting on a huge cushion or none at all and they look identical. The
tooltip carries the truth:

The hover is a jQuery event and the text lands in `.tooltip-v2`, appended near the
end of `<body>`. Take the last one: earlier matches are pre-existing hidden popups.

```js
$(document.querySelector('[stat="resFire"]')).trigger("mouseenter");
[...document.querySelectorAll(".tooltip-v2")].map((n) => n.textContent.trim()).pop();
// -> "Fire 80% (+78% Over Maximum) Resistance to incendiary attacks..."
```

On one build this turned "seven resistances at exactly 80, no cushion" into
"+106, +88, +78, +78, +44, +22, +22, and one at **+5**". The advice reversed
completely, because the thin resistance was aether and the panel gave no hint.

### A tooltip states the same bonus more than once

Three overlaps, all of which inflate any total computed by grepping a whole
tooltip. On one audited build they turned a real -90% cold into -115%.

1. **Every skill tooltip prints `Current Level` and `Next Level`**, each with a
   full stat block. Cut at `Next Level` and read only what precedes it.
2. **A devotion celestial power is printed inside the tooltip of the skill it is
   bound to**, and again by `dumpDevotion()`. Count it once. Cutting at
   `Next Level` drops the skill-side copy, since the power block follows it.
3. **`-X% Elemental Resistance` is one line that reduces three resistances.**
   Expand it into Fire, Cold and Lightning rather than reporting "Elemental" as a
   damage type of its own, or it silently vanishes from every per-type total.

`gt_audit.current_block` and `collect_rr` implement all three.

## Cross-checking against our own data

### Devotions to a planner link

`data/devotions.json` holds every constellation and star. Map the scraped stars
onto our star ids, then encode the hash exactly as `web/src/core/urlState.ts`
does: a trailing-trimmed LSB-first bitset over `canonicalStarIds(model)`
(constellation insertion order, then star index), base64url without padding, as
`#p=<cap>&s=<bitset>`. Adding `&cs=<same>&cp=<cap>` pins it as the comparison
baseline.

Completed constellations are unambiguous (take every star). Partial ones need
each star matched against our structured bonuses, which works by comparing the
multiset of magnitudes in the tooltip text.

Celestial-power stars are named after the power rather than the constellation, so
resolve those first - but **split them off with `dumpDevotion()`'s `isSkill` flag,
never by name**. A constellation and a power can share a name: Tsunami is both, so
a name-based split treats all five Tsunami entries as the one power star and
silently loses four stars. That failure looks like a clean run, because the
leftover stars are simply never assigned.

**Verify the result by decoding it with the app's own `decodeHash` and
`buildModel`** instead of trusting the encoder. A positional bitset that is
subtly wrong still decodes to a plausible-looking build.

Check `data/devotions.json` matches `origin/main` before sharing a link: the
deployed site's star ordering is what the bitset indexes into.

### Deducing what the scrape leaves ambiguous

The five Crossroads constellations share one name tag and two of them grant the
same +5% Health, so the scrape cannot say which was taken. Legality settles it: a
build with 5 stars in Abomination needs **chaos 8**, and only `crossroads_chaos`
reaches that.

Affinity totals come from **completed constellations only**; partial ones grant
nothing. Tier 3 constellations grant no affinity at all, so "finish it for the
bonus" is wrong advice for those.

### Resistance reduction

The stacking rules live in `web/src/rr/core/ledger.ts` and are not intuitive:

1. **stacking** (`-X% Resistance`) - every source **sums**
2. **reduced-percent** (`X% Reduced target's Resistances`) - **highest only**,
   multiplicative, and it only shrinks resistance that is still **positive**
3. **reduced-flat** (`X Reduced target's Resistances`) - **highest only**, subtracts

```
base  = r0 - sumStack
final = (base > 0 ? base * (1 - maxMult / 100) : base) - maxFlat
```

The consequence is worth internalising: **once stacking drives a resistance to
zero, multiplicative RR does nothing.** That "do not buy this" finding only exists
because we hold the monster table.

Answering it correctly needs one more step. **`data/monsters.json` stores base
resistances; the per-difficulty bonuses live in a separate `difficulty_offsets`
table and must be added.** Skipping them makes every Elite and Ultimate answer too
optimistic - Ultimate tier 4 adds +15 cold and +15 chaos. Scope the pool to
non-summon `Boss`, `Hero`, `Quest`, `Champion` and `SuperBoss` (1,400 records);
omitting Champion and SuperBoss drops it to 710 and hides exactly the enemies that
resist hardest.

Worked both ways on real builds: a character with **-104% chaos** stacking has 15
of those 1,400 still positive on Ultimate, and one with **-90% cold** has 19. In
both cases the answer is the same in practice - multiplicative RR is dead weight
against roughly 99% of the game - but it is *not* zero, and the exceptions are
the superbosses (Callagadra, Avatar of Mogdrogen, the Ravagers, The Dread,
N'erfatal), which is precisely the content someone might buy that item for.
`gt_audit.monster_check` does this with the offsets applied.

To deep-link the RR page, ids come from `aggregate(parseCatalogue(doc).sources)`
and the hash is `#source=devotion,skill,item&sel=<ids>&r0=<n>`. **`source=` must
be set explicitly**, because the default is `devotion,skill` and items are opt-in.

Two limits to state whenever the page is linked: the catalogue holds **max-rank**
values rather than the character's ranks, and it only covers RR granted by a
**skill**, so flat item lines (`-16% Chaos Resistance` printed on a weapon) are
absent. It reported -78% chaos for a build that actually has -104%.

The catalogue also has **no notion of pet-applied RR**. 39 sources are applied by
a summon rather than the player and none are marked, so a pet debuff renders
identically to one the player casts. Separately, 34 sources have `name == parent`
because the record carries no `skillDisplayName`, which shows on the page as a
mastery name with a blank skill column.

### Items

`scripts/gditems.py` searches the derived index ([item-cli.md](item-cli.md)).

- `--fits <slot>` answers "what augments and components can go here".
- A criterion matching nothing is reported in `unmatched_criteria` rather than
  silently dropped, which is how we learned that **no augment in the game grants
  physical resistance** and **no medal does either**. Those are answers, not
  failures.
- Our tokens are not always the game's words: Poison & Acid is `acid`, and
  conversion types are capitalised (`Chaos`).
- **The in-game "Awakened " prefix is not part of the item's name.** An Ascension
  craft shares its base item's name tag and item level, differing only in rarity,
  so `show "Awakened Bloodmane's Mark"` finds nothing. Strip the prefix and pick
  the candidate whose record lives under `records/items/awakened/`; `show` lists
  both with their record paths rather than guessing.
- A criterion coming back unmatched is worth one sanity check before it goes in a
  report. `resist.physical` returning nothing for augments, components and medals
  is a real answer (the stat is well represented on shoulders, chest, head, legs
  and feet, so the query works). The same empty result from a token that matches
  nothing anywhere would be a data gap wearing the same clothes.

**Check the deposit's game version against the build's.** `data/deposit/meta.parquet`
carries `game_version`. Auditing a 1.3.0.0 build against a 1.2.1.x index is fine
for finding candidates, but stats may have moved and the report has to say so.

### Armour and armour absorption

Armour is easy to fold into "damage reduction" and get wrong, because it is much
narrower than it looks. All of this is checkable in the extracted files.

- **Armour reduces physical damage only.** The game's own stat description
  (`tagCharStatsArmorTotalDescription`) reads "the less damage you will take from
  physical attacks". Nothing else: not cold, fire, lightning, aether, chaos,
  vitality, poison or pierce, and not damage-over-time.
- **Absorption is 70% by default**, from `armorDefensiveAbsorption` in
  `records/game/gameengine.dbr`. The other records carrying that key are dev
  sandbox archives and the in-game UI copy - do not read a different default off
  one of those.
- **It absorbs 70% of the damage falling within the armour value, and none of the
  excess**: `absorbed = min(hit, armour) x absorption`. At 3,047 armour a 3,000
  hit lands for 900, while a 6,000 hit lands for 3,867, because the absorbed
  amount is capped by the armour value rather than the hit. Armour is strong
  against many medium physical hits and weak against one large one.
- **"Increases Armour Absorption by X%" multiplies the 70, it does not add to
  it**: +20% gives 70 x 1.2 = 84%. Only two devotion stars grant it at all -
  Obelisk of Menhir's fifth (+18%) and Anvil's second (+3%).
- **Armour Piercing routes around it.** 299 records convert a share of physical
  damage into pierce, which is checked against pierce resistance instead.

What this audit has *not* verified from data is the order in which armour and
physical resistance apply to the same hit, so report them as separate mitigation
steps rather than multiplying them into one number.

## Arithmetic worth double-checking

**Percent health applies to the flat pool, not the displayed total.** Seven
augments at +4% each are not 28% of the 18,612 shown, because that double-counts
the bonus they already contribute. Sum every `+X% Health` in the build, divide the
total by `1 + P` to recover the flat base, and the augments are worth
`0.28 x base`. For that build the answer was ~2,800, not the ~1,300 first
estimated, and the correction changed the recommendation: 2,800 health is not
something to trade away from a character that is dying.

**A `0` on the character sheet can mean "not on the bare weapon attack" rather
than "absent".** One sheet read 0 Burn Damage against a +913% Burn modifier, which
looked like dead stat budget. It was not: the default attack skill dealt 171 burn
over 3 seconds itself, and three other skills added flat fire. Check whether
skills supply what the base sheet lacks.

**Set bonuses in a tooltip are not the item's own stats.** A regex over item text
picked up `+2 to all Skills` from a 4-piece bonus the character did not have and
attributed it to a single equipped piece, nearly recommending a good item away.
Parse the tooltip's blocks (base, set, `[Components]`, `[Augments]`,
`[Granted Skills]`) rather than grepping the whole thing.

## What the report should contain

Ordered by what mattered to the person asking:

1. **The buff caveat first**, or every defensive number below it is misread.
2. **Circuit breakers**, with threshold, cooldown and effect. Find them by
   scanning item and skill tooltips for `Activates when Health drops below`, and
   devotion powers via `celestial_power.proc.trigger_key == "LowHealth"` in
   `data/devotions.json`. Devotions whose proc is `HitByEnemy` on a short
   cooldown (Chariot of the Dead, Behemoth) work similarly and belong alongside.
3. **Resistances in named buff states**, with overcap.
4. **The RR ledger** with the three passes separated, and which parts are passive
   versus conditional.
5. **Suggestions**, each a clickable grimtools link. `gditems.py show --json`
   returns a `url` built from name plus exact item level.
6. **A provenance footer** naming the game version behind each claim.

Say plainly when a slot the owner calls a "placeholder" is load-bearing. In one
audit the shoulders carried 1,666 armor and a circuit breaker, and the report's
job was to say "keep this" rather than to find a replacement.
