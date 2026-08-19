#!/usr/bin/env -S uv run --script
# ABOUTME: Tests for build_derived.py against the real data/derived/*.parquet (run `just derive` first).
# ABOUTME: Run: uv run scripts/test_build_derived.py
# /// script
# requires-python = ">=3.10"
# dependencies = ["duckdb"]
# ///
import duckdb


def test_refresh_qualifiers_ride_along_on_refresh_stats():
    """Badge of the Crimson Company's Cadence block reduces LEAP's cooldown.

    Pinned to the grimtools card "25% Chance on Attack to reduce cooldown of
    Leap by 1 Second". The target is a different skill from the modified skill,
    so a reader that assumes self-targeting mislabels it.
    """
    con = duckdb.connect()
    rows = con.execute("""
        SELECT stat_id, value, refresh_skill, refresh_trigger
        FROM read_parquet('data/derived/skill_modifiers.parquet')
        WHERE item_record = 'records/items/awakened/gearaccessories/medals/c010_medal.dbr'
          AND modified_skill = 'records/skills/playerclass01/cadence1.dbr'
          AND stat_id LIKE 'refreshCooldown%'
        ORDER BY stat_id""").fetchall()
    assert rows == [
        ("refreshCooldownAmount", 1.0,
         "records/skills/playerclass10/leap1.dbr", "AttackEnemy"),
        ("refreshCooldownChance", 25.0,
         "records/skills/playerclass10/leap1.dbr", "AttackEnemy"),
    ], rows


def test_no_record_pairs_a_defaulted_trigger_with_a_real_amount():
    """Pin the data shape that makes the trigger guard unreachable today.

    Most trigger values are the untouched 13-token enum, meaning the record made no
    choice, and storing one verbatim would print the enum onto the card. The
    `NOT LIKE '%;%'` guard in build_skill_modifiers exists to stop that. At build
    24756825 the guard never actually fires: no record carrying the default enum
    also carries a non-zero refresh amount, so the numeric stat gate has already
    excluded every one of them.

    Asserting on the output would therefore be a 0 = 0 over an empty relation. This
    pins the deposit-level fact instead. If it ever fails, the guard has become
    load-bearing and needs its own output-level test before this one is relaxed.
    """
    con = duckdb.connect()
    n = con.execute("""
        WITH trig AS (
          SELECT record, key, trim(value) AS v FROM read_parquet('data/deposit/facts.parquet')
          WHERE key IN ('refreshCooldownTrigger', 'refreshDurationTrigger') AND trim(value) != ''
        ), amt AS (
          SELECT record, key, try_cast(value AS DOUBLE) AS n
          FROM read_parquet('data/deposit/facts.parquet')
          WHERE key IN ('refreshCooldownAmount', 'refreshCooldownChance',
                        'refreshDurationAmount', 'refreshDurationChance', 'refreshDurationMax')
        )
        SELECT count(DISTINCT t.record)
        FROM trig t JOIN amt a
          ON a.record = t.record
         AND regexp_extract(a.key, '^(refreshCooldown|refreshDuration)', 1)
           = regexp_extract(t.key, '^(refreshCooldown|refreshDuration)', 1)
        WHERE t.v LIKE '%;%' AND a.n IS NOT NULL AND a.n != 0""").fetchone()[0]
    assert n == 0, (
        f"{n} records now pair a defaulted trigger enum with a real refresh amount. "
        "The NOT LIKE '%;%' guard is now load-bearing: add an output-level test that "
        "fails when the guard is removed, then update this pin.")


def test_refresh_qualifiers_absent_on_unrelated_stats():
    con = duckdb.connect()
    n = con.execute("""
        SELECT count(*) FROM read_parquet('data/derived/skill_modifiers.parquet')
        WHERE stat_id NOT LIKE 'refresh%'
          AND (refresh_skill IS NOT NULL OR refresh_trigger IS NOT NULL)""").fetchone()[0]
    assert n == 0, f"{n} non-refresh rows carry a refresh qualifier"


def test_ultos_tempest_set_bonuses_match_the_grimtools_card():
    """A set's skill wiring is its own record's, and no member says any of it.

    Pinned to the grimtools card for Mythical Ultos' Gem, which lists under
    "(4) Set" a +2 to all skills in Shaman and under "(5) Set" a Savagery block
    reading "33 Lightning Damage" and "30% Chance on Critical Attack to reduce
    cooldown of Primal Strike by 1 Second". The set record is outside `scoped`
    (no Class, and gear-types.json gives records/items/lootsets no domain), so
    nothing but build_set_modifiers/build_set_boosts can reach any of it.
    """
    con = duckdb.connect()
    ultos = "records/items/lootsets/itemset_d017b.dbr"
    mods = con.execute(f"""
        SELECT pieces, stat_id, value, refresh_skill, refresh_trigger
        FROM read_parquet('data/derived/set_modifiers.parquet')
        WHERE set_record = '{ultos}'
          AND modified_skill = 'records/skills/playerclass06/savagery1.dbr'
        ORDER BY stat_id""").fetchall()
    assert mods == [
        (5, "offensiveLightningMin", 33.0, None, None),
        (5, "refreshCooldownAmount", 1.0,
         "records/skills/playerclass06/savagestrike1.dbr", "AttackEnemyCrit"),
        (5, "refreshCooldownChance", 30.0,
         "records/skills/playerclass06/savagestrike1.dbr", "AttackEnemyCrit"),
    ], mods
    boosts = con.execute(f"""
        SELECT pieces, kind, target, level
        FROM read_parquet('data/derived/set_boosts.parquet')
        WHERE set_record = '{ultos}' ORDER BY pieces, kind""").fetchall()
    assert boosts == [
        (4, "mastery", "records/skills/playerclass06/_classtraining_class06.dbr", 2),
    ], boosts


def test_a_set_bonus_never_needs_more_pieces_than_the_set_has():
    """The piece count is an index into a per-member array, so it cannot exceed the
    member count. A count that did would mean the array and setMembers disagree, and
    the page would caption a bonus nobody can ever wear."""
    con = duckdb.connect()
    over = con.execute("""
        WITH s AS (SELECT * FROM read_parquet('data/derived/sets.parquet')),
             b AS (SELECT set_record, pieces FROM read_parquet('data/derived/set_modifiers.parquet')
                   UNION ALL
                   SELECT set_record, pieces FROM read_parquet('data/derived/set_boosts.parquet'))
        SELECT count(*) FROM b JOIN s USING (set_record) WHERE b.pieces > s.members""").fetchone()[0]
    assert over == 0, f"{over} set bonuses need more pieces than their set has"
    lo = con.execute("""
        SELECT min(pieces) FROM (
            SELECT pieces FROM read_parquet('data/derived/set_modifiers.parquet')
            UNION ALL SELECT pieces FROM read_parquet('data/derived/set_boosts.parquet'))""").fetchone()[0]
    # One piece is not a set: position 1 is zero in every array the game ships, so
    # nothing should ever report a 1-piece bonus.
    assert lo == 2, f"lowest piece count is {lo}, expected 2"


def run():
    fns = [v for k, v in globals().items() if k.startswith("test_")]
    for fn in fns:
        fn()
        print(f"ok  {fn.__name__}")
    print(f"\n{len(fns)} passed")


if __name__ == "__main__":
    run()
