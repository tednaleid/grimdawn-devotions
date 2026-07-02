// ABOUTME: Test helper providing the real English catalog as a Localization instance.
// ABOUTME: Use in any view test that asserts human-readable text.
import en from "../../src/i18n/app.en.json";
import gameEn from "../../../data/i18n/game.en.json";
import { makeLocalization } from "../../src/core/localization";

export const enLoc = makeLocalization(
  en as Record<string, string>,
  en as Record<string, string>,
  "en",
  gameEn as Record<string, string>,
  gameEn as Record<string, string>,
);
