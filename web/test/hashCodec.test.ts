// ABOUTME: Tests for the shared URL-hash set codec used by every faceted page.
// ABOUTME: Pins the tolerance contract: a bad token drops itself, never the whole list.
import { test, expect } from "bun:test";
import { putSet, readSet } from "../src/core/hashCodec";

test("putSet omits an empty set and emits a populated one", () => {
  const parts: string[] = [];
  putSet(parts, "tier", new Set());
  expect(parts).toEqual([]);
  putSet(parts, "tier", new Set(["Hero", "Boss"]));
  expect(parts).toEqual(["tier=Hero,Boss"]);
});

test("putSet percent-encodes values that would break the hash grammar", () => {
  const parts: string[] = [];
  putSet(parts, "role", new Set(["boss&quest"]));
  expect(parts[0]).toBe("role=boss%26quest");
});

test("readSet keeps only allowed values and decodes them", () => {
  const allowed = new Set(["boss&quest", "hero"]);
  expect(readSet("boss%26quest,hero", allowed)).toEqual(new Set(["boss&quest", "hero"]));
  expect(readSet("hero,bogus", allowed)).toEqual(new Set(["hero"]));
});

test("a single undecodable token drops itself, not the whole list", () => {
  // "%%%" throws in decodeURIComponent; "hero" beside it must still survive.
  expect(readSet("%%%,hero", new Set(["hero"]))).toEqual(new Set(["hero"]));
});

test("an empty value decodes to an empty set", () => {
  expect(readSet("", new Set(["hero"]))).toEqual(new Set());
});
