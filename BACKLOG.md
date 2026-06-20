# Backlog

Planned enhancements for the web planner that are not yet started. Each item
includes implementation pointers for whoever picks it up.

## UI: surface what changed

### 1. Highlight changed Benefit values on add/remove
When a star or constellation is selected or deselected, the Benefits panel (left
sidebar) should make the delta obvious: highlight values that increased (for
example yellow text) and values that decreased (for example red text), ideally
fading after a moment.

Notes:
- `web/src/adapters/sidebarView.ts` `renderBenefits` rebuilds innerHTML on every
  refresh. To show deltas, diff the previous summed bonuses against the new ones,
  keyed on the raw stat id (not the formatted label), and tag changed rows.
- Previous totals need to persist between refreshes (hold them in `app/main.ts`
  or in the adapter).
- Decide: transient flash (CSS animation that clears on the next change) vs.
  persistent highlight until the next selection.

### 2. Highlight changed Affinity numbers on add/remove
Same treatment for the Affinity panel (right sidebar): when a pick changes
affinity totals, color the numbers that went up or down.

Notes:
- `renderAffinities` in the same file; diff previous vs. new `affinityTotals`.
- Share the diff and highlight helper with item 1.

## UI: celestial powers

### 3. Mark celestial-power stars and show full descriptions
Celestial-power stars should look special on the map (for example diamonds
instead of circles). Hovering one should show the power's full description.
Hovering a celestial power's name in the left Benefits list should also show the
full description.

Notes:
- The full text is already in `data/devotions.json`
  (`celestial_power.description`, `skill_class`), but `web/src/core/model.ts`
  maps only `{ name }`. Extend `Star.celestialPower` to carry `description` (and
  maybe `skill_class`).
- `web/src/adapters/svgRenderer.ts` renders every star as a `<circle>`. Render
  power stars as a rotated square or `<polygon>` diamond, keeping the hit target
  and gradient logic.
- `tooltipView.ts` should include the description for a power star.
- The sidebar power rows in `renderBenefits` need hover descriptions (a title
  attribute, or route them through the shared tooltip).

## UI: benefits organization

### 4. Group Benefits by type instead of alphabetical
The Benefits list should be grouped by category (for example: attributes and core
stats like Physique, Spirit, speeds, energy; resistances; damage types) rather
than one flat alphabetical list.

Notes:
- `web/src/core/statFormat.ts` `classify` could return a `group` per stat;
  `formatBonusRows` currently sorts alphabetically by label. Group rows under
  headings and order the groups deliberately.
- Suggested groups: Attributes and core stats; Offense (damage by type); Defense
  (resistances, armor, duration reductions); Other.
- Consider whether to apply the same grouping to the constellation tooltip union
  or keep that flat.

## UI: controls

### 5. Reset all selected points
Add a button in the header that clears the whole selection (all points back to
zero), leaving the point cap as is.

Notes:
- This is separate from the existing "Reset view" button (`#reset-view`), which
  only resets pan and zoom. Add a distinct control (for example "Reset points"
  or "Clear").
- `web/src/app/main.ts`: set `state = { selected: new Set(), pointCap: state.pointCap }`
  then `refresh()`. Because `refresh()` already writes the URL hash, the cleared
  state will persist to the URL automatically.
- Button lives in the header in `web/index.html` next to the existing controls.

## UI: map readability

### 6. Fade constellations whose requirements are not met
A constellation you cannot currently start (its affinity requirement is not met
by your current affinities) should have its artwork even more washed out: roughly
25% of the opacity/brightness of a constellation you can interact with. This
applies only to the constellation images, not the grey stars or the lines.

Notes:
- "Requirement met" means `meetsRequirement(affinityFrom(completedConstellations(selected)), con.affinityRequired)`,
  or the constellation already has selected stars. The zero-requirement nodes
  (crossroads) are always interactable and never faded.
- `web/src/adapters/svgRenderer.ts` `renderSvgMarkup` already takes `(model,
  state, opts)`; compute the met/unmet flag per constellation there (it can
  import `affinityFrom`/`completedConstellations`/`meetsRequirement` from the
  core) and add an `unmet` class to that constellation's `.art` image and
  `.art-tint` rect.
