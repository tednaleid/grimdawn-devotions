-- ABOUTME: AE8 acceptance: faction vendor source edges match the pinned coverage at build
-- ABOUTME: 19149150 (284 of 292 augments, tier distribution) and five transcribed card oracles.
-- Empty result = failure. Pins: 284 distinct vendor-sourced augments (the other 8 are the
-- curated template blanks), tier item counts friendly 6 / honored 112 / revered 166 with no
-- other tier value, and five oracle rows (augment, vendor, faction, tier) transcribed from
-- grimtools/wiki (Coven Black Ash externally corroborated; all five spot-checked by Ted).
-- A game patch that shifts any of these should fail this recipe so the pins are re-checked.
WITH v AS (
    SELECT s.item, l.text AS augment, lv.text AS vendor, lf.text AS faction, s.tier
    FROM sources s
    JOIN entities e ON e.record = s.item
    JOIN labels l  ON l.locale = 'en' AND l.tag = e.name_tag
    JOIN labels lv ON lv.locale = 'en' AND lv.tag = s.vendor_tag
    JOIN labels lf ON lf.locale = 'en' AND lf.tag = s.faction_tag
    WHERE s.kind = 'faction_vendor'
),
tiers AS (
    SELECT tier, count(DISTINCT item) AS items FROM v GROUP BY tier
),
oracle(augment, vendor, faction, tier) AS (
    VALUES
      ('Coven Black Ash',      'Falonestra',         'Coven of Ugdenbog', 'revered'),
      ('Kymon''s Conduit',     'Brother Mulven',     'Kymon''s Chosen',   'revered'),
      ('Kymon''s Conduit',     'Brother Adrius',     'Kymon''s Chosen',   'revered'),
      ('Mogdrogen''s Blessing','Keeper Unkala',      'Rovers',            'revered'),
      ('Outcast''s Bastion',   'Anasteria''s Drudge','The Outcast',       'revered')
),
checks AS (
    SELECT
      (SELECT count(DISTINCT item) FROM v) = 284
      AND (SELECT count(*) FROM tiers) = 3
      AND (SELECT items FROM tiers WHERE tier = 'friendly') = 6
      AND (SELECT items FROM tiers WHERE tier = 'honored') = 112
      AND (SELECT items FROM tiers WHERE tier = 'revered') = 166
      AND NOT EXISTS (SELECT 1 FROM oracle o
                      WHERE NOT EXISTS (SELECT 1 FROM v
                                        WHERE v.augment = o.augment AND v.vendor = o.vendor
                                          AND v.faction = o.faction AND v.tier = o.tier))
      AS ok
)
SELECT v.augment, v.vendor, v.faction, v.tier
FROM v JOIN oracle o ON v.augment = o.augment AND v.vendor = o.vendor
CROSS JOIN checks c
WHERE c.ok
ORDER BY v.augment, v.vendor;
