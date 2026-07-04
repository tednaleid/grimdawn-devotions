-- ABOUTME: AE3 acceptance: a blueprint yields its crafted item and reagent list, and the
-- ABOUTME: reverse query lists the blueprints consuming a component (Searing Ember).
-- Empty result = failure: requires the forward blueprint to carry both a crafts edge and
-- reagent edges, and the reverse query to find consumers.
WITH fwd AS (
    SELECT r.kind, r.dst
    FROM relations r
    WHERE r.src = 'records/items/crafting/blueprints/armor/craft_armor_decoratedpauldrons.dbr'
),
rev AS (
    SELECT DISTINCT r.src
    FROM relations r
    JOIN entities c ON c.record = r.dst
    JOIN labels l ON l.tag = c.name_tag AND l.locale = 'en' AND l.text = 'Searing Ember'
    WHERE r.kind = 'reagent'
),
checks AS (
    SELECT EXISTS (SELECT 1 FROM fwd WHERE kind = 'crafts')
       AND EXISTS (SELECT 1 FROM fwd WHERE kind = 'reagent')
       AND EXISTS (SELECT 1 FROM rev) AS ok
)
SELECT u.side, u.kind, u.record FROM (
    SELECT 'blueprint edge' AS side, f.kind, f.dst AS record FROM fwd f
    UNION ALL
    SELECT 'consumes Searing Ember', 'blueprint', r.src FROM rev r
) u CROSS JOIN checks c
WHERE c.ok
ORDER BY u.side, u.kind, u.record;
