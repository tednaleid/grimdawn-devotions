#!/usr/bin/env -S uv run --script
# ABOUTME: Tests for dataset_release pure logic. Run: uv run scripts/test_dataset_release.py
# ABOUTME: Pins the release manifest to the tables the item CLI opens, and revision discovery.
# /// script
# requires-python = ">=3.10"
# dependencies = ["duckdb", "lzstring"]
# ///
import importlib.util
import sys
from pathlib import Path

here = Path(__file__).parent
sys.path.insert(0, str(here))


def load(name):
    spec = importlib.util.spec_from_file_location(name, here / f"{name}.py")
    assert spec and spec.loader
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


release = load("dataset_release")
duck = load("gditems_duckdb")
derive = load("build_derived")

failures = 0
def check(name, got, want):
    global failures
    if got != want:
        failures += 1
        print(f"  FAIL {name}: got {got!r}, want {want!r}")
    else:
        print(f"  ok   {name}")

# The release manifest is the only way a machine without the game gets derived data, so a
# table `just derive` writes but the manifest omits simply is not there on a clean clone -
# silent until whatever opens it fails. The two lists drifted apart once already (boosts and
# conversions shipped in derive but not in the release), and again when the three set tables
# arrived: the CLI does not open those, but scripts/test_build_derived.py reads them, so
# pinning the manifest to the CLI's view list was the wrong anchor. Everything derive writes
# ships; consumers other than the CLI are then free to appear without a manifest edit.
released_derived = tuple(name.removesuffix(".parquet")
                         for name, d in release.ASSETS if d == "derived")
check("every table just derive writes is released",
      sorted(set(derive.OUTPUT_TABLES) - set(released_derived)), [])
check("the release ships no derived table just derive does not write",
      sorted(set(released_derived) - set(derive.OUTPUT_TABLES)), [])
check("every derived table the CLI opens is released",
      sorted(set(duck.DERIVED_TABLES) - set(released_derived)), [])

# The deposit half is fixed by build_deposit, not by the CLI, so it is pinned literally.
check("the deposit half of the manifest is the three build_deposit artifacts",
      tuple(name for name, d in release.ASSETS if d == "deposit"),
      ("facts.parquet", "labels.parquet", "meta.parquet"))
check("no asset is listed twice", len({n for n, _ in release.ASSETS}), len(release.ASSETS))

# next_revision: a rev that collides would fail the release, and one that skips ahead makes
# the tag ladder lie about how many times a buildid was published.
check("first release of a buildid is rev 1", release.next_revision("24346246", []), 1)
check("unrelated buildids never advance the rev",
      release.next_revision("24346246", ["deposit-19149150.7", "v1.0"]), 1)
check("rev follows the highest existing rev, not the count",
      release.next_revision("24346246", ["deposit-24346246.1", "deposit-24346246.3"]), 4)
check("a double-digit rev sorts numerically, not as text",
      release.next_revision("24346246", ["deposit-24346246.9", "deposit-24346246.10"]), 11)
check("a malformed suffix is ignored rather than crashing",
      release.next_revision("24346246", ["deposit-24346246.rc1", "deposit-24346246.2"]), 3)

print("FAILURES:", failures)
raise SystemExit(1 if failures else 0)
