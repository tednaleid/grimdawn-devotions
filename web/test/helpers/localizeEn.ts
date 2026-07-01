// ABOUTME: Test helper that installs the real English catalog so translate() resolves to English.
// ABOUTME: Use in any view test that asserts human-readable text.
import en from "../../src/i18n/app.en.json";
import gameEn from "../../../data/i18n/game.en.json";
import { makeLocalization, setLocalization } from "../../src/core/localization";

export function installEnglish(): void {
  setLocalization(
    makeLocalization(
      en as Record<string, string>,
      en as Record<string, string>,
      "en",
      gameEn as Record<string, string>,
      gameEn as Record<string, string>,
    ),
  );
}
