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
# F1: search must never surface a nameless internal-template record
# ---------------------------------------------------------------------------

# Reproduced by the reviewer: this exact query used to return a blank-named row at rank
# 2 whose grimtools link, built from an empty name, matched every level-90 item instead
# of isolating one.
out = run_cli("search", "--domain", "gear", "--gear-type", "axe2h", "--rarity", "Rare",
              "--stat", "damage.physical", "--json")
data = json.loads(out)
check("search never returns a nameless candidate", any(r["name"] == "" for r in data["results"]), False)
check("search still returns real candidates for this query", len(data["results"]) > 0, True)

# `show` is a deliberate exception: inspecting a nameless record directly (by its own
# record path) is legitimate even though `search` must never rank it as a recommendation.
out = run_cli("show", "records/items/enemygear/gear_humanpossessed_apprenticetorso01.dbr", "--json")
show_data = json.loads(out)
check("show still resolves a nameless record by record path", show_data["name"], "")
check("show gives no grimtools link for a nameless record (no name to link by)",
      show_data["url"], None)
text = run_cli("show", "records/items/enemygear/gear_humanpossessed_apprenticetorso01.dbr")
check("show text explains the missing grimtools link for a nameless record",
      "no link (item has no display name)" in text, True)

# ---------------------------------------------------------------------------
# F2: --converts-to vocabulary, casing, and the --min-convert pairing rule
# ---------------------------------------------------------------------------

vocab_data = json.loads(run_cli("vocab", "--json"))
check("vocab lists conversion types", "Pierce" in vocab_data["conversion_types"], True)
check("conversion types are capitalized, not lowercase",
      "pierce" in vocab_data["conversion_types"], False)

# The documented flagship example used lowercase, which matched nothing silently.
# --converts-to must now be validated the same way every other vocabulary flag is.
code, err = run_cli_expect_failure("search", "--converts-to", "pierce")
check("lowercase converts-to token exits non-zero", code != 0, True)
check("lowercase converts-to token suggests the real casing", "Pierce" in err, True)

# --min-convert alone was a silent no-op; it must require --converts-to.
code, err = run_cli_expect_failure("search", "--min-convert", "10")
check("--min-convert without --converts-to exits non-zero", code != 0, True)
check("--min-convert without --converts-to names the pairing rule", "--converts-to" in err, True)

out = run_cli("search", "--domain", "gear", "--converts-to", "Pierce", "--min-convert", "5",
              "--limit", "3", "--json")
data = json.loads(out)
check("correctly-cased --converts-to returns structured results", "results" in data, True)

# ---------------------------------------------------------------------------
# F3: --weights names are validated and echoed in --json
# ---------------------------------------------------------------------------

code, err = run_cli_expect_failure("search", "--domain", "gear", "--resist", "pierce",
                                    "--weights", "stat:resist.peirce=5.0")
check("unrecognised weight name exits non-zero", code != 0, True)
check("unrecognised weight name suggests the real one", "resist.pierce" in err, True)

out = run_cli("search", "--domain", "gear", "--resist", "pierce",
              "--weights", "stat:resist.pierce=3.5", "--json")
data = json.loads(out)
check("json echoes the effective weights", data["weights"], {"stat:resist.pierce": 3.5})

out = run_cli("search", "--domain", "gear", "--resist", "pierce", "--json")
data = json.loads(out)
check("json echoes an empty weights map when none were passed", data["weights"], {})

# ---------------------------------------------------------------------------
# Results carry their domain
# ---------------------------------------------------------------------------

# A multi-domain search is the case that needs this: without `domain` on the row there is
# nothing in the output separating an augment from a component, and the two are acquired
# and slotted differently. Pinned loosely (both present) rather than to exact counts,
# since the point is that the field discriminates, not what today's totals are.
out = run_cli("search", "--domain", "augment,component", "--fits", "amulet",
              "--resist", "cold", "--limit", "40", "--json")
data = json.loads(out)
domains = {r["domain"] for r in data["results"]}
check("search json carries each result's domain", domains, {"augment", "component"})

