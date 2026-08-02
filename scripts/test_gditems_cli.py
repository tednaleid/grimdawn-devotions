#!/usr/bin/env -S uv run --script
# ABOUTME: End-to-end tests for gditems.py: subprocess runs against the real data/derived,
# ABOUTME: plus a fake-repository test proving the CLI wires collapse without a database.
# /// script
# requires-python = ">=3.10"
# dependencies = ["duckdb", "lzstring"]
# ///
"""Run: uv run scripts/test_gditems_cli.py

Two legs. The subprocess leg drives the real CLI against data/derived (build 19149150),
pinning the same worked example the design spec uses (chest augment/component search)
plus the loud-failure paths: an unrecognised vocabulary token, an impossible stat
threshold, a missing derived directory, and an ambiguous `show` name. The fake-repo leg
drives `parse_args`/`run_search` directly with a structural stand-in for
DuckDbRepository, proving the scoring/rendering wiring without touching a parquet file.
"""
import importlib.util
import json
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).parent
REPO_ROOT = HERE.parent
GDITEMS = HERE / "gditems.py"

failures = 0
def check(name, got, want):
    global failures
    if got != want:
        failures += 1
        print(f"  FAIL {name}: got {got!r}, want {want!r}")
    else:
        print(f"  ok   {name}")


def run_cli(*args: str) -> str:
    """Run the CLI as a subprocess against the real data/derived. Fails the test run
    loudly (not just a FAIL line) if the CLI itself exits non-zero, since every caller
    here expects success."""
    result = subprocess.run(["uv", "run", str(GDITEMS), *args],
                             cwd=REPO_ROOT, capture_output=True, text=True)
    if result.returncode != 0:
        raise AssertionError(
            f"gditems.py {' '.join(args)} exited {result.returncode}\n"
            f"stdout: {result.stdout}\nstderr: {result.stderr}")
    return result.stdout


def run_cli_expect_failure(*args: str) -> tuple[int, str]:
    """Run the CLI as a subprocess, expecting a non-zero exit. Returns (exit code, stderr)."""
    result = subprocess.run(["uv", "run", str(GDITEMS), *args],
                             cwd=REPO_ROOT, capture_output=True, text=True)
    return result.returncode, result.stderr


# ---------------------------------------------------------------------------
# subprocess leg: the real CLI against data/derived (build 19149150)
# ---------------------------------------------------------------------------

# The chest-augment query is the spec's worked example, pinned against build 19149150.
out = run_cli("search", "--domain", "augment,component", "--fits", "chest",
              "--resist", "pierce", "--limit", "5", "--json")
data = json.loads(out)
names = [r["name"] for r in data["results"]]
check("titan plating is the strongest chest pierce component", names[0], "Titan Plating")
pierce_part = next(p for p in data["results"][0]["parts"] if p["name"] == "stat:resist.pierce")
check("titan plating pierce resistance is 24", pierce_part["raw"], 24.0)
check("titan plating source is crafted", data["results"][0]["source"], "crafted")
check("every result carries a grimtools url",
      all(r["url"].startswith("https://www.grimtools.com/db/advsearch?query=")
          for r in data["results"]), True)
check("sources never claim world drop",
      {r["source"] for r in data["results"]} <= {"vendor", "crafted", "unknown"}, True)
check("json carries the honesty disclaimer", "does not judge builds" in data["disclaimer"], True)

# An unknown token fails loudly with a near-match suggestion rather than returning nothing.
code, err = run_cli_expect_failure("search", "--mastery", "nightblad")
check("unknown token exits non-zero", code != 0, True)
check("unknown token suggests the real one", "nightblade" in err.lower(), True)

# A near match must come from the flag's own vocabulary: --grants-skill reads
# granted_skills, never skills or masteries.
code, err = run_cli_expect_failure("search", "--grants-skill", "Nightbladd")
check("unknown grants-skill token exits non-zero", code != 0, True)
check("unknown grants-skill token names its own flag", "--grants-skill" in err, True)

# A criterion nobody can satisfy is named, so an empty result is not mistaken for absence.
out = run_cli("search", "--domain", "gear", "--stat", "damage.pierce:99999", "--json")
data = json.loads(out)
check("impossible criterion is named in json", "damage.pierce" in " ".join(data["unmatched_criteria"]), True)

table = run_cli("search", "--domain", "gear", "--stat", "damage.pierce:99999")
check("impossible criterion is named in the table too", "damage.pierce" in table, True)

# The two renderers must not drift.
table = run_cli("search", "--domain", "augment", "--fits", "chest", "--resist", "pierce", "--limit", "5")
data = json.loads(run_cli("search", "--domain", "augment", "--fits", "chest",
                          "--resist", "pierce", "--limit", "5", "--json"))
for r in data["results"]:
    check(f"table shows {r['name']}", r["name"] in table, True)

