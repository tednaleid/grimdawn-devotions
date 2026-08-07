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
const RETIRED = ["Total Damage", "% Retaliation added to Attack", "Shield Recovery"];

test("our English noun matches what GrimTools renders", () => {
  const catalog = en as Record<string, string>;
  for (const [key, noun] of Object.entries(GT_CONFIRMED)) {
    expect(catalog[key]).toBe(noun);
    expect(gtText).toContain(noun);
  }
});

// Catalog values only, by exact equality. Do NOT add a `expect(gtText).not.toContain(stale)`
// half here: a retired wording can be a strict PREFIX of the corrected one, so a substring
// probe fires on correct data. "Shield Recovery" is a prefix of "Shield Recovery Time", the
// term we replaced it with, so the moment the fixture is recaptured from a build that takes a
// star carrying characterDefensiveBlockRecoveryReduction the assertion fails on text that is
// right. The fixture is third-party prose we neither own nor control; the assertion that
// actually matters is that OUR catalog never ships a retired wording again.
test("retired wordings never reappear as a catalog value", () => {
  const catalog = en as Record<string, string>;
  for (const stale of RETIRED) {
    expect(Object.values(catalog)).not.toContain(stale);
  }
});
