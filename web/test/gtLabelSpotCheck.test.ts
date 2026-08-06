// ABOUTME: Pins our English stat nouns against GrimTools' rendered devotion text.
// ABOUTME: Fixture is a committed dumpDevotion() capture; it covers one build, so the table is curated.
import { test, expect } from "bun:test";
import en from "../src/i18n/app.en.json";
import fixture from "../../scripts/fixtures/gt-devotions-infiltrator.json";

const gtText: string = (fixture as { devotions: { details: string }[] }).devotions.map((d) => d.details).join("\n");

// app catalog key -> the exact noun GrimTools renders for that stat.
// Extend this as the audit (Task 4) confirms more labels against the fixture.
const GT_CONFIRMED: Record<string, string> = {
  "stat.override.offensiveTotalDamageModifier": "All Damage",
};

// Wordings we deliberately retired. Present here as evidence, so a future edit that
// reintroduces one has to argue with a failing test rather than slip through review.
const RETIRED = ["Total Damage"];

test("our English noun matches what GrimTools renders", () => {
  const catalog = en as Record<string, string>;
  for (const [key, noun] of Object.entries(GT_CONFIRMED)) {
    expect(catalog[key]).toBe(noun);
    expect(gtText).toContain(noun);
  }
});

test("retired wordings appear neither in our catalog nor in GrimTools text", () => {
  const catalog = en as Record<string, string>;
  for (const stale of RETIRED) {
    expect(gtText).not.toContain(stale);
    expect(Object.values(catalog)).not.toContain(stale);
  }
});
