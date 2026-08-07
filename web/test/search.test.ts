// ABOUTME: Unit tests for the pure devotion search corpus and matcher.
// ABOUTME: Uses the real dataset for corpus shape and synthetic indexes for match semantics.
import { test, expect } from "bun:test";
import devotions from "../../data/devotions.json";
import { buildModel, type DevotionsDoc } from "../src/core/model";
import { searchCorpus, matchQuery, normalize, type SearchIndex } from "../src/core/search";
import { makeLocalization, resolveText } from "../src/core/localization";
import appEn from "../src/i18n/app.en.json";

const model = buildModel(devotions as unknown as DevotionsDoc);
const loc = makeLocalization(appEn as Record<string, string>, {}, "en");

test("normalize lowercases and folds diacritics", () => {
  expect(normalize("Dégâts")).toBe("degats");
  expect(normalize("ALL Damage")).toBe("all damage");
});

test("every constellation and star has a corpus entry", () => {
  const corpus = searchCorpus(model);
  expect(corpus.constellations.size).toBe(model.constellations.size);
  expect(corpus.stars.size).toBe(model.stars.size);
});

test("a star with a celestial power carries its power name", () => {
  const corpus = searchCorpus(model);
  const star = [...model.stars.values()].find((s) => s.celestialPower !== null)!;
  const parts = corpus.stars.get(star.id)!;
  const tags = parts.filter((p) => p.k === "game").map((p) => (p as { tag: string }).tag);
  expect(tags).toContain(star.celestialPower!.nameTag);
});

test('a star with pet bonuses carries the pet section label so "pet" matches', () => {
  const corpus = searchCorpus(model);
  const star = [...model.stars.values()].find((s) => s.petBonuses !== undefined)!;
  const text = normalize(
    corpus.stars
      .get(star.id)!
      .map((t) => resolveText(loc, t))
      .join(" "),
  );
  expect(text).toContain("pet");
});

function idx(stars: Record<string, string>, cons: Record<string, string> = {}): SearchIndex {
  return {
    constellations: new Map(Object.entries(cons).map(([k, v]) => [k, normalize(v)])),
    stars: new Map(Object.entries(stars).map(([k, v]) => [k, normalize(v)])),
  };
}

test("terms are ANDed, not ORed", () => {
  const i = idx({ a: "Fire Resistance", b: "Fire Damage" });
  expect([...matchQuery(i, "fire res").stars]).toEqual(["a"]);
  expect([...matchQuery(i, "fire").stars].sort()).toEqual(["a", "b"]);
});

test("matching is case and diacritic insensitive", () => {
  const i = idx({ a: "Dégâts de Feu" });
  expect(matchQuery(i, "DEGATS").stars.has("a")).toBe(true);
});

test("an empty or whitespace query matches nothing", () => {
  const i = idx({ a: "Fire Resistance" }, { c: "Owl" });
  expect(matchQuery(i, "").stars.size).toBe(0);
  expect(matchQuery(i, "   ").constellations.size).toBe(0);
});

test("constellation and star matches are reported separately", () => {
  const i = idx({ a: "Fire Damage" }, { owl: "Owl" });
  const m = matchQuery(i, "owl");
  expect([...m.constellations]).toEqual(["owl"]);
  expect(m.stars.size).toBe(0);
});
