-- ABOUTME: AE15 acceptance: item skill modifiers reproduce the Chosen Visage card,
-- ABOUTME: including the pet hop that carries the Summon Hellhound block.
-- Empty result = failure. Values read off the in-game item card.
WITH visage AS (
    SELECT modified_skill, stat_id, value
    FROM skill_modifiers
    WHERE item_record = 'records/items/gearhead/b201f_head.dbr'
),
checks AS (
    SELECT
        -- Flame Touched block: 26 fire damage, +12% crit damage, 4% physical resist.
        (SELECT value FROM visage WHERE modified_skill LIKE '%blastshield1.dbr'
           AND stat_id = 'offensiveFireMin') = 26 AS ft_fire,
        (SELECT value FROM visage WHERE modified_skill LIKE '%blastshield1.dbr'
           AND stat_id = 'offensiveCritDamageModifier') = 12 AS ft_crit,
        (SELECT value FROM visage WHERE modified_skill LIKE '%blastshield1.dbr'
           AND stat_id = 'defensivePhysical') = 4 AS ft_phys,
        -- Summon Hellhound block: 200 fire damage, +18% crit damage. These live
        -- two records away, behind a SkillSecondary_PetModifier petSkillName hop,
        -- so this pins the walk as much as the pairing.
        (SELECT value FROM visage WHERE modified_skill LIKE '%summon_hellhound1.dbr'
           AND stat_id = 'offensiveFireMin') = 200 AS hh_fire,
        (SELECT value FROM visage WHERE modified_skill LIKE '%summon_hellhound1.dbr'
           AND stat_id = 'offensiveCritDamageModifier') = 18 AS hh_crit,
        -- Every modified skill must be a real skill record.
        (SELECT count(*) FROM skill_modifiers m
          WHERE NOT EXISTS (SELECT 1 FROM facts f WHERE f.record = m.modified_skill))
          = 0 AS targets_exist,
        -- Measured against the built table (pinned: 3150 at build 24756825).
        -- Below the 3,362 items that carry modifier pairs, since 198 modifier
        -- records hold only effect or pet changes and contribute no stat rows,
        -- and below the 3,257 all-records figure because of the scoped join.
        (SELECT count(DISTINCT item_record) FROM skill_modifiers) = 3150 AS item_count_exact
)
SELECT v.modified_skill, v.stat_id, v.value
FROM visage v CROSS JOIN checks c
WHERE c.ft_fire AND c.ft_crit AND c.ft_phys AND c.hh_fire AND c.hh_crit
  AND c.targets_exist AND c.item_count_exact
ORDER BY v.modified_skill, v.stat_id;
