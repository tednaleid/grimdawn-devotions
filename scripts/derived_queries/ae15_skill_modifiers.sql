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
        -- Every modified skill must be renderable, not merely present: a target
        -- that exists in facts but is outside the 315-skill roster (the nine rune
        -- items whose only modifier hit records/skills/default/defaultevade.dbr)
        -- resolves against nothing and ships as a blank row.
        (SELECT count(*) FROM skill_modifiers m
          WHERE NOT EXISTS (SELECT 1 FROM skills s WHERE s.record = m.modified_skill))
          = 0 AS targets_exist,
        -- Measured against the built table (pinned: 3211 at build 24756825, up
        -- from 3150: 70 items whose only carrier stores its stats as a per-rank
        -- array were being walked past, and 9 rune items left with nothing once
        -- off-roster targets stopped counting). Below the 3,362 items that carry
        -- modifier pairs, since 198 modifier records hold only effect or pet
        -- changes and contribute no stat rows.
        (SELECT count(DISTINCT item_record) FROM skill_modifiers) = 3211 AS item_count_exact,
        -- A carrier that stores its stats only as per-rank arrays used to look
        -- empty to the walk, which ran past it and dropped the block silently.
        -- Bysmiel's Mindweaver's Summon Hellhound line is one such block: the
        -- carrier holds offensiveDamageMultModifier 26.000000;52.000000 and the
        -- item grants it at rank 1.
        (SELECT value FROM skill_modifiers
          WHERE item_record = 'records/items/faction/weapons/caster/f207a_dagger.dbr'
            AND modified_skill LIKE '%summon_hellhound1.dbr'
            AND stat_id = 'offensiveDamageMultModifier') = 26 AS array_carrier_first_rank,
        -- A conversion percentage carries the damage types it converts between,
        -- which are string keys a numeric-only stat gate drops on the floor.
        (SELECT from_type || '>' || to_type FROM skill_modifiers
          WHERE item_record = 'records/items/faction/weapons/caster/f207a_dagger.dbr'
            AND modified_skill LIKE '%summon_hellhound1.dbr'
            AND stat_id = 'conversionPercentage') = 'Chaos>Elemental' AS conversion_typed
)
SELECT v.modified_skill, v.stat_id, v.value
FROM visage v CROSS JOIN checks c
WHERE c.ft_fire AND c.ft_crit AND c.ft_phys AND c.hh_fire AND c.hh_crit
  AND c.targets_exist AND c.item_count_exact
  AND c.array_carrier_first_rank AND c.conversion_typed
ORDER BY v.modified_skill, v.stat_id;