out = run_cli("show", "Skyshard Powder", "--json")
check("show json carries the domain", json.loads(out)["domain"], "augment")

out = run_cli("show", "Skyshard Powder")
check("show text carries the domain", "augment" in out, True)

# ---------------------------------------------------------------------------
# Criterion labels echo the name the caller typed, not the record behind it
# ---------------------------------------------------------------------------

CHILLING_ROUNDS = "records/skills/playerclass07/wpattack02.dbr"

out = run_cli("search", "--slot", "amulet", "--boosts-skill", "Chilling Rounds",
              "--stat", "damage.cold", "--limit", "1", "--explain")
check("table names the skill, not its record", "boosts skill Chilling Rounds" in out, True)
check("table does not leak the record path", CHILLING_ROUNDS in out, False)

out = run_cli("search", "--slot", "amulet", "--boosts-skill", "Chilling Rounds",
              "--stat", "damage.cold", "--limit", "1", "--json")
data = json.loads(out)
part = next(p for p in data["results"][0]["parts"] if p["name"].startswith("boosts_skill:"))
# `name` stays record-keyed: it is the --weights key and the unmatched_criteria value, so
# it must not become a display string. `display` is the readable form beside it.
check("json part keeps the record-keyed label", part["name"], f"boosts_skill:{CHILLING_ROUNDS}")
check("json part carries the display form", part["display"], "boosts_skill:Chilling Rounds")

# Both spellings of the same weight key must produce the same ranking, so a caller can
# weight a skill by the name they typed instead of pasting a record path.
by_name = run_cli("search", "--slot", "amulet", "--boosts-skill", "Chilling Rounds",
                  "--stat", "damage.cold", "--limit", "3",
                  "--weights", "boosts_skill:Chilling Rounds=5", "--json")
by_record = run_cli("search", "--slot", "amulet", "--boosts-skill", "Chilling Rounds",
                    "--stat", "damage.cold", "--limit", "3",
                    "--weights", f"boosts_skill:{CHILLING_ROUNDS}=5", "--json")
check("--weights accepts the display name", json.loads(by_name)["results"],
      json.loads(by_record)["results"])

code, err = run_cli_expect_failure("search", "--slot", "amulet",
                                    "--boosts-skill", "Chilling Rounds",
                                    "--weights", "boosts_skill:Nonsense=5")
check("a weight name matching neither form still exits non-zero", code != 0, True)

# ---------------------------------------------------------------------------
# F4: show's text and JSON renderers must agree
# ---------------------------------------------------------------------------

# The Massacre axe has three tiers, so its text-mode `show` must now carry the ladder
# and a grimtools link - both previously JSON-only (Task 9's tier-ladder fix was
# invisible to a text-mode caller).
text = run_cli("show", "records/items/gearweapons/melee2h/c002_axe2h.dbr")
check("show text carries the tier ladder", "14 / 58 / 84" in text, True)
check("show text carries a grimtools link",
      "https://www.grimtools.com/db/advsearch?query=" in text, True)

# ---------------------------------------------------------------------------
# F5: --source is a filter that must exclude sourced items from `unknown`, not the reverse
# ---------------------------------------------------------------------------

out = run_cli("search", "--domain", "augment", "--source", "unknown", "--limit", "50", "--json")
data = json.loads(out)
check("--source unknown returns at least one item", len(data["results"]) > 0, True)
check("--source unknown returns only items with no source",
      {r["source"] for r in data["results"]}, {"unknown"})

out = run_cli("search", "--domain", "augment", "--source", "vendor", "--limit", "50", "--json")
data = json.loads(out)
check("--source vendor returns at least one item", len(data["results"]) > 0, True)
check("--source vendor returns only vendor-sourced items",
      {r["source"] for r in data["results"]}, {"vendor"})


# ---------------------------------------------------------------------------
# fake-repo leg: run_search driven directly, no database
# ---------------------------------------------------------------------------

core_spec = importlib.util.spec_from_file_location("gditems_core", HERE / "gditems_core.py")
assert core_spec and core_spec.loader
core = importlib.util.module_from_spec(core_spec)
core_spec.loader.exec_module(core)

