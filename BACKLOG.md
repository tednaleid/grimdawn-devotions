# Backlog

Planned enhancements for the web planner that are not yet started. Each item
should include implementation pointers for whoever picks it up.

No open items. The previously listed enhancements have all shipped (constellation
hover/click interaction, benefit and affinity change highlights, grouped
benefits, celestial-power diamonds with descriptions and their proc/ability
stats, the reset-points control, the unmet-requirement fade, the
blocked-deselection flash plus blocking-art flash, full-image constellation
hover, grant-based coloring, and the e2e smoke fixes). See the git history.

## Known limitations (accepted)

- `racialBonusPercentDamage` aggregation in the sidebar uses the union of all
  selected stars' `racial_target`; if different races are mixed it lumps them
  together. Acceptable given how rare these stars are.