- Apply the extra fade in CSS to `.art.unmet` / `.art-tint.unmet` only (a new
  tunable var, for example `--art-unmet-factor` around 0.25 of `--art-opacity`).
  Do not touch `.link`, `.star`, or `.hit`.
- The map re-renders on every selection change, so constellations un-fade as you
  earn the affinities to reach them.

## Data + UI: celestial power ability stats

### 7. Show each celestial power's proc stats, not just its description
Full spec: docs/specs/celestial-power-stats.md (run on the Windows box with the
extracted game files).

Celestial-power tooltips show the flavor text but not the actual ability (the
proc trigger plus the skill's stats). Example, Scorpion Sting: "25% Chance on
Attack", 1.5s recharge, 6 projectiles, 100% chance to pass through, 0.1m radius,
40% Weapon Damage, 1125 Poison over 5s, 150 Reduced target's Defensive Ability
for 5s.

Blocked on data: these stats are NOT in devotions.json. celestial_power only
carries name/dbr/skill_class/description. The stats live in the skill .dbr files,
which the parser does not read, and the extracted game files are Windows-only, so
this cannot be built or verified from the Mac checkout alone.

Work required:
- scripts/parse_devotions.py: for each celestial power, read the granted skill
  .dbr and its buffSkillName/petSkillName/modifierSkillName children (the same
  walk resolve_power_name already does) and extract the proc trigger + chance plus
  the skill stats (skillCooldownTime, projectileLaunchNumber, radius,
  weaponDamagePct, the offensive*/offensiveSlow* damage and DoT fields, debuffs,
  etc.), formatted GD-style. Add them under celestial_power (for example
  celestial_power.proc and celestial_power.stats).
- Regenerate on Windows: `just parse` (or `just all`) against the extracted
  records, then commit the new devotions.json.
- Web UI: render the proc line + stat rows in the star tooltip, reusing the stat
  formatter where stat ids overlap.

## UI: feedback

### 8. Indicate what blocks a deselection
When a click to deselect is rejected because other picks depend on it, show what
is blocking it. Two cases:
- Affinity dependency: deselecting would drop an affinity another selected
  constellation requires (example: cannot deselect Akeron's Scorpion because
  Rhowan's Crown is selected and needs the Eldritch the Scorpion provides).
- Predecessor dependency: a star cannot be removed until a later star in the same
  constellation is removed first.

Surface the blockers visually, for example by flashing for a couple of seconds
the constellation image and/or the specific stars that must be deselected first
before the clicked star/constellation can be removed.

Notes:
- The core already knows a removal is invalid: `toggleStar` / `toggleConstellation`
  in `web/src/core/rules.ts` reject via `canRemove` / `validClosure` (the result
  is unchanged state). Today the UI just silently does nothing.
- To highlight the blockers, compute WHICH selected stars would fall out of
  `validClosure` if the clicked star/constellation were removed (the difference
  between the current selection and the closure of the attempted removal), plus
  any same-constellation successor stars whose predecessor was the clicked star.
  Those are the things the user must remove first.
- Have the rejected toggle return (or expose) that blocker set so `main.ts` can
  tell the renderer to flash those stars / their constellation art for ~2s
  (a transient CSS class, similar to the change-highlight flash).

## UI: map readability

### 9. Expand constellation hover area to cover the whole artwork
The constellation hover/click region is much smaller than the constellation
image, so there is a lot of visible art you cannot mouse over to get the
constellation tooltip or to toggle it. The hover area should cover the whole
image, except where an individual star sits (the star's own hit target must
still win so you can hover/click a single star).

Notes:
- `web/src/adapters/svgRenderer.ts` builds one `.con-hit` `<rect>` per
  constellation from the STAR bounding box plus `CON_PAD` (24), NOT the art
  bounds. This is deliberate (see the comment near line 54): star bounding boxes
  do not overlap, but the art bounding boxes DO (an earlier measurement found
  85/86 constellations' art rects overlapping a neighbor). So you cannot just
  swap in `art.x/art.y/art.w/art.h` for the rect: overlapping rects would let one
  constellation's hit region steal hovers meant for its neighbor, and SVG does
  not alpha-test raster `<image>` elements (the whole rectangle is "solid" for
  pointer events).
- Options to evaluate:
  - Grow `CON_PAD` (cheap) to a value that covers most art without colliding.
    Limited: it cannot reach full-image coverage where neighbors are close.
  - Shape the hit region to the art's non-transparent pixels. The renderer
    already builds a `<mask>` from each art image for the affinity tint; a
    similar mask could clip a per-constellation hit shape so transparent margins
    do not claim hovers. Overlapping opaque regions would still need a tie-break.
  - Resolve overlaps in JS instead of relying on element stacking: on mousemove
    over the map, find candidate constellations whose art rect contains the
    cursor and pick the one whose center (or nearest star) is closest. This gives
    full-image coverage with a deterministic owner for contested pixels.
- Whatever the approach, individual-star hit circles are drawn after the
  `.con-hit` rects so they already win; keep that ordering (or equivalent
  precedence) so single-star hover/click still works.

### 10. Color constellations by what they grant, not what they require
Today a constellation's gradient/tint shows the affinities it REQUIRES. Switch it
to show the affinities it GRANTS when fully filled out. Reachability is already
communicated by brightness (constellations you cannot start are faded, item 6),
so the requirement color is redundant; the granted color is the more useful
signal (what this constellation contributes to your affinity pool).

Notes:
- `web/src/adapters/svgRenderer.ts` `gradColors(c)` currently returns
  `presentAffinities(c.affinityRequired)` and only falls back to
  `c.affinityBonus` for crossroads (zero-requirement nodes). Flip the preference:
  use `c.affinityBonus` first, falling back to `c.affinityRequired` (then grey
  `#9aa3b2`) for the rare constellation that grants no affinity. Update the
  comments at the top of the file (lines ~10-11 and the `gradientStops` comment)
  which currently say the identity colors are what it requires.
- This one function feeds everything downstream automatically: the per
  constellation `grad-<id>` linearGradient, the art tint rect (`url(#grad-<id>)`),
  the star fills (`--grad`), and the glow color (`--affinity`, the first gradient
  color). No other call sites should need changing.
- Leave the requirement logic alone elsewhere: the tooltip "Requires:" line and
  its met/missing red/green coloring, and the `reachable`/`unmet` fade in the art
  loop, all still key off `affinityRequired`. Only the gradient source changes.
- `web/test/svgRenderer.test.ts` asserts gradient colors; update those
  expectations to the granted affinities.

## Testing

### 11. Fix two pre-existing failing e2e smoke checks on main
`just e2e` (`web/e2e/smoke.ts`) has two checks that fail deterministically on a
clean `main` checkout. Verified pre-existing: stashing all other changes,
rebuilding, and running the smoke gives the same two failures, so they are not
caused by the celestial-power work. The other checks (including a power-tooltip
hover check) pass. Goal: get `just e2e` to exit 0 on a clean tree without
weakening the assertions.

The two failures:
- "renders all 438 star circles": `document.querySelectorAll('circle.star').length`
  is not 438 at the instant it is asserted. The assertion fires immediately after
  the render-detection loop, which breaks as soon as `>0` stars exist, so it may
  be catching a mid-render/re-render count (a timing race) rather than a real
  miscount. First log the actual count it sees; if it is a race, poll for a stable
  438 (like the other waits in the file) instead of asserting once.
- "eldritch affinity total becomes 1": after clicking `crossroads_eldritch:0`,
  `document.querySelector('.affinity-eldritch')?.querySelector('span:last-child')?.textContent`
  is not "1". Likely the affinity panel's DOM/selector drifted from what the test
  expects (check the current markup `renderAffinities` emits in
  `web/src/adapters/sidebarView.ts`), or the optional-chained selector silently
  resolves to undefined. Update the selector to match the real structure, or fix
  the affinity total update if it is genuinely wrong.

Notes:
- Diagnose the root cause (render race vs. stale selector) before changing the
  assertions; do not just loosen them to go green.
- There are no git hooks, so these failures do not block commits today; this is
  about restoring a trustworthy `just e2e`.

## Minor cleanups noted during review

- `justfile` build still copies `data/stat_labels.json` into `dist`, but the app
  no longer fetches it (the parser still emits it as a documented dataset). The
  copy can be dropped.
- CI logs a Node 20 deprecation warning from the pinned GitHub Actions. Harmless
  today; bump the action versions when convenient.
- `racialBonusPercentDamage` aggregation in the sidebar uses the union of all
  selected stars' `racial_target`; if different races are mixed it lumps them
  together. Acceptable given how rare these stars are.
