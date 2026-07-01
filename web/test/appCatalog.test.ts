// ABOUTME: Guards that keys referenced by the app exist in app.en.json, so a missing key fails CI not runtime.
// ABOUTME: Grows as more views migrate; each migration adds its keys here.
import { test, expect } from "bun:test";
import en from "../src/i18n/app.en.json";

const REQUIRED = [
  "ui.title",
  "ui.boot.failed",
  "ui.boot.reload",
  "ui.boot.loading",
  "ui.points.label",
  "ui.points.budgetAria",
  "ui.points.capRemoveTitle",
  "ui.points.capRestoreTitle",
  "ui.points.total",
  "ui.points.reset",
  "ui.points.used",
  "ui.points.min",
  "ui.drawer.benefitsAria",
  "ui.drawer.benefits",
  "ui.drawer.affinityAria",
  "ui.drawer.affinity",
  "ui.panel.availableToGet",
  "ui.panel.petBonus",
  "ui.panel.celestialPowers",
  "ui.panel.benefits",
  "ui.panel.affinity",
  "ui.compare.banner",
  "ui.compare.revert",
  "ui.compare.updateBaseline",
  "ui.compare.setBaseline",
  "ui.compare.base",
  "ui.compare.now",
  "ui.compare.delta",
  "ui.benefits.empty",
  "ui.affinity.have",
  "ui.affinity.need",
  "ui.affinity.neededBy",
  "ui.tooltip.petBonus",
  "ui.tooltip.currentLevel",
  "ui.tooltip.procQualifier",
  "ui.tooltip.requires",
  "ui.tooltip.grants",
  "ui.tooltip.pts",
  "ui.tooltip.needsPoints",
  "ui.tooltip.cannotComplete",
  "ui.tooltip.partialGate",
];

test("every required chrome key exists in app.en.json", () => {
  const cat = en as Record<string, string>;
  for (const key of REQUIRED) expect(cat[key]).toBeDefined();
});
