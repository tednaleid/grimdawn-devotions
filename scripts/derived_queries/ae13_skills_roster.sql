-- ABOUTME: AE13 acceptance: the skills roster is complete, named, grouped and positioned.
-- ABOUTME: Pins the class-tree roster size and the four transform abilities with no button.
-- Empty result = failure. Counts pinned to build 24756825.
WITH checks AS (
    SELECT
        (SELECT count(*) FROM skills) = 315 AS roster_exact,
        (SELECT count(*) FROM skills WHERE name_tag IS NULL) = 0 AS all_named,
        (SELECT count(*) FROM skills WHERE icon IS NULL) = 0 AS all_have_icons,
        (SELECT count(*) FROM skills WHERE effect_record IS NULL) = 0 AS all_resolved,
        -- The four playerclass10 transform abilities are granted by the form
        -- rather than allocated, so they legitimately occupy no tree button.
        (SELECT count(*) FROM skills WHERE ui_x IS NULL) = 4 AS four_without_button,
        (SELECT count(*) FROM skills WHERE ui_x IS NULL
           AND mastery_record NOT LIKE '%playerclass10%') = 0 AS buttonless_all_class10,
        (SELECT count(*) FROM skills WHERE ultimate_level < max_level) = 0 AS caps_ordered,
        -- Every group_record must itself be a skill in the roster.
        (SELECT count(*) FROM skills s
          WHERE NOT EXISTS (SELECT 1 FROM skills g WHERE g.record = s.group_record))
          = 0 AS groups_resolve,
        -- The load-bearing invariant behind the whole grouping rule: each group
        -- has exactly one base. Zero bases orphans a group, two makes the choice
        -- of group_record arbitrary. Pinned at 150 groups over 311 tagged skills
        -- plus the 4 untagged transform abilities standing alone. 150 and not 142
        -- because node_kind reads the record's Class rather than its name-tag
        -- letter: the 8 weapon-pool and mutually-exclusive skills Crate numbers as
        -- someone else's B/C/D member are bases of their own one-member groups.
        (SELECT count(*) FROM (SELECT group_record FROM skills GROUP BY group_record
                                HAVING count(*) FILTER (WHERE record = group_record) != 1))
          = 0 AS one_base_per_group,
        (SELECT count(DISTINCT group_record) FROM skills) = 154 AS group_count_exact,
        -- Every group's A member must itself be classified base, regardless of
        -- its Class fact (Relic Training's Class is SkillSecondary_PetModifier
        -- even though it is the sole member of its own group).
        (SELECT count(*) FROM skills WHERE record = group_record AND node_kind != 'base')
          = 0 AS group_base_is_base,
        -- Chosen Visage's two boosted skills, one ordinary buff and one pet summon.
        (SELECT max_level || '/' || ultimate_level FROM skills
          WHERE record = 'records/skills/playerclass02/blastshield1.dbr')
          = '12/22' AS flame_touched_caps,
        (SELECT max_level || '/' || ultimate_level FROM skills
          WHERE record = 'records/skills/playerclass03/summon_hellhound1.dbr')
          = '16/26' AS hellhound_caps,
        -- The three Summon Hellhound pet modifiers must group under it.
        (SELECT count(*) FROM skills
          WHERE group_record = 'records/skills/playerclass03/summon_hellhound1.dbr')
          = 4 AS hellhound_group_size
)
SELECT s.record, s.node_kind, s.max_level, s.ultimate_level
FROM skills s CROSS JOIN checks c
WHERE c.roster_exact AND c.all_named AND c.all_have_icons AND c.all_resolved
  AND c.four_without_button AND c.buttonless_all_class10 AND c.caps_ordered
  AND c.groups_resolve AND c.one_base_per_group AND c.group_count_exact
  AND c.group_base_is_base
  AND c.flame_touched_caps AND c.hellhound_caps AND c.hellhound_group_size
  AND s.group_record = 'records/skills/playerclass03/summon_hellhound1.dbr'
ORDER BY s.record;
