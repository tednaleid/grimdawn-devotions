// ABOUTME: Tests the pure page-hit rules shared by the browser beacon and the worker's /hit route.
// ABOUTME: Covers page-name validation, referrer labelling, privacy signals, and hit-body parsing.
import { test, expect } from "bun:test";
import { isPageName, parseHitBody, privacySignalSet, referrerLabel } from "../src/core/pageHit";

const SELF = "tednaleid.github.io";

test("accepts exactly the four page names", () => {
  for (const p of ["planner", "rr", "monsters", "items"]) expect(isPageName(p)).toBe(true);
  for (const p of ["", "Planner", "admin", 1, null, undefined]) expect(isPageName(p)).toBe(false);
});

test("labels an empty referrer as direct", () => {
  expect(referrerLabel("", SELF)).toBe("direct");
});

test("labels our own host as internal", () => {
  expect(referrerLabel("https://tednaleid.github.io/grimdawn-devotions/#s=abc", SELF)).toBe("internal");
});

test("keeps only the hostname, lowercased, without a leading www", () => {
  expect(referrerLabel("https://www.Reddit.com/r/Grimdawn/comments/x?utm=1", SELF)).toBe("reddit.com");
  expect(referrerLabel("https://forums.crateentertainment.com/t/123", SELF)).toBe("forums.crateentertainment.com");
});

test("labels an unparseable referrer as other", () => {
  expect(referrerLabel("not a url", SELF)).toBe("other");
});

test("privacy signals: GPC true or DNT '1' suppresses the hit", () => {
  expect(privacySignalSet({ globalPrivacyControl: true })).toBe(true);
  expect(privacySignalSet({ doNotTrack: "1" })).toBe(true);
  expect(privacySignalSet({ globalPrivacyControl: false, doNotTrack: "0" })).toBe(false);
  expect(privacySignalSet({ doNotTrack: null })).toBe(false);
  expect(privacySignalSet({})).toBe(false);
});

test("parses a valid hit body", () => {
  expect(parseHitBody('{"page":"rr","ref":"reddit.com"}')).toEqual({ page: "rr", ref: "reddit.com" });
});

test("rejects a body without a known page", () => {
  expect(parseHitBody('{"page":"admin","ref":"direct"}')).toBeNull();
  expect(parseHitBody('{"ref":"direct"}')).toBeNull();
  expect(parseHitBody("not json")).toBeNull();
  expect(parseHitBody("null")).toBeNull();
  expect(parseHitBody('"planner"')).toBeNull();
});

test("replaces a missing or malformed ref with other", () => {
  expect(parseHitBody('{"page":"items"}')).toEqual({ page: "items", ref: "other" });
  expect(parseHitBody('{"page":"items","ref":"<script>"}')).toEqual({ page: "items", ref: "other" });
  expect(parseHitBody(`{"page":"items","ref":"${"a".repeat(254)}"}`)).toEqual({ page: "items", ref: "other" });
});
