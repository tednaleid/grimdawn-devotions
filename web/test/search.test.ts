// ABOUTME: Unit tests for the pure devotion search corpus and matcher.
// ABOUTME: Uses the real dataset for corpus shape and synthetic indexes for match semantics.
import { test, expect } from "bun:test";
import devotions from "../../data/devotions.json";
import { buildModel, type DevotionsDoc } from "../src/core/model";
import { searchCorpus, matchQuery, matchRanges, normalize, type SearchIndex } from "../src/core/search";
import { makeLocalization, resolveText } from "../src/core/localization";
import { condensedRows } from "../src/core/statFormat";
import { resolveIndex } from "../src/adapters/searchIndex";
import appEn from "../src/i18n/app.en.json";
import appDe from "../src/i18n/app.de.json";
import gameEn from "../../data/i18n/game.en.json";
import gameDe from "../../data/i18n/game.de.json";

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

test("a star with a celestial power carries its power description", () => {
  const corpus = searchCorpus(model);
  const star = [...model.stars.values()].find((s) => s.celestialPower?.descriptionTag)!;
  const tags = corpus.stars
    .get(star.id)!
    .filter((p) => p.k === "game")
    .map((p) => (p as { tag: string }).tag);
  expect(tags).toContain(star.celestialPower!.descriptionTag!);
});

test("a star with a weapon requirement carries its weapon requirement text", () => {
  const corpus = searchCorpus(model);
  const star = [...model.stars.values()].find((s) => s.weaponRequirement?.descriptionTag)!;
  const tags = corpus.stars
    .get(star.id)!
    .filter((p) => p.k === "game")
    .map((p) => (p as { tag: string }).tag);
  expect(tags).toContain(star.weaponRequirement!.descriptionTag!);
});

test("a plain star's corpus entry is exactly its condensed bonus subjects - no values, nothing extra", () => {
  const corpus = searchCorpus(model);
  const star = [...model.stars.values()].find(
    (s) =>
      Object.keys(s.bonuses).length > 0 &&
      s.petBonuses === undefined &&
      s.celestialPower === null &&
      !s.weaponRequirement?.descriptionTag,
  )!;
  const opts = star.racialTarget ? { racialTarget: star.racialTarget } : {};
  const expected = condensedRows(star.bonuses, opts).flatMap((g) => g.subjects.map((sub) => sub.subject));
  expect(corpus.stars.get(star.id)).toEqual(expected);
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
  const constellationHit = matchQuery(i, "owl");
  expect([...constellationHit.constellations]).toEqual(["owl"]);
  expect(constellationHit.stars.size).toBe(0);

  const starHit = matchQuery(i, "fire");
  expect([...starHit.stars]).toEqual(["a"]);
  expect(starHit.constellations.size).toBe(0);
});

test("resolveIndex produces normalized text findable by matchQuery", () => {
  const corpus = searchCorpus(model);
  const index = resolveIndex(loc, corpus);
  expect(index.stars.size).toBe(model.stars.size);
  // The Owl constellation carries offensiveTotalDamageModifier, relabelled "All Damage".
  const m = matchQuery(index, "all damage");
  expect(m.stars.size).toBeGreaterThan(0);
});

test("resolveIndex actually resolves game text, not raw tag ids", () => {
  const enLoc = makeLocalization(
    appEn as Record<string, string>,
    appEn as Record<string, string>,
    "en",
    gameEn,
    gameEn,
  );
  const corpus = searchCorpus(model);
  const index = resolveIndex(enLoc, corpus);
  // crane's nameTag is tagDevotion_A31, English text "Crane".
  const crane = index.constellations.get("crane")!;
  expect(crane).toContain("crane");
  expect(crane).not.toContain("tagdevotion_a31");
});

test("resolveIndex normalizes: lowercase, no diacritics", () => {
  const corpus = searchCorpus(model);
  const index = resolveIndex(loc, corpus);
  for (const text of index.constellations.values()) {
    expect(text).toBe(normalize(text));
  }
  for (const text of index.stars.values()) {
    expect(text).toBe(normalize(text));
  }
});

