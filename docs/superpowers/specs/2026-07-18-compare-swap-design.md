# Compare swap button (exchange baseline and live build)

Point-in-time design record. Compare mode shows Base, Now, and delta columns in
the sidebar, but the starmap always renders the live build. There is no way to
see the baseline build on the map without abandoning the comparison (Revert
discards the live edits). This adds a Swap button that exchanges the baseline
and the live build in place, keeping the comparison active.

## Goal

A third button in the compare controls row, after Revert and Update Baseline:

    Comparing to baseline

            [Revert] [Update Baseline] [Swap]

                        Base    Now     delta

Pressing Swap exchanges the live build and the baseline, selection and point
cap both (the baseline carries its own cap). The map now renders the former
baseline as the selected build, the Base and Now columns exchange values, the
delta column and the map's added/removed diff highlights flip sign, and the
comparison stays active. Pressing Swap again restores the original
orientation. Both builds remain editable at all times: after a swap, edits
apply to the former baseline, now the live build.

## State, URL, history

A new `cmp-swap` branch in `onBenefitClick` in `web/src/app/main.ts`, parallel
to the existing `cmp-revert` and `cmp-update` branches: exchange `state` and
`baseline` (constructing fresh `Set` copies so the baseline snapshot never
aliases the live selection set), then `refresh()`.

No `urlState.ts` changes. `encodeHash` writes `s=`/`p=` from the live state and
`cs=`/`cp=` from the baseline, so the two pairs exchange values automatically
and every swapped state round-trips like any other. Uncapped builds keep
working through the existing `p=0`/`cp=0` sentinel. Stale or malformed `cs=`
links behave as today: no baseline decodes, compare mode is off, and the
button does not render.

Each swap is one effective gesture, so the existing history machinery pushes
one entry and Back undoes the swap. When the baseline and the live build are
identical the swap produces an unchanged hash, and the existing no-op handling
applies; no special casing in the handler.

## UI and internationalization

The button renders in the compare branch of `renderBenefits` in
`web/src/adapters/sidebarView.ts`, id `cmp-swap`, in the `cmp-controls` row
after the Update Baseline slot.

One new catalog key, `ui.compare.swap` = "Swap", added to
`web/src/i18n/app.en.json` and the 12 other locale catalogs, plus the
`REQUIRED` list in `web/test/appCatalog.test.ts`. The short label was chosen
deliberately: it sits directly above the Base and Now column headers, which
carry the context, and a single word translates cleanly.

## Testing

- `web/test/compare-render.test.ts`: compare mode renders `id="cmp-swap"`
  (alongside the existing `cmp-revert`/`cmp-update` assertions); normal mode
  does not.
- `web/e2e/smoke.ts`, extending the existing compare section: enter compare,
  change the build, click `cmp-swap`, assert the hash's `s=`/`cs=` (and
  `p=`/`cp=`) values exchanged, click again, assert the original orientation
  is restored and compare mode is still active.
- Browser check via `just serve`: swap, observe the map and columns flip,
  Back undoes the swap.

## Non-goals

- No view-only or read-only baseline mode, and no new URL params.
- No change to Revert or Update Baseline semantics.
- No change to how the comparison is started or ended.