# Sellecor's March: all three tiers share one display name, so `show` must refuse to
# guess and list every candidate instead - in text form on stderr,
code, err = run_cli_expect_failure("show", "Sellecor's March")
check("ambiguous show exits non-zero", code != 0, True)
record_lines = [line for line in err.splitlines() if "records/" in line]
check("ambiguous show lists all three tiers", len(record_lines), 3)

# and in --json form, as structured data rather than only prose on stderr.
code, err = run_cli_expect_failure("show", "Sellecor's March", "--json")
check("ambiguous show --json exits non-zero", code != 0, True)
err_data = json.loads(err)
check("ambiguous show --json names the ambiguous item", "Sellecor's March" in err_data["error"], True)
check("ambiguous show --json lists all three tiers as structured candidates",
      len(err_data["candidates"]), 3)

# show --json on an unambiguous item: the same information the text form prints, as
# structured data an agent does not have to parse out of prose.
out = run_cli("show", "Titan Plating", "--json")
show_data = json.loads(out)
check("show --json carries the name", show_data["name"], "Titan Plating")
check("show --json carries the source", show_data["source"], "crafted")
check("show --json carries the resist stat", show_data["stats"]["resist.pierce"], 24.0)
check("show --json carries a grimtools url",
      show_data["url"].startswith("https://www.grimtools.com/db/advsearch?query="), True)
check("show --json carries the tier ladder", show_data["tiers"], [75])

# The tier ladder must come from the resolved item's own family (group_key), never
# from every record that merely shares its display name: "Massacre" names both a
# single-tier relic (item level 90) and an unrelated three-tier two-handed axe
# (levels 14/58/84). Asking for the relic's own record must report ONLY its own
# level, not the axe's, even though both share the display name "Massacre".
out = run_cli("show", "records/items/gearrelic/d110_relic.dbr", "--json")
massacre_relic = json.loads(out)
check("massacre relic name", massacre_relic["name"], "Massacre")
check("massacre relic tier ladder holds only its own level, not the unrelated axe's",
      massacre_relic["tiers"], [90])

# and the reverse: the axe's own ladder must not pick up the relic's level either.
out = run_cli("show", "records/items/gearweapons/melee2h/c002_axe2h.dbr", "--json")
massacre_axe = json.loads(out)
check("massacre axe name", massacre_axe["name"], "Massacre")
check("massacre axe tier ladder holds only its own family's levels, not the relic's",
      massacre_axe["tiers"], [14, 58, 84])

# A missing derived directory fails with the exact fixed line, nothing else.
code, err = run_cli_expect_failure(
    "--derived-dir", str(HERE / "does-not-exist-derived"), "search", "--domain", "gear")
check("missing derived dir exits non-zero", code != 0, True)
check("missing derived dir message is exact",
      err.strip(), "data/derived not found. Run: just fetch-deposit")


# ---------------------------------------------------------------------------
# fake-repo leg: run_search driven directly, no database
# ---------------------------------------------------------------------------

core_spec = importlib.util.spec_from_file_location("gditems_core", HERE / "gditems_core.py")
core = importlib.util.module_from_spec(core_spec)
core_spec.loader.exec_module(core)

cli_spec = importlib.util.spec_from_file_location("gditems", HERE / "gditems.py")
cli = importlib.util.module_from_spec(cli_spec)
cli_spec.loader.exec_module(cli)


class FakeRepo:
    """Structural stand-in for DuckDbRepository: same three methods, fixed rows."""
    def __init__(self, candidates):
        self._candidates = candidates

    def fetch(self, criteria):
        return list(self._candidates)

    def vocabulary(self):
        return {"masteries": {}, "skills": {}, "granted_skills": {},
                "gear_types": ["boots"], "slots": ["feet"],
                "stat_families": ["damage.pierce"], "domains": ["gear"],
                "rarities": ["Epic"], "expansions": ["fg"]}

    def find(self, name_or_record):
        return [c for c in self._candidates if c.name == name_or_record]


repo = FakeRepo([
    core.Candidate(record="r/myth", group_key="f1", name="Mythical Thing", item_level=84,
                   req_level=80, rarity="Epic", slots=("feet",), source="unknown",
                   stat_values={"damage.pierce": 40.0}, skill_boosts={}, mastery_boosts={},
                   granted_skills=(), conversions=()),
    core.Candidate(record="r/base", group_key="f1", name="Thing", item_level=30,
                   req_level=25, rarity="Epic", slots=("feet",), source="unknown",
                   stat_values={"damage.pierce": 10.0}, skill_boosts={}, mastery_boosts={},
                   granted_skills=(), conversions=()),
])
payload = cli.run_search(repo, cli.parse_args([
    "search", "--domain", "gear", "--stat", "damage.pierce", "--level", "50", "--json"]))
# run_search's own return shape carries a ScoredItem, not a plain dict; render_json is
# the same adapter the real CLI uses over that shape, so drive it the same way here.
rendered = json.loads(cli.render_json(payload))
check("fake repo needs no database", rendered["results"][0]["name"], "Thing")
check("level filtering applies through the CLI path", len(rendered["results"]), 1)

print("FAILURES:", failures)
raise SystemExit(1 if failures else 0)
