// ABOUTME: Tests for buildConRegions / constellationAt - JS hover resolution over constellation art bounds.
// ABOUTME: Covers art-bounds regions, the star-box fallback, miss (null), and nearest-centroid tie-breaking.
import { test, expect } from "bun:test";
import doc from "../../data/devotions.json";
import { buildModel } from "../src/core/model";
import { buildConRegions, constellationAt, type ConRegion } from "../src/adapters/svgRenderer";

const model = buildModel(doc as any);

test("constellationAt returns null outside every region", () => {
  const regions: ConRegion[] = [{ id: "a", x0: 0, y0: 0, x1: 10, y1: 10, cx: 5, cy: 5 }];
  expect(constellationAt(regions, 50, 50)).toBeNull();
});

test("constellationAt breaks overlapping-bounds ties by nearest centroid", () => {
  const regions: ConRegion[] = [
    { id: "big", x0: 0, y0: 0, x1: 100, y1: 100, cx: 50, cy: 50 },
    { id: "small", x0: 60, y0: 60, x1: 80, y1: 80, cx: 70, cy: 70 },
  ];
  expect(constellationAt(regions, 70, 70)).toBe("small"); // inside both -> closer centroid
  expect(constellationAt(regions, 10, 10)).toBe("big"); // inside only the big one
});

test("buildConRegions uses art bounds when a manifest provides them", () => {
  const c = [...model.constellations.values()].find((c) => c.background?.image && c.background.x != null)!;
  const name = c.background!.image!.split("/").pop()!;
  const regions = buildConRegions(model, { images: { [name]: { url: "art.webp", w: 640, h: 480 } } });
  const r = regions.find((r) => r.id === c.id)!;
  expect([r.x0, r.y0, r.x1, r.y1]).toEqual([c.background!.x!, c.background!.y!, c.background!.x! + 640, c.background!.y! + 480]);
});

test("buildConRegions falls back to the star box and resolves its own centroid", () => {
  const regions = buildConRegions(model, null);
  const r = regions.find((r) => r.id === "falcon")!;
  expect(constellationAt(regions, r.cx, r.cy)).toBe("falcon");
});