cli_spec = importlib.util.spec_from_file_location("gditems", HERE / "gditems.py")
assert cli_spec and cli_spec.loader
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
                "rarities": ["Epic"], "expansions": ["fg"], "conversion_types": ["Pierce"]}

    def find(self, name_or_record):
        return [c for c in self._candidates if c.name == name_or_record]


repo = FakeRepo([
    core.Candidate(record="r/myth", group_key="f1", name="Mythical Thing", item_level=84,
                   req_level=80, rarity="Epic", domain="gear", slots=("feet",), source="unknown",
                   stat_values={"damage.pierce": 40.0}, skill_boosts={}, mastery_boosts={},
                   granted_skills=(), conversions=()),
    core.Candidate(record="r/base", group_key="f1", name="Thing", item_level=30,
                   req_level=25, rarity="Epic", domain="gear", slots=("feet",), source="unknown",
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

# F5: --open N must open the Nth (1-indexed) result's URL, not the (N+1)th. Three
# distinct records so a ranking-vs-index mixup would be visible.
open_repo = FakeRepo([
    core.Candidate(record="r/a", group_key="fa", name="Item A", item_level=10, req_level=10,
                   rarity="Epic", domain="gear", slots=("feet",), source="unknown",
                   stat_values={"damage.pierce": 30.0}, skill_boosts={}, mastery_boosts={},
                   granted_skills=(), conversions=()),
    core.Candidate(record="r/b", group_key="fb", name="Item B", item_level=10, req_level=10,
                   rarity="Epic", domain="gear", slots=("feet",), source="unknown",
                   stat_values={"damage.pierce": 20.0}, skill_boosts={}, mastery_boosts={},
                   granted_skills=(), conversions=()),
    core.Candidate(record="r/c", group_key="fc", name="Item C", item_level=10, req_level=10,
                   rarity="Epic", domain="gear", slots=("feet",), source="unknown",
                   stat_values={"damage.pierce": 10.0}, skill_boosts={}, mastery_boosts={},
                   granted_skills=(), conversions=()),
])
open_payload = cli.run_search(open_repo, cli.parse_args(
    ["search", "--domain", "gear", "--stat", "damage.pierce", "--json"]))
open_results = open_payload["results"]
check("three results ranked by pierce descending",
      [r["scored"].candidate.name for r in open_results], ["Item A", "Item B", "Item C"])

opened: list[str] = []
cli.open_url = opened.append
cli._handle_open(open_results, 2)
check("--open 2 opens the second result's url, not the third's",
      opened, [open_results[1]["url"]])

# A skill record with no display name in the data keeps its record path as its label.
# 46 of the 245 boost targets are genuinely nameless (hidden buff-carrier records with no
# skillDisplayName fact), and inventing a name from the file stem would assert one the
# game does not have. Driven through the fake repo so the case is pinned regardless of
# which records happen to be nameless in a future deposit.
NAMED = "records/skills/playerclass07/named.dbr"
NAMELESS = "records/skills/playerclass07/nameless.dbr"


class SkillVocabRepo(FakeRepo):
    def vocabulary(self):
        vocab = super().vocabulary()
        vocab["skills"] = {"Named Skill": NAMED}
        return vocab


label_repo = SkillVocabRepo([
    core.Candidate(record="r/x", group_key="fx", name="Item X", item_level=10, req_level=10,
                   rarity="Epic", domain="gear", slots=("feet",), source="unknown",
                   stat_values={}, skill_boosts={NAMED: 3, NAMELESS: 2}, mastery_boosts={},
                   granted_skills=(), conversions=()),
])
label_payload = cli.run_search(label_repo, cli.parse_args(
    ["search", "--domain", "gear", "--boosts-skill", f"Named Skill,{NAMELESS}"]))
labels = label_payload["labels"]
check("a named skill record resolves to its display name",
      labels[f"boosts_skill:{NAMED}"], "boosts_skill:Named Skill")
check("a nameless skill record keeps its record path",
      labels[f"boosts_skill:{NAMELESS}"], f"boosts_skill:{NAMELESS}")

print("FAILURES:", failures)
raise SystemExit(1 if failures else 0)
