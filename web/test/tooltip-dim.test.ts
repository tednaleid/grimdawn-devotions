// ABOUTME: A faded constellation's tooltip shows its completion minimum ("Needs N of your M points").
import { test, expect, beforeEach } from "bun:test";
import doc from "../../data/devotions.json";
import { buildModel } from "../src/core/model";
import { tooltipView } from "../src/adapters/tooltipView";
import { enLoc } from "./helpers/localizeEn";

const model = buildModel(doc as any);

beforeEach(() => {
  global.window = {
    innerWidth: 1024,
    innerHeight: 768,
  } as any;
});

test("shows the completion minimum when dim info is supplied", () => {
  const el = { style: {}, innerHTML: "", offsetWidth: 0, offsetHeight: 0 } as any as HTMLElement;
  const tip = tooltipView(el);
  tip.showConstellation(enLoc, model, "bat", 0, 0, undefined, { needs: 26, cap: 55 });
  expect((el as any).innerHTML).toContain("Needs 26 of your 55");
});

test("shows 'cannot be completed' (not a sentinel number) when there is no reachable completion", () => {
  const el = { style: {}, innerHTML: "", offsetWidth: 0, offsetHeight: 0 } as any as HTMLElement;
  const tip = tooltipView(el);
  // No `needs` -> the engine found no completion within the cap; the tooltip must say so plainly
  // rather than leaking the INF sentinel as "Needs 1000000000 of your 55 points".
  tip.showConstellation(enLoc, model, "bat", 0, 0, undefined, { cap: 55 });
  expect((el as any).innerHTML).toContain("Cannot be completed within 55 points");
  expect((el as any).innerHTML).not.toContain("Needs");
  expect((el as any).innerHTML).not.toContain("1000000000");
});
