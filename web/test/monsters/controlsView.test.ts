// ABOUTME: Markup tests for the difficulty note, which must be derived from the data, never asserted.
// ABOUTME: Pins that the note disappears the moment the two offset rows diverge.
import { test, expect } from "bun:test";
import { diffNoteMarkup } from "../../src/monsters/adapters/controlsView";
import { DAMAGE_TYPES } from "../../src/monsters/core/facets";
import type { Localization } from "../../src/ports/Localization";
import type { Resistances } from "../../src/monsters/core/model";

const loc: Localization = { translate: (k) => k, gameText: (t) => t, locale: "en" };
const row = (over: Partial<Resistances> = {}) =>
  ({ ...Object.fromEntries(DAMAGE_TYPES.map((t) => [t, 8])), ...over }) as Resistances;

test("the note renders on ascendant when the two rows match", () => {
  expect(diffNoteMarkup(loc, "ascendant", row(), row())).toContain("monsters.note.ascendantSameAsUltimate");
});

test("the note is withheld when the rows differ", () => {
  // The whole point of deriving it: a patch that gives ascendant its own offsets
  // must silence the claim without anyone editing app code.
  expect(diffNoteMarkup(loc, "ascendant", row({ fire: 9 }), row())).toBe("");
});

test("the note never renders on another difficulty", () => {
  expect(diffNoteMarkup(loc, "ultimate", row(), row())).toBe("");
  expect(diffNoteMarkup(loc, "normal", row(), row())).toBe("");
});
