-- ABOUTME: AE15 acceptance: item skill modifiers reproduce the Chosen Visage card,
-- ABOUTME: including the pet hop that carries the Summon Hellhound block.
-- Empty result = failure. Values read off the in-game item card.
WITH visage AS (
    SELECT modified_skill, stat_id, value
    FROM skill_modifiers
    WHERE item_record = 'records/items/gearhead/b201f_head.dbr'
),
codex AS (
    SELECT stat_id, value FROM skill_modifiers
    WHERE item_record = 'records/items/gearweapons/focus/b009f_focus.dbr'
      AND modified_skill = 'records/skills/playerclass06/summon_briarthorn1.dbr'
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
        -- Bloodsworn Codex's Summon Briarthorn block is split ACROSS the hop: the
        -- pet-modifier shell carries the -6s skill recharge itself and reaches the
        -- +25% total damage one petSkillName away. Both are card lines, so a walk
        -- that reports only the nearest carrier drops one of them silently - and
        -- item_count_exact below cannot see that, because the item still ships the
        -- row it kept. Ten items are this shape; this pins the whole chain.
        (SELECT value FROM codex WHERE stat_id = 'cooldownTime') = -6 AS codex_recharge,
        (SELECT value FROM codex WHERE stat_id = 'offensiveDamageMultModifier')
          = 25 AS codex_damage,
        (SELECT count(*) FROM codex) = 2 AS codex_exact,
        -- Every modified skill must be renderable, not merely present: a target
        -- that exists in facts but is outside the 315-skill roster resolves against
        -- nothing and would ship as a blank row. The table filters to the roster, so
        -- testing its output would pass by construction; this tests the SOURCE, and
        -- pins the dropped set to the one record the filter was written for (the
        -- nine rune items whose only modifier hits records/skills/default/
        -- defaultevade.dbr). A patch that aims a modifier at any other off-roster
        -- skill fails here instead of vanishing.
        (SELECT count(*) FROM facts m
          WHERE m.key LIKE 'modifiedSkillName%' AND trim(m.value) != ''
            AND lower(trim(m.value)) NOT IN (SELECT record FROM skills)
            AND lower(trim(m.value)) != 'records/skills/default/defaultevade.dbr')
          = 0 AS targets_exist,
        -- (item, skill, carrier, stat) is the documented identity. Collecting every
        -- carrier in a chain rather than the nearest one is what makes that worth
        -- checking: two records in one chain naming the same stat would silently
        -- double a card line.
        (SELECT count(*) FROM (
            SELECT 1 FROM skill_modifiers
            GROUP BY item_record, modified_skill, modifier_record, stat_id
            HAVING count(*) > 1)) = 0 AS identity_unique,
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
        -- which are string keys a numeric-only stat gate drops on the floor. Both
        -- halves or neither, exactly as conversions.parquet pairs them: two records
        -- carry a conversionInType with no out-type and must report no types at all
        -- rather than shipping half a pair.
        (SELECT from_type || '>' || to_type FROM skill_modifiers
          WHERE item_record = 'records/items/faction/weapons/caster/f207a_dagger.dbr'
            AND modified_skill LIKE '%summon_hellhound1.dbr'
            AND stat_id = 'conversionPercentage') = 'Chaos>Elemental' AS conversion_typed,
        (SELECT count(*) FROM skill_modifiers
          WHERE (from_type IS NULL) != (to_type IS NULL)) = 0 AS conversion_pairs_whole
)
SELECT 'chosen_visage' AS item, v.modified_skill, v.stat_id, v.value
FROM visage v CROSS JOIN checks c
WHERE c.ft_fire AND c.ft_crit AND c.ft_phys AND c.hh_fire AND c.hh_crit
  AND c.codex_recharge AND c.codex_damage AND c.codex_exact
  AND c.targets_exist AND c.identity_unique AND c.item_count_exact
  AND c.array_carrier_first_rank AND c.conversion_typed AND c.conversion_pairs_whole
UNION ALL
SELECT 'bloodsworn_codex',
       'records/skills/playerclass06/summon_briarthorn1.dbr', k.stat_id, k.value
FROM codex k CROSS JOIN checks c
WHERE c.ft_fire AND c.ft_crit AND c.ft_phys AND c.hh_fire AND c.hh_crit
  AND c.codex_recharge AND c.codex_damage AND c.codex_exact
  AND c.targets_exist AND c.identity_unique AND c.item_count_exact
  AND c.array_carrier_first_rank AND c.conversion_typed AND c.conversion_pairs_whole
ORDER BY 1, 2, 3;
