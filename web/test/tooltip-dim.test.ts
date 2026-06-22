// ABOUTME: A faded constellation's tooltip shows its completion minimum ("Needs N of your M points").
import { test, expect, beforeEach } from "bun:test";
import doc from "../../data/devotions.json";
import { buildModel } from "../src/core/model";
import { tooltipView } from "../src/adapters/tooltipView";

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
  tip.showConstellation(model, "bat", 0, 0, undefined, { needs: 26, cap: 55 });
  expect((el as any).innerHTML).toContain("Needs 26 of your 55");
});
