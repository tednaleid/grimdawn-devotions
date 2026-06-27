// ABOUTME: Tests the id-carrying bonus-row formatter used to tag tooltip rows with their stat id.
// ABOUTME: A merged flat damage range keeps the ...Min id; percent stats keep their raw id.
import { test, expect } from "bun:test";
import { formatBonusRowsWithIds } from "../src/core/statFormat";

test("formatBonusRowsWithIds keeps each row's stat id, merging a flat damage range to its Min id", () => {
  const rows = formatBonusRowsWithIds({ offensiveFireMin: 10, offensiveFireMax: 20, characterStrength: 5 });
  const ids = rows.map((r) => r.id);
  expect(ids).toContain("offensiveFireMin");
  expect(ids).toContain("characterStrength");
  expect(ids).not.toContain("offensiveFireMax"); // merged into the Min row
});

test("formatBonusRowsWithIds rows match formatBonusRows label/value pairs", () => {
  const bonuses = { characterStrength: 5, offensiveFireModifier: 12 };
  const withIds = formatBonusRowsWithIds(bonuses);
  expect(withIds.find((r) => r.id === "characterStrength")!.label).toBe("Physique");
  expect(withIds.find((r) => r.id === "offensiveFireModifier")!.value).toBe("+12%");
});
