-- ABOUTME: AE2 acceptance query - OR within a facet group, AND across groups:
-- ABOUTME: class in (sword 1h, dagger) AND rarity in (Epic, Legendary) AND lightning damage present.
-- Raw stat ids are the deposit's schema by design (KTD7); offensiveLightningMin > 0
-- distinguishes a real lightning roll from the zero-filled keys many records carry.
WITH cls AS (
    SELECT record, value AS class FROM facts
    WHERE key = 'Class' AND value IN ('WeaponMelee_Sword', 'WeaponMelee_Dagger')
),
rar AS (
    SELECT record, value AS rarity FROM facts
    WHERE key = 'itemClassification' AND value IN ('Epic', 'Legendary')
),
ltn AS (
    SELECT record, max(value_num) AS lightning_min FROM facts
    WHERE key = 'offensiveLightningMin' AND value_num > 0
    GROUP BY record
),
name_tag AS (
    SELECT record, value AS tag FROM facts WHERE key = 'itemNameTag'
)
SELECT nl.text AS name, cls.class, rar.rarity,
       CAST(ltn.lightning_min AS INTEGER) AS lightning_min, cls.record
FROM cls
JOIN rar USING (record)      -- AND across groups
JOIN ltn USING (record)
JOIN name_tag nt USING (record)
JOIN labels nl ON nl.locale = 'en' AND nl.tag = nt.tag
ORDER BY rar.rarity, name;
