-- ABOUTME: AE6 acceptance: expansion badges match the screenshot oracles (base game,
-- ABOUTME: Ashes of Malmouth, Forgotten Gods) including the storyelements-named MI.
-- Empty result = failure: every pinned record must carry the expected expansion.
WITH want(record, expansion) AS (VALUES
    ('records/items/gearweapons/caster/a01_dagger001.dbr', 'base'),
    ('records/items/gearweapons/melee2h/d002_axe2h.dbr',   'base'),
    ('records/items/gearweapons/shields/d001_shield.dbr',  'base'),
    ('records/items/gearaccessories/necklaces/d003_necklace.dbr', 'base'),
    ('records/items/gearweapons/melee2h/d101_axe2h.dbr',   'aom'),
    ('records/items/gearweapons/melee2h/d205_axe2h.dbr',   'fg'),
    ('records/items/gearweapons/shields/d201_shield.dbr',  'fg'),
    ('records/items/gearaccessories/necklaces/d201_necklace.dbr', 'fg'),
    ('records/storyelementsgdx2/questassets/areag_n.dbr',  'fg')
),
got AS (
    SELECT w.record, w.expansion AS want, e.expansion AS got
    FROM want w LEFT JOIN entities e ON e.record = w.record
),
checks AS (
    SELECT count(*) = (SELECT count(*) FROM want)
           AND bool_and(got = want) AS ok
    FROM got
)
SELECT g.record, g.got AS expansion
FROM got g CROSS JOIN checks c
WHERE c.ok
ORDER BY g.got, g.record;
