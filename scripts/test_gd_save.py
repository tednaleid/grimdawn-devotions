#!/usr/bin/env -S uv run --script
# ABOUTME: Tests for gd_save: the .gdc keystream decode, class-tag splitting, and placeholder text merge.
# ABOUTME: Run with `uv run scripts/test_gd_save.py`. Stdlib-only, no framework.
# /// script
# requires-python = ">=3.10"
# ///
import importlib.util
import tempfile
from pathlib import Path

here = Path(__file__).parent
spec = importlib.util.spec_from_file_location("gs", here / "gd_save.py")
assert spec and spec.loader
gs = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gs)

failures = 0
def check(name, got, want):
    global failures
    if got != want:
        failures += 1
        print(f"  FAIL {name}: got {got!r}, want {want!r}")
    else:
        print(f"  ok   {name}")


class Writer:
    """Encode a .gdc the way the game does, so the decode can be round-tripped.

    Mirrors GdcReader exactly: a value is xored against the current key and the
    key then advances over the *encoded* bytes. The key schedule itself is
    borrowed from a throwaway reader rather than restated, so this test cannot
    pass by duplicating a bug in the table generation.
    """

    def __init__(self, seed: int):
        probe = gs.GdcReader(seed.to_bytes(4, "little") + b"\0\0\0\0")
        self.table = probe.table
        self.key = seed ^ gs.SEED_MASK
        self.out = bytearray(seed.to_bytes(4, "little"))

    def _advance(self, raw: bytes) -> None:
        for b in raw:
            self.key ^= self.table[b]

    def u8(self, value: int) -> None:
        raw = (value ^ (self.key & 0xFF)) & 0xFF
        self.out.append(raw)
        self._advance(bytes([raw]))

    def u32(self, value: int) -> None:
        raw = ((value ^ self.key) & 0xFFFFFFFF).to_bytes(4, "little")
        self.out += raw
        self._advance(raw)

    def ascii_str(self, s: str) -> None:
        self.u32(len(s))
        for ch in s:
            self.u8(ord(ch))

    def wide_str(self, s: str) -> None:
        self.u32(len(s))
        for ch in s:
            self.u8(ord(ch) & 0xFF)
            self.u8((ord(ch) >> 8) & 0xFF)


def build_save(name="Testchar", class_tag="tagSkillClassName0306", level=42, hardcore=0, seed=0x5754EF71):
    w = Writer(seed)
    w.u32(gs.MAGIC)
    w.u32(2)          # version
    w.wide_str(name)
    w.u8(1)           # male
    w.ascii_str(class_tag)
    w.u32(level)
    w.u8(hardcore)
    return bytes(w.out)


# --- The decode itself ------------------------------------------------------
# The keystream is seeded from the file's own first four bytes, so a wrong key
# schedule or a wrong read width desynchronises everything after it rather than
# failing loudly. Round-tripping every header field is what catches that.

with tempfile.TemporaryDirectory() as td:
    p = Path(td) / "player.gdc"
    p.write_bytes(build_save())
    h = gs.read_header(p)
    check("decode name", h["name"], "Testchar")
    check("decode level", h["level"], 42)
    check("decode class tag", h["class_tag"], "tagSkillClassName0306")
    check("decode hardcore", h["hardcore"], False)
    check("decode version", h["version"], 2)

    # A different seed produces completely different bytes for the same character.
    other = build_save(seed=0x01020304)
    check("seed changes ciphertext", other == build_save(), False)
    p.write_bytes(other)
    check("decode is seed-independent", gs.read_header(p)["name"], "Testchar")

    # Hardcore flag and a longer name, since the name is length-prefixed UTF-16.
    p.write_bytes(build_save(name="A Much Longer Name", hardcore=1, level=100))
    h = gs.read_header(p)
    check("decode long name", h["name"], "A Much Longer Name")
    check("decode hardcore true", h["hardcore"], True)
    check("decode level 100", h["level"], 100)

    # A file that is not a save must be rejected, not silently misread.
    p.write_bytes(b"\x00" * 64)
    try:
        gs.read_header(p)
        check("rejects non-save", "no error", "ValueError")
    except ValueError as e:
        check("rejects non-save", "magic" in str(e).lower() or "not a grim dawn" in str(e).lower(), True)

# --- Class tag splitting ----------------------------------------------------

check("two masteries", gs.mastery_tags("tagSkillClassName0306"),
      ["tagSkillClassName03", "tagSkillClassName06"])
check("one mastery", gs.mastery_tags("tagSkillClassName04"), ["tagSkillClassName04"])
check("no mastery yet", gs.mastery_tags(""), [])
check("odd digits are not a class tag", gs.mastery_tags("tagSkillClassName030"), [])
check("non-numeric suffix", gs.mastery_tags("tagSkillClassNameXX"), [])

# --- Placeholder-aware text merge -------------------------------------------
# The base game ships `?` and empty values for the expansion masteries and the
# expansion files carry the real names. NTFS returns tagsgdx1_skills.txt BEFORE
# tags_skills.txt, so a last-writer-wins merge resolves Infiltrator back to
# "Nightblade + ?". Both filenames are written here so the ordering is exercised.

with tempfile.TemporaryDirectory() as td:
    d = Path(td)
    (d / "tagsgdx1_skills.txt").write_text(
        "tagSkillClassName07=Inquisitor\ntagSkillClassName0407=Infiltrator\n", encoding="utf-8")
    (d / "tags_skills.txt").write_text(
        "tagSkillClassName04=Nightblade\ntagSkillClassName07=?\ntagSkillClassName0407=\n", encoding="utf-8")
    tags = gs.load_tags(d)
    check("placeholder ? never wins", tags.get("tagSkillClassName07"), "Inquisitor")
    check("empty value never wins", tags.get("tagSkillClassName0407"), "Infiltrator")
    check("real base value kept", tags.get("tagSkillClassName04"), "Nightblade")

    header = {"class_tag": "tagSkillClassName0407",
              "mastery_tags": gs.mastery_tags("tagSkillClassName0407")}
    check("describe combined class", gs.describe_class(header, tags),
          "Infiltrator (Nightblade + Inquisitor)")
    # With no text table at all the tag itself is reported, never a wrong guess.
    check("describe degrades to tag", gs.describe_class(header, {}), "tagSkillClassName0407")

check("load_tags on a missing dir", gs.load_tags(Path("does-not-exist")), {})

# --- Against the real saves on this machine, when there are any -------------

real = gs.find_saves()
if not real:
    print("  SKIP local-save checks (no player.gdc found)")
else:
    rows, errors = gs.headers_for(real)
    check("every local save decodes", len(rows), len(real))
    check("no decode errors", errors, [])
    check("every character has a name", all(r["name"] for r in rows), True)
    check("every level is in range", all(1 <= r["level"] <= 100 for r in rows), True)

print(f"\nFAILURES: {failures}")
raise SystemExit(1 if failures else 0)
