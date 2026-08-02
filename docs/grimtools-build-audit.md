# Auditing a grimtools build

How to read a character out of a shared `grimtools.com/calc/<id>` link and audit
it against this project's own data. The goal is a report where every claim is
traceable to data rather than recollection.

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

Read the buff panel before believing any defensive number:

```js
document.querySelector(".buff-toggle.text-image-button").click();
[...document.querySelectorAll(".buff-row")].map((r) => ({
  name: r.querySelector(".buff-name")?.textContent.trim(),
  source: r.querySelector(".buff-source")?.textContent.trim(),
  state: /buff-locked/.test(r.className) ? "always-on"
       : /buff-off/.test(r.className) ? "OFF" : "ON",
}));
```

Then click the rows worth enabling and re-read the stats. Report numbers in named
states ("as shared", "with Blood of Dreeg", "with cooldowns") rather than one
ambiguous column.

### The resistance panel hides overcap

The panel shows the **capped** value, so every resistance reading exactly `80%`
may be sitting on a huge cushion or none at all and they look identical. The
tooltip carries the truth:

```js
$(document.querySelector('[stat="resFire"]')).trigger("mouseenter");
// -> "Fire 80% (+78% Over Maximum) Resistance to incendiary attacks..."
```

On one build this turned "seven resistances at exactly 80, no cushion" into
"+106, +88, +78, +78, +44, +22, +22, and one at **+5**". The advice reversed
completely, because the thin resistance was aether and the panel gave no hint.

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
multiset of magnitudes in the tooltip text. Celestial-power stars are named after
the power rather than the constellation, so resolve those first.

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
zero, multiplicative RR does nothing.** One audited build had -104% chaos
stacking, and checking every non-summon boss and hero in `data/monsters.json`
(710 of them) found **none above 104%**, so every multiplicative RR item was
worthless to that character. That "do not buy this" finding only exists because
we hold the monster table.

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

**Check the deposit's game version against the build's.** `data/deposit/meta.parquet`
carries `game_version`. Auditing a 1.3.0.0 build against a 1.2.1.x index is fine
for finding candidates, but stats may have moved and the report has to say so.

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
