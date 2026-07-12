// ABOUTME: Tests metaFromDoc - the dataset provenance mapping (game version + extraction timestamp)
// ABOUTME: with empty-string fallbacks so stale or hand-built datasets degrade instead of throwing.
import { test, expect } from "bun:test";
import doc from "../../data/devotions.json";
import { metaFromDoc } from "../src/adapters/httpDataSource";

test("metaFromDoc reads game_version and generated_utc from the real dataset", () => {
  const meta = metaFromDoc(doc as any);
  expect(meta.gameVersion).toMatch(/^\d+\.\d+/); // "1.2.1.x" today; re-stamped by the parser on patches
  expect(meta.generatedUtc).toMatch(/^\d{4}-\d{2}-\d{2}T/);
});

test("metaFromDoc falls back to empty strings when meta is absent or partial", () => {
  expect(metaFromDoc({ constellations: [] } as any)).toEqual({ gameVersion: "", generatedUtc: "" });
  expect(metaFromDoc({ constellations: [], meta: { game_version: "1.3.0" } } as any)).toEqual({
    gameVersion: "1.3.0",
    generatedUtc: "",
  });
});
