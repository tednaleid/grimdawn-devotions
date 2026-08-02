-- ABOUTME: AE1 acceptance: gear domain + dagger type + Cold family + required level 20-100.
-- ABOUTME: Innate and granted-skill cold both match; per-variant range filtering is asserted.
-- Empty result = failure. The checks CTE gates the output: the skill leg (Shard of
-- Asterkarn's granted Chilling Presence contributes cold rows), the innate leg, and
-- the variant leg (tightened to 55-100 the Night Herald group still surfaces while its
-- level-35 variant no longer does - filters evaluate per variant, cards per group).
WITH cold AS (SELECT stat_id FROM families WHERE family = 'damage.cold'),
matches AS (
    SELECT e.record, e.group_key, e.req_level,
           string_agg(DISTINCT s.source, ',' ORDER BY s.source) AS sources
    FROM entities e
    JOIN stats s ON s.record = e.record AND s.stat_id IN (SELECT stat_id FROM cold)
    WHERE e.domain = 'gear' AND e.gear_type = 'dagger'
      AND e.req_level BETWEEN 20 AND 100
    GROUP BY 1, 2, 3
),
m55 AS (SELECT * FROM matches WHERE req_level BETWEEN 55 AND 100),
checks AS (
    SELECT
        EXISTS (SELECT 1 FROM matches
                WHERE record = 'records/items/gearweapons/caster/d008_dagger.dbr'
                  AND sources LIKE '%skill%') AS skill_leg,
        EXISTS (SELECT 1 FROM matches WHERE sources LIKE '%self%') AS innate_leg,
        EXISTS (SELECT 1 FROM m55 WHERE group_key = 'tagWeaponCaster1hB018')
        AND NOT EXISTS (SELECT 1 FROM m55
                        WHERE record = 'records/items/gearweapons/caster/b018a_dagger.dbr')
            AS variant_leg
)
SELECT COALESCE(l.text, m.record) AS name, m.req_level, m.sources, m.record
FROM matches m
JOIN entities e ON e.record = m.record
LEFT JOIN labels l ON l.tag = e.name_tag AND l.locale = 'en'
CROSS JOIN checks c
WHERE c.skill_leg AND c.innate_leg AND c.variant_leg
ORDER BY name, m.req_level, m.record;
