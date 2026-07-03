// ABOUTME: Tests the benefit-tag codec: union round-trips, canonical strings, malformed aff:* forms.
// ABOUTME: Round-trip property runs over every canonical benefit id from the real dataset.
import { expect, test, describe } from "bun:test";
import doc from "../../data/devotions.json";
import { buildModel, type DevotionsDoc } from "../src/core/model";
import { canonicalBenefitIds } from "../src/core/urlState";
import { parseTag, formatTag, petTagId, affinityTagId } from "../src/core/benefitTag";

describe("parseTag variants", () => {
  test("bare id is a player tag", () => {
    expect(parseTag("offensiveFireModifier")).toEqual({ kind: "player", statId: "offensiveFireModifier" });
  });
  test("pet: prefix is a pet tag", () => {
    expect(parseTag("pet:defensiveProtection")).toEqual({ kind: "pet", statId: "defensiveProtection" });
  });
  test("bare pet: parses as a pet tag with empty statId (matches the old slice(4))", () => {
    expect(parseTag("pet:")).toEqual({ kind: "pet", statId: "" });
  });
  test("aff:grant and aff:req parse with validated affinity", () => {
    expect(parseTag("aff:grant:eldritch")).toEqual({ kind: "affinity", dir: "grant", affinity: "eldritch" });
    expect(parseTag("aff:req:chaos")).toEqual({ kind: "affinity", dir: "req", affinity: "chaos" });
  });
  test("malformed aff:* forms parse to null", () => {
    expect(parseTag("aff:grant:banana")).toBeNull();
    expect(parseTag("aff:bogus")).toBeNull();
    expect(parseTag("aff:grant:")).toBeNull();
    expect(parseTag("aff:")).toBeNull();
  });
});

describe("formatTag and builders", () => {
  test("formatTag emits the canonical forms", () => {
    expect(formatTag({ kind: "player", statId: "x" })).toBe("x");
    expect(formatTag({ kind: "pet", statId: "x" })).toBe("pet:x");
    expect(formatTag({ kind: "affinity", dir: "req", affinity: "order" })).toBe("aff:req:order");
  });
  test("builders match formatTag", () => {
    expect(petTagId("x")).toBe("pet:x");
    expect(affinityTagId("grant", "primordial")).toBe("aff:grant:primordial");
  });
});

test("round-trip: every canonical benefit id parses and reformats identically", () => {
  const model = buildModel(doc as unknown as DevotionsDoc);
  for (const id of canonicalBenefitIds(model)) {
    const tag = parseTag(id);
    expect(tag).not.toBeNull();
    expect(formatTag(tag!)).toBe(id);
  }
});
