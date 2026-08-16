// ABOUTME: A dim constellation's tooltip (and a locked star's) explains itself: the completion minimum,
// ABOUTME: the affinity it is short and who needs it, and the members that need transient affinity.
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

const fresh = () => {
  const el = { style: {}, innerHTML: "", offsetWidth: 0, offsetHeight: 0 } as any as HTMLElement;
  return { el, tip: tooltipView(el) };
};
const SCAFFOLDERS = ["blades_of_nadaan", "murmur_mistress_of_rumors", "scales_of_ulcama", "solemn_watcher"];

test("shows the completion minimum when dim info is supplied", () => {
  const { el, tip } = fresh();
  tip.showConstellation(enLoc, model, "bat", 0, 0, undefined, {
    cap: 55,
    report: { needs: 26, deficit: [], scaffolders: [] },
  });
  expect((el as any).innerHTML).toContain("Needs 26 of your 55");
});

test("shows 'cannot be completed' (not a sentinel number) when there is no completion within the search bound", () => {
  const { el, tip } = fresh();
  tip.showConstellation(enLoc, model, "bat", 0, 0, undefined, {
    cap: 55,
    report: { needs: null, deficit: [], scaffolders: [] },
  });
  expect((el as any).innerHTML).toContain("Cannot be completed within 55 points");
  expect((el as any).innerHTML).not.toContain("Needs");
  expect((el as any).innerHTML).not.toContain("1000000000");
});

test("names the affinity the completion is short and the constellation that needs it", () => {
  const { el, tip } = fresh();
  tip.showConstellation(enLoc, model, "lion", 0, 0, undefined, {
    cap: 55,
    report: { needs: 58, deficit: [{ color: 3, count: 2, sources: ["scales_of_ulcama"] }], scaffolders: [] },
  });
  expect((el as any).innerHTML).toContain("Needs 58 of your 55 points");
  expect((el as any).innerHTML).toContain("Needs 2 more Order for Scales of Ulcama");
});

test("names the members that can only be activated with transient affinity", () => {
  const { el, tip } = fresh();
  tip.showConstellation(enLoc, model, "dryad", 0, 0, undefined, {
    cap: 55,
    report: { needs: 56, deficit: [], scaffolders: SCAFFOLDERS },
  });
  const html = (el as any).innerHTML as string;
  expect(html).toContain("Needs 56 of your 55 points");
  expect(html).toContain(
    "Needs temporary affinity to activate: Blades of Nadaan, Murmur, Mistress of Rumors, Scales of Ulcama, Solemn Watcher",
  );
  expect(html).not.toContain("more Order"); // no deficit line when nothing is short
});

test("a locked star's tooltip carries the same explanation", () => {
  const { el, tip } = fresh();
  const dryadThird = model.constellations.get("dryad")!.starIds[2]!;
  tip.show(enLoc, model, dryadThird, 0, 0, undefined, undefined, new Set(), undefined, {
    cap: 55,
    report: { needs: 56, deficit: [], scaffolders: SCAFFOLDERS },
  });
  const html = (el as any).innerHTML as string;
  expect(html).toContain("Needs 56 of your 55 points");
  expect(html).toContain("Needs temporary affinity to activate: Blades of Nadaan");
});

test("a star tooltip without dim info shows no explanation lines", () => {
  const { el, tip } = fresh();
  const dryadFirst = model.constellations.get("dryad")!.starIds[0]!;
  tip.show(enLoc, model, dryadFirst, 0, 0);
  const html = (el as any).innerHTML as string;
  expect(html).not.toContain("of your");
  expect(html).not.toContain("temporary affinity");
});
