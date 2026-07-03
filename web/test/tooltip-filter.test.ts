// ABOUTME: The tooltip tags bonus rows and affinity lines with data-vid and marks active filter tags.
// ABOUTME: Player rows use the bare id, pet rows pet:, Grants/Requires use aff:grant:/aff:req:.
import { test, expect, beforeEach } from "bun:test";
import doc from "../../data/devotions.json";
import { buildModel } from "../src/core/model";
import { tooltipView } from "../src/adapters/tooltipView";
import { enLoc } from "./helpers/localizeEn";

const model = buildModel(doc as any);

beforeEach(() => {
  global.window = { innerWidth: 1024, innerHeight: 768 } as any;
});

function el() {
  return { style: {}, innerHTML: "", offsetWidth: 0, offsetHeight: 0 } as any as HTMLElement;
}

test("bonus rows carry data-vid and gain vsel when the tag is active", () => {
  const star = [...model.stars.values()].find((s) => Object.keys(s.bonuses).length > 0)!;
  const e = el();
  const tip = tooltipView(e);
  tip.show(enLoc, model, star.id, 0, 0);
  const vid = (e as any).innerHTML.match(/class="tip-bonus[^"]*" data-vid="([^"]+)"/)![1];
  expect(vid.startsWith("aff:")).toBe(false);

  const e2 = el();
  tooltipView(e2).show(enLoc, model, star.id, 0, 0, undefined, undefined, new Set([vid]));
  expect((e2 as any).innerHTML).toContain(`class="tip-bonus vsel" data-vid="${vid}"`);
});

test("constellation Grants/Requires lines carry aff: data-vid and gain vsel when active", () => {
  // A constellation that both grants and requires an affinity.
  const con = [...model.constellations.values()].find(
    (c) =>
      Object.values(c.affinityBonus).some((v) => (v ?? 0) > 0) &&
      Object.values(c.affinityRequired).some((v) => (v ?? 0) > 0),
  )!;
  const e = el();
  tooltipView(e).showConstellation(enLoc, model, con.id, 0, 0);
  const html = (e as any).innerHTML as string;
  const grantVid = html.match(/data-vid="(aff:grant:[a-z]+)"/)![1]!;
  const reqVid = html.match(/data-vid="(aff:req:[a-z]+)"/)![1]!;

  const e2 = el();
  tooltipView(e2).showConstellation(
    enLoc,
    model,
    con.id,
    0,
    0,
    undefined,
    undefined,
    undefined,
    new Set([grantVid, reqVid]),
  );
  const html2 = (e2 as any).innerHTML as string;
  expect(html2).toMatch(new RegExp(`class="aff vsel" data-vid="${grantVid}"`));
  expect(html2).toMatch(new RegExp(`class="aff (?:met|missing) vsel" data-vid="${reqVid}"`));
});
