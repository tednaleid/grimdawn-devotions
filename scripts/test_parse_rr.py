#!/usr/bin/env -S uv run --script
# ABOUTME: Tests for parse_rr RR extraction. Run: uv run scripts/test_parse_rr.py
# /// script
# requires-python = ">=3.10"
# ///
import importlib.util, json, subprocess, sys, tempfile
from pathlib import Path

here = Path(__file__).parent
root = here.parent

def load(name, file):
    spec = importlib.util.spec_from_file_location(name, here / file)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod

rr = load("rr", "parse_rr.py")

failures = 0
def check(name, cond):
    global failures
    if cond:
        print(f"  ok   {name}")
    else:
        failures += 1
        print(f"  FAIL {name}")

# Run the real parser over the extracted tree into a temp file.
out = Path(tempfile.mkdtemp()) / "rr.json"
rc = subprocess.run([sys.executable, str(here / "parse_rr.py"),
    "--records-dir", str(root / "extracted/records"),
    "--text-dir", str(root / "extracted/text_en"),
    "--out", str(out), "--game-version", "test"]).returncode
check("parser exits 0", rc == 0)
doc = json.loads(out.read_text(encoding="utf-8"))
check("has meta.game_version", doc["meta"]["game_version"] == "test")
check("has meta.generated_utc", bool(doc["meta"].get("generated_utc")))
check("sources is a list", isinstance(doc["sources"], list))

print("FAILURES:", failures)
raise SystemExit(1 if failures else 0)
