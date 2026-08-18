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


def run():
    fns = [v for k, v in globals().items() if k.startswith("test_")]
    for fn in fns:
        fn()
        print(f"ok  {fn.__name__}")
    print(f"\n{len(fns)} passed")


if __name__ == "__main__":
    run()
