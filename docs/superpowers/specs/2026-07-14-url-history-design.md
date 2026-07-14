# History-aware URL state (back/forward and live bookmarks)

Point-in-time design record. The planner's full state already round-trips
through the URL hash (`web/src/core/urlState.ts`), but the browser history is
inert: the hash is decoded exactly once at startup (`web/src/app/main.ts:95`)
and every `refresh()` ends with `history.replaceState(...)` (`main.ts:633`).
Two consequences:

1. Clicking a bookmark while the app is already open does nothing (no
   `hashchange` listener).
2. Back/Forward never traverses planner states (replace never creates
   entries), so a misclick cannot be undone with Back.

This design makes discrete actions push history entries, makes the app react
to hash changes, and keeps continuous gestures (the points-bar drag) from
flooding history.

## Non-goals and compatibility

- The hash format does not change. `encodeHash`/`decodeHash` are untouched;
  every existing bookmark decodes through the same validated and repaired
  path as today and produces the identical state.
- Locale stays out of the hash (viewer preference, existing invariant).
- Map pan/zoom is not planner state and is unaffected by Back/Forward.

## Behavior

Every discrete hash-changing action creates one history entry, so Back undoes
it and Forward redoes it:

- star and constellation toggles (map click and touch-popover commit)
- benefit-tag toggles (Benefits panel, Affinity panel, touch popover)
- the reset button
- the cap toggle (finite to uncapped and back)
- compare-mode enter, revert, and update

Clicking a bookmark or hand-editing the hash while the app is open applies
that state immediately. Refreshes that do not change the hash (language
switch, popover re-renders) never touch history.

## refresh() gains a URL mode

`refresh(urlMode: "push" | "replace" = "push")`. The final URL write becomes:

1. Encode the hash for the current state.
2. If `"#" + encoded === location.hash`, do nothing (dedupe guard; this is
   what keeps no-op refreshes out of history). `encodeHash` always emits at
   least `p=...&s=...`, so the comparison is well defined.
3. Otherwise `history.pushState` or `history.replaceState` per the mode.

The boot-time `refresh()` call passes `"replace"` so loading the app never
creates a spurious entry. All other existing call sites are discrete user
actions and take the `"push"` default.

## Applying an incoming hash

The startup decode-and-repair block (`main.ts:91-111`: `decodeHash`,
`repairSelection`, the cap floor, and restoring `baseline`, `selectedBenefits`,
and `lastFiniteCap`) is extracted into an `applyHash()` helper used in both
places:

- at boot, exactly as today
- in a new `window.addEventListener("hashchange", ...)` listener

`hashchange` fires on Back/Forward, bookmark clicks, and manual URL edits, but
not on our own `pushState`/`replaceState` calls, so there is no feedback loop.
After applying, the listener calls `refresh("replace")` so a repaired or
non-canonical incoming hash is canonicalized in place without minting an extra
entry. An undecodable hash resets to the empty build, the same as opening a
bad link fresh; Forward recovers the prior state from history.

## Points bar (the one continuous control)

- Drag: the `pointerdown` commit uses `"push"` (one entry per gesture); every
  `pointermove` commit uses `"replace"`. Back after a drag returns to the
  pre-drag cap in one step. No timers.
- Keyboard: an arrow press more than 500 ms after the previous one pushes;
  presses inside that window replace. A burst of taps or a held key coalesces
  into one Back step.
- `setCap()` grows a passthrough mode parameter to carry this.

## Testing

Extend the e2e smoke test (`web/e2e/smoke.ts`), the only level that exercises
real history and events:

- select a star, `history.back()`, assert it is deselected and the hash
  reverted; `history.forward()`, assert it is reselected
- set `location.hash` to a known build, assert the map updates

Encode/decode/repair behavior is already covered by unit tests and does not
change. `just check` gates as usual.
