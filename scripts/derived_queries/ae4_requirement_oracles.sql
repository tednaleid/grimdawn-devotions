-- ABOUTME: AE4 acceptance: computed requirements match the grimtools card oracles exactly
-- ABOUTME: (weapon, shield, and jewelry equation families plus the itemLevel-1 boundary).
-- Empty result = failure: every pinned record must exist and every computed value must
-- equal the card literal. 0 means "no requirement on the card".
WITH want(record, lvl, phy, cun, spi) AS (VALUES
    ('records/items/gearweapons/caster/a01_dagger001.dbr',        12,   0,  74,  93),
    ('records/items/gearweapons/melee2h/d002_axe2h.dbr',          50, 426,   0,   0),
    ('records/items/gearweapons/shields/d001_shield.dbr',         50, 508,   0,   0),
    ('records/items/gearweapons/shields/d002_shield.dbr',         50, 508,   0,   0),
    ('records/items/gearweapons/shields/d201_shield.dbr',         58, 566,   0,   0),
    ('records/items/gearaccessories/necklaces/d003_necklace.dbr', 58,   0,   0, 267),
    ('records/items/gearaccessories/necklaces/d201_necklace.dbr', 58,   0,   0, 270),
    ('records/storyelementsgdx2/questassets/areag_n.dbr',          1,   0,   0,   1)
),
got AS (
    SELECT w.record, w.lvl, w.phy, w.cun, w.spi,
           e.req_level, e.req_physique, e.req_cunning, e.req_spirit
    FROM want w
    LEFT JOIN entities e ON e.record = w.record
),
checks AS (
    SELECT count(*) = (SELECT count(*) FROM want)
           AND bool_and(req_level = lvl AND req_physique = phy
                        AND req_cunning = cun AND req_spirit = spi) AS ok
    FROM got
)
SELECT g.record, g.req_level, g.req_physique, g.req_cunning, g.req_spirit
FROM got g CROSS JOIN checks c
WHERE c.ok
ORDER BY g.record;