test("different locales resolve the same corpus to different index text", () => {
  const enLoc = makeLocalization(
    appEn as Record<string, string>,
    appEn as Record<string, string>,
    "en",
    gameEn,
    gameEn,
  );
  const deLoc = makeLocalization(
    appDe as Record<string, string>,
    appEn as Record<string, string>,
    "de",
    gameDe as Record<string, string>,
    gameEn,
  );
  const corpus = searchCorpus(model);
  const enIndex = resolveIndex(enLoc, corpus);
  const deIndex = resolveIndex(deLoc, corpus);
  // crane resolves to "Crane" in English and "Kranich" in German - a genuine translation.
  expect(enIndex.constellations.get("crane")).toContain("crane");
  expect(deIndex.constellations.get("crane")).toContain("kranich");
  expect(enIndex.constellations.get("crane")).not.toEqual(deIndex.constellations.get("crane"));
});

// --- matchRanges: where a query hit lands in the ORIGINAL text, for highlighting ---

const slice = (s: string, rs: [number, number][]) => rs.map(([a, b]) => s.slice(a, b));

test("matchRanges finds a term inside a longer word", () => {
  const s = "their valor and deeds never acknowledged";
  expect(slice(s, matchRanges(s, "owl"))).toEqual(["owl"]);
  expect(matchRanges(s, "owl")[0]![0]).toBe(s.indexOf("owl"));
});

test("matchRanges is case-insensitive but reports original-case ranges", () => {
  const s = "Howl of Mogdrogen";
  expect(slice(s, matchRanges(s, "OWL"))).toEqual(["owl"]);
});

test("matchRanges maps back through diacritic folding", () => {
  // The fold changes length (NFD splits, then marks are dropped), so a naive index into the
  // folded string would land on the wrong characters here.
  const s = "Dégâts de Feu";
  expect(slice(s, matchRanges(s, "degats"))).toEqual(["Dégâts"]);
  expect(slice(s, matchRanges(s, "feu"))).toEqual(["Feu"]);
});

test("matchRanges reports every occurrence, and merges overlaps", () => {
  const s = "fire and firefly";
  expect(slice(s, matchRanges(s, "fire"))).toEqual(["fire", "fire"]);
  // "fire" and "ref" overlap inside "firefly"; the merged range covers both.
  expect(slice("firefly", matchRanges("firefly", "fire ref"))).toEqual(["firef"]);
});

test("matchRanges returns nothing for an empty query or an absent term", () => {
  expect(matchRanges("Owl", "")).toEqual([]);
  expect(matchRanges("Owl", "   ")).toEqual([]);
  expect(matchRanges("Owl", "crane")).toEqual([]);
});

test("matchRanges ranges are sorted, non-overlapping, and in bounds", () => {
  const s = "Fire Damage and Fire Resistance with fiery flair";
  const rs = matchRanges(s, "fire re");
  for (const [a, b] of rs) {
    expect(a).toBeGreaterThanOrEqual(0);
    expect(b).toBeLessThanOrEqual(s.length);
    expect(a).toBeLessThan(b);
  }
  for (let i = 1; i < rs.length; i++) expect(rs[i]![0]).toBeGreaterThan(rs[i - 1]![1] - 1);
});

test("the highlight fold agrees with normalize across the real game text", () => {
  // If these ever disagree, a match found by matchQuery would highlight the wrong characters.
  // Checked against real strings in a diacritic-heavy locale, not just ASCII.
  // Single tokens on purpose: a multi-word string used as a query splits into several terms and
  // so cannot yield one range. What is under test here is the fold round trip, not term splitting.
  const samples = ["Dégâts", "Résistance", "Thương", "所有类型伤害", "Straße", "İstanbul", "Owl", "Frostburn"];
  for (const s of samples) {
    // A term equal to the whole normalized string must select the whole original string.
    const whole = normalize(s);
    if (!whole.trim()) continue;
    const rs = matchRanges(s, whole);
    expect(rs.length).toBe(1);
    expect(rs[0]).toEqual([0, s.length]);
  }
});
