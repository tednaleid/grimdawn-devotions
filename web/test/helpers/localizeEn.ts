// ABOUTME: Test helper providing the real English catalog as a Localization instance,
// ABOUTME: plus shared resolvers so tests assert human-readable text without per-file helpers.
import en from "../../src/i18n/app.en.json";
import gameEn from "../../../data/i18n/game.en.json";
import { makeLocalization, resolveText, type Text } from "../../src/core/localization";

export const enLoc = makeLocalization(
  en as Record<string, string>,
  en as Record<string, string>,
  "en",
  gameEn as Record<string, string>,
  gameEn as Record<string, string>,
);

/** Resolve a Text descriptor under the English catalog. */
export const res = (t: Text) => resolveText(enLoc, t);
/** Resolve a StatRow-shaped record (or null) to plain strings. */
export const resRow = (r: { label: Text; value: Text } | null) =>
  r ? { label: res(r.label), value: res(r.value) } : null;
/** Resolve a list of StatRow-shaped records to plain strings, preserving order. */
export const resRows = (rows: { label: Text; value: Text }[]) =>
  rows.map((r) => ({ value: res(r.value), label: res(r.label) }));
/** Mirrors the adapter render for the fallthrough segment: resolve, then sort by resolved label. */
export const resSorted = (rows: { label: Text; value: Text }[]) =>
  resRows(rows).sort((a, b) => a.label.localeCompare(b.label));
