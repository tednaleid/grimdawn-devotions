# Resistance reduction

How the Resistance Reduction page resolves an enemy's final resistance from a set of
selected debuffs, and where that formula comes from. The implementation is
`web/src/rr/core/ledger.ts` (`resolveLedger`); the catalogue of sources is
`data/resistance-reduction.json`, produced by `scripts/parse_rr.py`.

## The three types

Grim Dawn has three mechanically distinct kinds of enemy resistance reduction, told
apart by the wording of the stat line. Both "Reduced" types share the keyword
"Reduced target's Resistances"; the percent sign separates them.

| Type | Stat wording | Stacking rule | Catalogue `rr_type` |
|------|--------------|---------------|---------------------|
| Stacking | `-X% [type] Resistance` | Every source adds. Unlimited. | `stacking` |
| Multiplicative | `X% Reduced target's [type] Resistances` | Only the single highest source per resistance applies. | `reduced-percent` |
| Flat | `X Reduced target's [type] Resistances` (no percent sign) | Only the single highest source per resistance applies. | `reduced-flat` |

"Elemental" is not a resistance: an Elemental source applies its full value to Fire,
Cold, and Lightning at once. "All" sources apply to every resistance. Poison and Acid
share one resistance.

## The formula

Per resistance, with `R0` the enemy's starting resistance, `S` the sum of the
absolute values of every stacking source hitting it, `M` the highest multiplicative
value, and `F` the highest flat value:

```
base  = R0 - S
final = base * (1 - sign(base) * M / 100) - F
```

Order of application is stacking, then multiplicative, then flat.

The multiplicative step is sign-aware. It scales the post-stacking value away from
zero in both directions: it shrinks a positive resistance and can never push it
across zero by itself, and it deepens a resistance that stacking has already driven
negative. Community shorthand for this is "cannot reduce resistances below zero",
which describes the positive case only; the measured table below shows the
negative case (the -50 column under 51% mult alone).

The flat step is applied last and can take the resistance below zero. A negative
final value means the enemy takes that much more damage than at zero resistance.
Fractions are kept, not rounded.

## Worked examples

### Measured damage table (origin thread)

DenisMashutikov's in-game measurements, reproduced from the table image in the
origin thread linked below. Olexra's Flash Freeze at 178 cold damage (a rounded
display) against a training dummy and modded skeletons at each starting cold
resistance, under every combination of -30% stacking (Curse of Frailty with
Vulnerability), 51% multiplicative, and 43 flat (both on a custom weapon). Cells are
the damage dealt.

| Debuffs applied | 0 | 50 | 75 | 100 | -50 |
|-----------------|---|----|----|-----|-----|
| none | 178 | 89 | 44 | 0 | 266 |
| -30% | 231 | 142 | 98 | 53 | 320 |
| 43 flat | 254 | 168 | 121 | 76 | 343 |
| 51% mult | 178 | 134 | 112 | 91 | 312 |
| -30% and 43 flat | 307 | 218 | 174 | 130 | 396 |
| -30% and 51% mult | 258 | 160 | 138 | 117 | 392 |
| 51% mult and 43 flat | 254 | 210 | 189 | 167 | 388 |
| all three | 334 | 237 | 215 | 193 | 469 |

Predicted damage is `178 * (100 - final) / 100`. The formula lands within 2.5
damage of every cell; the 50% column with flat 43 alone is the only cell more than
1.2 away, and the base damage itself is a rounded display. The table is a test in
`web/test/rr/ledger.test.ts` with a tolerance of 3.

### Derived examples

From the origin thread. Start 0, stacking -30, multiplicative 51, flat 43:

```
(0 - 30) * (1 + 0.51) - 43 = -88.3
```

From the Japanese wiki. An enemy at 60% Fire and 60% Chaos hit by Agonizing Flames
(25 flat, all), Elemental Storm (32 flat, elemental), Thermite Mine with Hellfire
Mine (-30% elemental, -35% chaos), Eldritch Fire (-23% fire, -35% chaos), and Terror
(18% multiplicative, all):

```
Fire:  flat 32, stacking 30 + 23 = 53, mult 18
       (60 - 53) * (1 - 0.18) - 32 = -26.26
Chaos: flat 25, stacking 35 + 35 = 70, mult 18
       (60 - 70) * (1 + 0.18) - 25 = -36.8
```

## Sources

The formula rests on controlled in-game testing that the community has adopted.
There is no developer statement of the formula.

- [Actual Resist Reduction formula](https://forums.crateentertainment.com/t/actual-resist-reduction-formula/47174),
  Crate forum, DenisMashutikov, September 2018, for game version 1.0.6.1. The origin
  of the formula and of the damage table above. The post credits Gray and Maeror of
  the Russian community with first noticing the mismatch and confirming it with a
  mod. Ceno, the author of the community mechanics compendium, replies in the thread
  that they verified the math independently. The
  [Advanced Mechanics](https://forums.crateentertainment.com/t/advanced-mechanics/29059)
  thread gives a different order (multiplicative last) that does not reproduce the
  measured damage; do not use it as a source.
- [Grim Dawn Japanese wiki, Combat Mechanics](https://wikiwiki.jp/gdcrate/Combat%20Mechanics),
  section "デバフの種類と計算式 (耐性減少など)". Cites the thread above as the
  origin, gives the formula as two branches (base at or above the stacking total,
  and below it), and supplies the worked example reproduced here.
- The [official game guide](https://www.grimdawn.com/guide/gameplay/combat/) only
  confirms that differently named `-X%` debuffs stack with each other.
