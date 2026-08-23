// ABOUTME: Unit tests for the real-build fixture converter's per-build gates: mapping,
// ABOUTME: unknown-star and repair rejection, and the happy-path fixture entry shape.
import { test, expect } from "bun:test";
import { convertRawBuild, type RawBuild } from "../scripts/build-real-builds-fixture";

const table = { sk1: "a:0", sk2: "a:1", sk3: "b:0", sk9: "z:0" };
const known = new Set(["a:0", "a:1", "b:0"]);
const identity = (stars: string[]) => new Set(stars);
const raw = (skillIds: string[]): RawBuild => ({
  source: "https://www.grimtools.com/builds/1-x",
  title: "T",
  slug: "AbCd",
  gameVersion: "1.3.0.7",
  skillIds,
  devotionPointsLeft: 55,
});

test("happy path: mastery ids drop, stars map, entry carries provenance", () => {
  const r = convertRawBuild(raw(["mastery_sk_77", "sk2", "sk1"]), table, known, identity);
  if (!("ok" in r)) throw new Error(`expected ok, got skip: ${(r as { skip: string }).skip}`);
  expect(r.ok.calc).toBe("https://www.grimtools.com/calc/AbCd");
  expect(r.ok.starIds).toEqual(["a:0", "a:1"]); // sorted, deduped
  expect(r.ok.title).toBe("T");
});

test("a build with no mappable devotions is skipped", () => {
  const r = convertRawBuild(raw(["mastery_sk_77"]), table, known, identity);
  expect(r).toEqual({ skip: "no-devotions" });
});

test("a mapped star the model does not know is a loud skip", () => {
  const r = convertRawBuild(raw(["sk9"]), table, known, identity);
  expect("skip" in r && r.skip.startsWith("unknown-star")).toBe(true);
});

test("a selection the planner would repair away is a loud skip", () => {
  const pruning = (stars: string[]) => new Set(stars.slice(1));
  const r = convertRawBuild(raw(["sk1", "sk2"]), table, known, pruning);
  expect("skip" in r && r.skip.startsWith("fails-repair")).toBe(true);
});
