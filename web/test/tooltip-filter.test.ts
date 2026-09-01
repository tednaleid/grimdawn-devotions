// ABOUTME: The tooltip tags bonus rows and affinity lines with data-vid and marks active filter tags.
// ABOUTME: Player rows use the bare id, pet rows pet:, Grants/Requires use aff:grant:/aff:req:.
import { test, expect, beforeEach } from "bun:test";
import doc from "../../data/devotions.json";
import { buildModel } from "../src/core/model";
import { tooltipView } from "../src/adapters/tooltipView";
import { enLoc } from "./helpers/localizeEn";
import { isFilterableStat } from "../src/core/statFormat";

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

test("a tagged bonus row wears its search's hand style: color outline and mini-star swatch", () => {
  const star = [...model.stars.values()].find((s) => Object.keys(s.bonuses).length > 0)!;
  const probe = el();
  const tip = tooltipView(probe);
  tip.show(enLoc, model, star.id, 0, 0);
  const vid = (probe as any).innerHTML.match(/class="tip-bonus[^"]*" data-vid="([^"]+)"/)![1]!;

  tip.setHandStyles(new Map([[vid, { angle: 90, color: "#3ee6d8" }]]));
  const e2 = el();
  const tip2 = tooltipView(e2);
  tip2.show(enLoc, model, star.id, 0, 0, undefined, undefined, new Set([vid]));
  const html = (e2 as any).innerHTML as string;
  expect(html).toContain(`class="tip-bonus vsel" data-vid="${vid}" style="--hand:#3ee6d8"`);
  expect(html).toContain('<svg class="hand-swatch"');
  expect(html).toContain('<line x1="10.8" y1="8" x2="14.8" y2="8" stroke="#3ee6d8"');

  // Hand styles are module state (like the query highlight); clear them for other tests.
  tip.setHandStyles(new Map());
  const e3 = el();
  tooltipView(e3).show(enLoc, model, star.id, 0, 0, undefined, undefined, new Set([vid]));
  expect((e3 as any).innerHTML).not.toContain("hand-swatch");
});

test("a tagged celestial-power stat row wears vsel and its hand style, like bonus rows", () => {
  const taggable = (s: typeof model.stars extends Map<string, infer S> ? S : never) =>
    Object.keys(s.celestialPower?.stats ?? {}).find(
      (k) => isFilterableStat(k) && !/(Duration|Max$|Chance$)/.test(k) && !(k in s.bonuses),
    );
  const star = [...model.stars.values()].find((s) => s.celestialPower && taggable(s))!;
  const vid = taggable(star)!;
  const e = el();
  const tip = tooltipView(e);
  tip.setHandStyles(new Map([[vid, { angle: 180, color: "#ff9440" }]]));
  tip.show(enLoc, model, star.id, 0, 0, undefined, undefined, new Set([vid]));
  const html = (e as any).innerHTML as string;
  expect(html).toContain(`class="tip-bonus vsel" data-vid="${vid}" style="--hand:#ff9440"`);
  expect(html).toContain('<svg class="hand-swatch"');
  tip.setHandStyles(new Map());
});
