// ABOUTME: Tests for the Grim Dawn player.gdc parser: cipher, block framing, and devotion extraction.
// ABOUTME: Fixtures are synthesized by test/helpers/gdSaveFixture.ts; no real save is committed.
import { test, expect } from "bun:test";
import { parseSave } from "../src/core/gdSave";
import { makeSave } from "./helpers/gdSaveFixture";

test("a buffer that is not a Grim Dawn save is rejected as notSave", () => {
  const bytes = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  const result = parseSave(bytes);
  expect(result).toEqual({ kind: "error", code: "notSave" });
});

// Pins the cipher against values computed by a separate reference implementation, so a matching
// bug in the fixture writer and the parser cannot cancel out and pass unnoticed.
test("the fixture writer encrypts the magic to the reference keystream value", () => {
  const bytes = makeSave({ seed: 0x12345678 });
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  expect(view.getUint32(0, true)).toBe(0x12345678); // seed, stored in the clear
  expect(view.getUint32(4, true)).toBe(0x1f22476a); // MAGIC ^ (seed ^ 0x55555555)
});

test("a synthesized save yields its character header", () => {
  const bytes = makeSave({ name: "Ashlyn", level: 42, hardcore: true });
  const result = parseSave(bytes);
  expect(result.kind).toBe("ok");
  if (result.kind !== "ok") return;
  expect(result.character.name).toBe("Ashlyn");
  expect(result.character.level).toBe(42);
  expect(result.character.hardcore).toBe(true);
});

test("a save from a data version the parser does not know is rejected", () => {
  const result = parseSave(makeSave({ dataVersion: 7 }));
  expect(result).toEqual({ kind: "error", code: "version" });
});

test("the devotion point counters are read from the character's point block", () => {
  const result = parseSave(makeSave({ devotionTotal: 47, devotionUnspent: 5 }));
  expect(result.kind).toBe("ok");
  if (result.kind !== "ok") return;
  expect(result.character.devotionTotal).toBe(47);
  expect(result.character.devotionUnspent).toBe(5);
});

test("only devotion records with a level are reported as taken stars", () => {
  const bytes = makeSave({
    skills: [
      { dbr: "records/skills/default/defaultkickattack.dbr", level: 1 },
      { dbr: "records/skills/devotion/tier1_04a.dbr", level: 1 },
      { dbr: "records/skills/devotion/tier1_04b.dbr", level: 0 },
      { dbr: "records/skills/devotion/tier1_18a.dbr", level: 1 },
    ],
  });
  const result = parseSave(bytes);
  expect(result.kind).toBe("ok");
  if (result.kind !== "ok") return;
  expect(result.character.starDbrs).toEqual([
    "records/skills/devotion/tier1_04a.dbr",
    "records/skills/devotion/tier1_18a.dbr",
  ]);
});

// An entry's autocast fields hold record paths, so they look exactly like the next entry's name.
// Reading them as strings (rather than assuming they are empty, or scanning for the next path)
// is what keeps the walk aligned for every entry after the first bound skill.
test("a skill with an autocast record stays one entry, and the entries after it still align", () => {
  const bytes = makeSave({
    skills: [
      {
        dbr: "records/skills/devotion/tier1_04a.dbr",
        level: 1,
        autoCast: "records/skills/devotion/tier2_15g_skill.dbr",
      },
      { dbr: "records/skills/devotion/tier1_18a.dbr", level: 1 },
      { dbr: "records/skills/devotion/tier1_18b.dbr", level: 1 },
    ],
  });
  const result = parseSave(bytes);
  expect(result.kind).toBe("ok");
  if (result.kind !== "ok") return;
  expect(result.character.starDbrs).toEqual([
    "records/skills/devotion/tier1_04a.dbr",
    "records/skills/devotion/tier1_18a.dbr",
    "records/skills/devotion/tier1_18b.dbr",
  ]);
});

test("a truncated save is reported as corrupt rather than throwing or hanging", () => {
  const full = makeSave({ skills: [{ dbr: "records/skills/devotion/tier1_04a.dbr", level: 1 }] });
  const started = Date.now();
  const result = parseSave(full.slice(0, full.length - 40));
  expect(result).toEqual({ kind: "error", code: "corrupt" });
  expect(Date.now() - started).toBeLessThan(1000);
});

// Corruption inside a block's content survives the framing checks: the block lengths still line
// up, but every field after the damaged byte decodes to noise, including string lengths.
test("corruption inside the skills block is reported as corrupt rather than read as a huge string", () => {
  const bytes = makeSave({
    skills: [
      { dbr: "records/skills/devotion/tier1_04a.dbr", level: 1 },
      { dbr: "records/skills/devotion/tier1_18a.dbr", level: 1 },
    ],
  });
  const at = bytes.length - 70;
  bytes[at] = (bytes[at] ?? 0) ^ 0xff;
  const started = Date.now();
  const result = parseSave(bytes);
  expect(result).toEqual({ kind: "error", code: "corrupt" });
  expect(Date.now() - started).toBeLessThan(1000);
});

// The real inventory and stash blocks nest their own frozen length fields, which leave the key
// out of step with a plain sequential read. The parser gets back in step at each block end, where
// the marker's plaintext is zero and the raw bytes are therefore the key itself.
test("a block holding a nested frozen length does not disturb the blocks after it", () => {
  const skills = [{ dbr: "records/skills/devotion/tier1_04a.dbr", level: 1 }];
  const withDecoy = parseSave(makeSave({ skills, nestedDecoy: true }));
  const without = parseSave(makeSave({ skills, nestedDecoy: false }));
  expect(withDecoy.kind).toBe("ok");
  expect(without.kind).toBe("ok");
  if (withDecoy.kind !== "ok" || without.kind !== "ok") return;
  expect(withDecoy.character.starDbrs).toEqual(without.character.starDbrs);
  expect(withDecoy.character.starDbrs).toEqual(["records/skills/devotion/tier1_04a.dbr"]);
});
